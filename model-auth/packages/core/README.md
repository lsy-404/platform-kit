# @model-auth/core

Framework-neutral AI provider access primitives. The package parses host-fetched `models.dev` snapshots, keeps authentication metadata free of secrets, routes eligible credentials, validates per-key `extend` fields, and defines request, stream, dynamic-authentication, and usage contracts. Usage contracts can carry provider windows plus host-owned token/request estimates with confidence and unrounded remaining percentages.

`parseModelsDevPayload` projects every structurally valid provider and model; it does not impose an agent-only policy. Provider bindings retain `api`, `env`, and `packageName`. Model descriptors retain optional description, knowledge cutoff, reasoning and effort choices, attachment and tool-call capabilities, status, modalities, token limits, costs, and release date. Invalid optional source values are omitted. Use `agentModelCatalog(catalog)` for the historical non-deprecated text-and-tool policy, `filterCatalogModels(catalog, predicate)` for shared capability policy, and `bindRuntimeProviders` for host runtime mapping.

```ts
import { CredentialRouter, createCredentialMetadata } from "@model-auth/core";

const credential = createCredentialMetadata({
  id: "workbuddy-account-1",
  providerId: "workbuddy",
  authMethod: "api-key",
  modelIds: ["glm-5.2"],
});
const router = new CredentialRouter([credential], { strategy: "failover" });
const [candidate] = router.candidates({ providerId: "workbuddy", modelId: "glm-5.2" });
```

The host looks up the secret by `candidate.id`; no secret is passed to this package.

Use `router.setUsage(credentialId, snapshot)` to supply a validated, non-secret usage reading, and `setUsage(credentialId, null)` to clear it after reconnecting an account. `usageDecision(request, credentialId)` reports `available`, `exhausted` or `unknown` with the relevant window IDs and remaining ratio. Snapshots must match the credential and provider, use valid observation/fetch times, and be no older than `usageMaxAgeMs` (five minutes by default). Removing a credential or changing its provider or authentication method clears its reading.

Only a fresh, high-reliability window explicitly marked `exhausted` excludes a candidate. Account windows apply to all models; model windows match exact IDs in `modelFamilies`; family windows require the request's explicit `modelFamily`. A reset or expired reading restores unknown quota. Stale or estimated snapshots and low-reliability windows do not establish exhaustion. The router does not infer exhaustion from a percentage, zero balance or a host estimate.

`failover` preserves credential priority after quota filtering. In `round-robin`, when every remaining candidate has comparable quota, candidates with the most remaining capacity in their tightest applicable window come first and equal-quota candidates rotate. Mixed known/unknown readings retain ordinary rotation. Supplying no readings preserves the existing routing behavior. Querying usage, storing readings and executing or retrying a model request remain host responsibilities.

Provider authentication uses the providers package in the trusted host. API-key validation, secret storage, request transport, and browser/session control remain host responsibilities. See the local integration guides for adapter boundaries.

## Usage reliability and credential views

`classifyUsageHttp`, `usageRemedy` and `mergeUsageReading` classify usage failures, choose a remedy (`reauth` or `retry`) and serve the last good reading as `stale`. `acceptsRenewal` and `createRefreshGate` give hosts a compare-and-set rule and single-flight refresh for OAuth renewal, with `OAUTH_TOMBSTONE` marking removed credentials. `describeOAuthCredential(provider, credential)` returns a read-only view (account, organization, plan, multiplier, expiry times, scopes, status) that never contains token values; unmapped fields are omitted.

`mergeUsageReading` keeps the held reading's metadata (plan, multiplier, `extraUsage`, `balance`) when a later read fails, marks it `stale`, and carries `observedAtUtc`. A window whose reset has passed and whose `windowSeconds` is known is rolled into the current cycle as `status: "unknown"`, `usedRatio: null`, `usedPercent: 0`, `reliability: "low"` and the snapshot gets `basis: "estimated"` (`"accurate"` when every window is carried unchanged); a past-reset window with no known length is dropped. Readings with different `identity` values are never merged: the failure snapshot must carry the identity of the credential's last reading (`usageErrorSnapshot` takes it as its fourth argument), because a failure without one is taken to be the same account. The failure's `retryAfterMs` is kept on the merged snapshot.

## Pacing usage reads

`createUsageGate(policy)` schedules host-triggered usage reads and holds no readings. `gate.run(credentialId, { providerId, reason }, task, { signal? })` passes an `AbortSignal` to `task` and resolves `{ ran: true, value, retryAt }` or `{ ran: false, retryAt, status? }`:

- Single flight per credential: concurrent callers share a read. Cancelling one caller leaves other callers subscribed. `credential-changed` replaces a queued old read and waits for any active old read before running its own callback. A credential ID cannot refer to different providers in pending or active reads.
- Queue priority is `credential-changed`, `manual`, `view`, then `timer`, with arrival order within a priority. A foreground call promotes a queued lower-priority read; `cancelPendingBackground()` removes queued `timer` and `view` reads without cancelling active or promoted manual reads.
- `maxQueueSize` defaults to 256 queued credentials, with at most 64 callers sharing a read; `queueTimeoutMs` and `executionTimeoutMs` each default to two minutes. Capacity rejection, cancellation and deadline expiry resolve with `ran: false` and `status` of `queue-full`, `cancelled` or `timed-out`. Ordinary minimum-interval or backoff skips have no status and carry `retryAt`.
- `policy.minIntervalMs(providerId, reason)` is the minimum time since the credential's last read started, for `reason` of `timer`, `view`, `manual` or `credential-changed`.
- Per-provider lanes: `policy.lane(providerId)` caps concurrency and spaces read starts, and `policy.maxConcurrent` caps all providers together (eight by default). Priority never bypasses concurrency, spacing or backoff.
- On execution timeout the gate aborts the callback signal and settles callers. A callback that ignores cancellation keeps its slot until it actually settles, preventing overlapping requests. Propagate the signal to the host transport and discard a result if its credential revision changed while it was running.
- A task reports a rate-limit or server failure by returning a value whose `errorCode` is `rate-limited` or `server-error`, with an optional `retryAfterMs` (the providers package's `usageErrorSnapshot` produces exactly that, optionally passed through `mergeUsageReading`), and the result then carries `retryAt`. A thrown error with such a `code` and `retryAfterMs` is honoured too, but the call rejects and no `retryAt` is returned. The provider then backs off as a whole: `retryAfterMs` capped at one hour, otherwise exponential from 60 seconds up to 30 minutes, plus up to 5 seconds of jitter. Reads that were already running together when the first one failed count as one step, and a failure that carried `retryAfterMs` does not raise the exponent. While it backs off no reason runs, `credential-changed` included, and `retryAt` says when. A success that started after the last failure resets the lane.

`parseRetryAfter(value, now?)` converts a `Retry-After` header (RFC 9110 delay-seconds or HTTP-date) to milliseconds, `0` for a past date and `null` for anything else. Only the three HTTP-date formats of RFC 9110 section 5.6.7 are accepted (IMF-fixdate, rfc850 and asctime), all read as UTC regardless of the host timezone, and a date that does not exist is rejected.

`RouteError` accepts `retryAfterMs` on 429 errors; the cooldown uses it, capped at eight times `rateLimitCooldownMs`. `router.health(id)` reports `cooldownReason` (`rate-limited` or `transient`) while a credential is cooling down.

## Breaking changes in 0.11.0

- Codex plans `prolite`, `pro`, and `promax` identify Pro 5x, 10x, and 25x. Go and Plus remain distinct. `planTier` retains the tier identity, and an explicit usage multiplier takes precedence. OAuth views read both ID-token and access-token claims without returning token values.
- `mergeUsageReading` rolls past-reset windows into an estimate instead of dropping them, and the returned snapshot carries `basis` and `observedAtUtc`.
