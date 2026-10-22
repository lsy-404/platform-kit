# Host integration

This guide is for a desktop or web host integrating the framework-neutral core and its Vue/Custom Element presentation layer.

## 1. Load the catalog

Fetch `models.dev` in the host, then pass the response to the core. The network request and refresh policy remain host-owned:

```ts
import { CatalogCache } from "@model-auth/core";

const cache = new CatalogCache(cachedModelsDevPayload);
const snapshot = await cache.refresh(async () => {
  const response = await fetch("https://models.dev/api.json");
  if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
  return response.json();
});

if (snapshot.catalog) renderProviders(snapshot.catalog.providers);
```

The example contains no credential material. A host may keep displaying the previous catalog after a failed refresh and use `snapshot.status`/`sourceStatus` to show that the source is stale.

## 2. Implement the host callbacks

The UI calls host-owned actions. The providers package performs actual authorization in that trusted process; neither Vue nor a core adapter factory is a credential vault.

Use `@model-auth/providers/openai` (`authorizeOpenAI`, `refreshOpenAI`), `@model-auth/providers/anthropic` (`authorizeAnthropic`, `refreshAnthropic`), `@model-auth/providers/workbuddy`, `@model-auth/providers/trae`, `@model-auth/providers/grok`, `@model-auth/providers/ollama`, or `@model-auth/providers/opencode`. The Codex model catalog, Grok usage and Trae authorization requests use the latest official client version automatically (`@model-auth/providers/client-versions`). OpenAI runtime credentials use provider ID `openai-codex`; Anthropic uses `anthropic`. Their metadata adapters receive the same `ProviderAdapterHost` contract shown below.

For one Anthropic login that also acquires the web session required by prepaid credits, use `authorizeAnthropicInBrowser` from `@model-auth/providers/anthropic-browser`. Pass the installed Chrome or Edge `executablePath`, the host's proxy-only `browserArgs`, `fetchImpl` for OAuth transport, and `signal`. The provider owns a temporary browser profile and returns `{ credential, cookies }` after OAuth succeeds; closing the login page cancels the attempt and removes its temporary profile. It never reads an existing browser profile or persists either returned secret.

Keep both values in the trusted host. After a final cancellation check, store them against the same account id as one host operation, restoring the prior account and cookie session if persistence fails. Only then publish account metadata and query subscription usage with the OAuth credential and prepaid credits with a fetch bound to the stored web session. The host owns browser discovery, proxy selection, encrypted storage and quota refresh policy. No Cookie or OAuth token belongs in UI state.

```ts
import {
  createCredentialMetadata,
  createWorkBuddyAdapter,
  type ProviderAdapterHost,
} from "@model-auth/core";
import { authorizeWorkBuddy } from "@model-auth/providers/workbuddy";

const workBuddyHost: ProviderAdapterHost = {
  async authorize() {
    const credential = await authorizeWorkBuddy({ openExternal: host.openExternal, signal });
    await hostSecureCredentialStore.set(credentialId, credential);
    return createCredentialMetadata({
      id: credentialId,
      providerId: "workbuddy",
      authMethod: "oauth",
      modelIds: verifiedModels,
    });
  },
  async remove(credentialId) {
    await hostSecureCredentialStore.remove(credentialId);
  },
};

const workBuddy = createWorkBuddyAdapter(workBuddyHost);
```

`host`, `signal`, `credentialId`, `verifiedModels`, and `hostSecureCredentialStore` above are host values. New accounts require distinct IDs; reconnect replaces the selected ID only. For API keys, validate and store the key in the host, then return metadata with `authMethod: "api-key"`; never put the key into `CredentialMetadata`. `extend` is a controlled scalar object for non-sensitive per-key context, not a secret bag. A host may attach its own `ProviderUsageEstimate` to a usage snapshot; token counts and learned limits must be labeled as estimates and unknown limits must stay `null`.

Dynamic providers can use the interaction supplied to `authorize`:

```ts
const credential = await providerHost.authorize({
  providerId: "provider-id",
  authType: "oauth",
  loginId,
  signal,
  notify: notice => authEvents.emit({ type: "provider-auth-notice", loginId, notice }),
  prompt: (prompt, promptId) => authBridge.waitForPrompt(loginId, promptId, prompt),
});
```

The host maps `ProviderAuthPrompt` and `ProviderAuthNotice` to its UI and propagates cancellation. `ProviderAdapterHost.request`, `stream`, and `queryUsage` are also host callbacks, so secrets stay in the trusted process while generic clients consume provider output and non-secret balances.

## 3. Bind runtime providers

```ts
import { bindRuntimeProviders } from "@model-auth/core";

const runtimeProviders = bindRuntimeProviders(snapshot.catalog!, [
  {
    runtimeProviderId: "openai-codex",
    catalogProviderId: "openai",
    includeModel: (model) => model.id.includes("mini"),
  },
]);
```

WorkBuddy and TraeCode are adapter capabilities, not fabricated `models.dev` providers. Use their exported factories when the host supplies the matching callback contract.

## 4. Route credentials

```ts
import { CredentialRouter } from "@model-auth/core";

const router = new CredentialRouter(savedCredentialMetadata, {
  strategy: "round-robin",
});
const candidates = router.candidates({ providerId: "openai-codex", modelId: "selected-model" });
const selected = candidates[0];

try {
  await hostCallModel(selected); // secret lookup and API request stay in the host
  if (selected) router.reportSuccess(selected.id);
} catch (error) {
  if (selected) router.reportError(selected.id, classifyHostError(error));
}
```

Use `setEnabled` for an independent on/off control and `setOrder(credentialIds)` to set priority; credentials are ordered by registration unless reordered. `401`/`403` permanently isolate a credential; `429`, server errors, and transport errors use bounded cooling; pass the response's `Retry-After` as `retryAfterMs` on a 429 `RouteError` to cool down for that long, and read `router.health(id).cooldownReason` to tell a rate limit from a transient failure. `failover` always tries eligible credentials in that order, while `round-robin` rotates over them starting from that order.

Supply a non-secret reading with `router.setUsage(credentialId, usageSnapshot)`, or clear it with `router.setUsage(credentialId, null)`. The snapshot must belong to that credential and provider; older observations cannot replace newer ones. Clear the reading when reconnecting the same credential ID to a different account, and discard results from queries started before that reconnect. Removing a credential or changing its provider or authentication method also clears the router's reading.

The router uses snapshots for up to `usageMaxAgeMs` (five minutes by default). Future, stale, failed and estimated readings do not establish available quota or exhaustion. A fresh, high-reliability `exhausted` window excludes a candidate only while its reset is still ahead. A known percentage of 100 by itself does not establish exhaustion. Missing or unknown quota does not exclude a credential.

Account windows apply to every model. Model windows match exact model IDs in `modelFamilies`; model-family windows match only an explicit `RouteRequest.modelFamily`, never a label or an inferred model name. With `round-robin`, when every eligible candidate has a comparable reading, the router prefers the highest remaining ratio across each candidate's tightest applicable window and rotates ties. Mixed known and unknown readings retain the usual rotation. `failover` retains explicit credential priority while excluding confirmed exhaustion. `router.usageDecision(request, credentialId)` explains the quota decision; health, enabled state and OAuth policy remain separate eligibility checks.

## 5. Pace usage reads

Route every usage read through one `createUsageGate` so timers, view refreshes, manual retries and re-authentication cannot stack up against a provider that rate-limits usage endpoints. Give it per-reason minimum intervals and a lane (concurrency and start spacing) for providers that need one, and let tasks return the error snapshot (`usageErrorSnapshot(providerId, credentialId, error, lastIdentity)`, merged with `mergeUsageReading`) after a failed query: it carries `errorCode` and `retryAfterMs` from `Retry-After`, so a 429 backs the whole provider off and the result reports `retryAt`. A call that does not run returns `retryAt`, which a host can show next to the last reading instead of an error.

```ts
import { createUsageGate } from "@model-auth/core";

const gate = createUsageGate({
  minIntervalMs: (_providerId, reason) => reason === "credential-changed" ? 0 : 60_000,
  maxConcurrent: 4,
  maxQueueSize: 64,
  queueTimeoutMs: 30_000,
  executionTimeoutMs: 30_000,
  lane: () => ({ concurrency: 1, minSpacingMs: 1000 }),
});

const revision = hostCredentialRevision(credentialId);
const result = await gate.run(
  credentialId,
  { providerId, reason: "manual" },
  signal => hostQueryUsage(credentialId, signal),
  { signal: callerSignal },
);
if (result.ran && hostCredentialRevision(credentialId) === revision) {
  router.setUsage(credentialId, result.value);
}
```

The `host*` functions and `callerSignal` above belong to the consuming application. The host triggers reads, owns credential revisions and cached readings, propagates the callback signal to its transport, and schedules any retry indicated by `retryAt`. If the host persists readings asynchronously, its write must also reject superseded credential revisions. No timer in the gate starts periodic queries.

The queue prioritizes `credential-changed`, `manual`, `view`, then `timer`, preserving arrival order within a priority. A manual call can promote a queued background read; a credential change replaces a queued old read and waits for any active old read before starting its own callback. `gate.cancelPendingBackground()` cancels queued `timer` and `view` reads and leaves active or promoted manual reads alone. Cancelling one caller does not cancel another caller's shared read. Queue cancellation, deadline expiry and capacity rejection resolve with `ran: false` and `status` of `cancelled`, `timed-out` or `queue-full`; ordinary interval/backoff skips return `retryAt` without those statuses.

Default limits are eight simultaneous reads, 256 queued credentials, 64 callers sharing one read, and two-minute queue and execution deadlines. Execution expiry aborts the callback signal and settles waiting callers, but a callback that ignores cancellation keeps its concurrency slot until it actually settles. Pass cancellation through to the transport to release that slot promptly. Priority and manual actions never bypass a provider's backoff or start spacing.

## Presentation contract

Present browser authentication and API key as the first two cards, then replace them with a searchable single-column provider list, then show model and credential configuration for the selected provider. The host should provide the actual callback functions and a secure persistence implementation to either the native Vue integration or the standalone Custom Element. Do not imply that selecting a card has authenticated the user.
