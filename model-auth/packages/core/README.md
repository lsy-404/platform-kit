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

Provider authentication uses the providers package in the trusted host. API-key validation, secret storage, request transport, and browser/session control remain host responsibilities. See the local integration guides for adapter boundaries.

## Usage reliability and credential views

`classifyUsageHttp`, `usageRemedy` and `mergeUsageReading` classify usage failures, choose a remedy (`reauth` or `retry`) and serve the last good reading as `stale`. `acceptsRenewal` and `createRefreshGate` give hosts a compare-and-set rule and single-flight refresh for OAuth renewal, with `OAUTH_TOMBSTONE` marking removed credentials. `describeOAuthCredential(provider, credential)` returns a read-only view (account, organization, plan, multiplier, expiry times, scopes, status) that never contains token values; unmapped fields are omitted.

`mergeUsageReading` keeps the held reading's metadata (plan, multiplier, `extraUsage`, `balance`) when a later read fails, marks it `stale`, and carries `observedAtUtc`. A window whose reset has passed and whose `windowSeconds` is known is rolled into the current cycle as `status: "unknown"`, `usedRatio: null`, `usedPercent: 0`, `reliability: "low"` and the snapshot gets `basis: "estimated"` (`"accurate"` when every window is carried unchanged); a past-reset window with no known length is dropped. Readings with different `identity` values are never merged.

## Pacing usage reads

`createUsageGate(policy)` decides when a usage read may run and holds no readings. `gate.run(credentialId, { providerId, reason }, task)` runs `task` with these rules and resolves `{ ran: true, value, retryAt }` or `{ ran: false, retryAt }`:

- Single flight per credential: concurrent calls share one task.
- `policy.minIntervalMs(providerId, reason)` is the minimum time since the credential's last read started, for `reason` of `timer`, `view`, `manual` or `credential-changed`.
- Per-provider lanes: `policy.lane(providerId)` caps concurrency and spaces read starts, and `policy.maxConcurrent` caps all providers together.
- A task reports a rate-limit or server failure by throwing an error, or returning a value, whose `code` or `errorCode` is `rate-limited` or `server-error`, with an optional `retryAfterMs`. The provider then backs off as a whole: `retryAfterMs` capped at one hour, otherwise exponential from 60 seconds up to 30 minutes, plus up to 5 seconds of jitter. While it backs off no reason runs, `credential-changed` included, and `retryAt` says when. A success that started after the last failure resets the lane.

`parseRetryAfter(value, now?)` converts a `Retry-After` header (RFC 9110 delay-seconds or HTTP-date) to milliseconds, `0` for a past date and `null` for anything else.

`RouteError` accepts `retryAfterMs` on 429 errors; the cooldown uses it, capped at eight times `rateLimitCooldownMs`. `router.health(id)` reports `cooldownReason` (`rate-limited` or `transient`) while a credential is cooling down.

## Breaking changes in 0.11.0

- `normalizeCodexPlan("pro")` and `describeOAuthCredential` no longer report a 20x multiplier for a bare `pro`; the multiplier is `null`. Names like `pro_10x` report the encoded size and `prolite` stays 5x.
- `mergeUsageReading` rolls past-reset windows into an estimate instead of dropping them, and the returned snapshot carries `basis` and `observedAtUtc`.
