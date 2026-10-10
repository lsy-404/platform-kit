# @model-auth/providers

Real provider authentication, requests and usage queries for trusted desktop host processes. Never import this package into a renderer or send its credentials through renderer IPC.

## OpenAI and Anthropic browser authorization

```ts
import { authorizeOpenAI, refreshOpenAI } from "@model-auth/providers/openai";
import { authorizeAnthropic, refreshAnthropic } from "@model-auth/providers/anthropic";

const credential = await authorizeOpenAI({ openExternal, signal });
await secureStore.set(accountId, credential);
const renewed = await refreshOpenAI(credential, { signal });
await secureStore.set(accountId, renewed);
```

Use `authorizeAnthropic` and `refreshAnthropic` with the same host contract for Anthropic. Both providers implement browser authorization, PKCE, correlated loopback callbacks and token renewal. OpenAI listens on port 1455 and Anthropic on port 53692; a port already in use produces an error. Hosts open the system browser and propagate cancellation through `signal`. Authorization is bounded by `timeoutMs` (ten minutes by default). No installed provider CLI is needed.

Credentials contain `type: "oauth"`, `access`, `refresh`, `expires` (Unix milliseconds), and an optional `accountId`. Store and renew them only in a trusted host process. Persist rotated refresh tokens before the next request. The package does not authenticate a user's subscription by displaying a provider card; a successful token exchange is required and service account restrictions still apply.

## WorkBuddy browser authorization

```ts
import { authorizeWorkBuddy, refreshWorkBuddy } from "@model-auth/providers/workbuddy";

const credential = await authorizeWorkBuddy({ openExternal: host.openExternal, signal });
await secureStore.set(accountId, credential);
const renewed = await refreshWorkBuddy(credential);
await secureStore.set(accountId, renewed);
```

`openExternal` opens the validated vendor login URL in the system browser. Each call owns a separate cookie session. Browser login is bounded to ten minutes and can be cancelled with an AbortSignal. Only a completed token exchange returns a credential.

Credentials contain `access`, `refresh`, `expires` (Unix milliseconds), and optional `accountId`, `userId`, `enterpriseId`, `domain`, and `label`. Store them in an OS credential store or encrypted host storage. Give every new account its own host credential ID; reauthorization replaces only the selected ID. Refresh before expiry and persist rotated tokens before inference. `workBuddyHeaders` and `WORKBUDDY_ENDPOINTS.chatBase` provide the native request binding.

The host owns model availability, secret persistence, account removal and routing policy. OAuth switches, credential ordering, and cooldowns are handled by `@model-auth/core`. Removing a local credential is not a claim of vendor-side revocation.

## ChatGPT Codex model catalog

`listOpenAICodexModels(credential, options?)` reads the account's visible Codex models; `parseOpenAICodexModels` parses a raw catalog response. The catalog is filtered by the `client_version` query value, so it defaults to the latest official Codex CLI version. Pass `clientVersion` to override it.

## Latest client versions

Provider requests that identify an official client resolve its newest published version automatically: Claude Code and Codex (npm registry), Grok CLI (`x.ai/cli/stable`) and the Trae IDE application and build (the Trae release manifest). `latestClientVersion(client, options?)` from `@model-auth/providers/client-versions` exposes the lookup for `"claude"`, `"codex"`, `"grok"`, `"trae-app"` and `"trae-build"`. Each target has a built-in minimum, so a lookup that returns an older value resolves to the minimum, and a lookup that fails resolves to the last known version or the minimum instead of throwing; a failed source is retried after five minutes. Successful lookups are cached process-wide for six hours and concurrent callers share one request, so a supplied `fetchImpl` is used only when it starts a new lookup. Explicit `clientVersion` and `appVersion` options always win. `anthropicClientHeaders(options?)` from `@model-auth/providers/anthropic` returns the same latest Claude CLI headers used by authorization, renewal and usage queries, so hosts can reuse them for inference. `grokHeaders` takes the client version as an argument.

## Trae browser authorization

```ts
import { authorizeTrae, refreshTrae, listTraeModels, completeTrae } from "@model-auth/providers/trae";

const credential = await authorizeTrae({ openExternal, signal });
const models = await listTraeModels(credential, { signal });
const result = await completeTrae(credential, {
  model: models[0].name,
  messages: [{ role: "user", content: "Hello" }],
  signal,
});
```

The host opens the browser and securely stores the whole credential, including its client ID and device key. Authorization uses a correlated loopback callback, PKCE and the same device binding for token exchange and refresh. No installed Trae CLI is required. Refresh the stored credential with `refreshTrae` before it expires and persist the rotated value atomically.

Model discovery returns the account's actual service metadata. `streamTrae` and `completeTrae` currently support text and reasoning with usage when supplied by the service. Structured tool definitions and tool messages are rejected because that wire contract has not been verified. Authentication and inference preserve server account and entitlement checks.

## Grok access and usage

`authorizeGrok` and `refreshGrok` provide the browser authentication lifecycle. `grokHeaders` binds a trusted-host request to the returned access token, and `queryGrokUsage` reads non-secret credit windows and balances from the provider billing surface. All usage snapshots preserve source precision and may carry a host-owned token/request estimate.

## Structured usage windows

Every `ProviderUsageWindow` carries `scope` (`account`, `model-family` or `model`), normalized `modelFamilies`, `status` (`known`, `unknown` or `exhausted`), `usedRatio` (0..1, null when unknown), `reliability` (`high`, or `low` for estimated sources) and `resetAt`. Providers fill these fields themselves, so consumers never infer scope from labels. `kind` (`session`, `daily`, `weekly`, `monthly` or null) is derived from the window duration. A window is `exhausted` only when the service reports it (limit flags, lock reasons or severity), never from a percentage alone. A window the provider lists without usage data is reported with status `unknown` rather than omitted. Use `usageWindow` to build windows and `normalizeModelFamilyId` to normalize ids.

## Usage requests and errors

Usage queries retry transient network failures twice, never retry 429 (a `Retry-After` header on any failed response, in seconds or as an HTTP date, becomes `UsageRequestError.retryAfterMs`, and the Ollama, OpenCode Go and Claude prepaid queries put it on their failure snapshot as `retryAfterMs`), call the host-supplied `refresh` once after a 401 or 403, honor `signal`, and never follow redirects (the cookie-based Ollama settings query is the one exception, described below; the Claude prepaid query is a second one, which does not retry and does not call `refresh`). Failures carry `errorCode` (`signed-out`, `rate-limited`, `server-error`, `unreadable`, `unreachable`, `no-limits`); `usageErrorSnapshot(providerId, credentialId, error, identity?)` builds an error snapshot (with `retryAfterMs` and the given `identity`) that hosts can merge with `mergeUsageReading` from core. Anthropic profile metadata is cached for six hours per credential, failures included.

`authorizeOpenAI` switches to the device code flow when the loopback port is taken and `notify` is supplied, reporting the code through a `device_code` notice.

## Claude extra usage and prepaid credits

`parseAnthropicUsage` reports pay-as-you-go spend as `snapshot.extraUsage` (`enabled`, `used`, `limit`, `usedPercent`, `currency`), in major units; the field is `null` when the response carries neither block. The `spend` block outranks the legacy `extra_usage` block (amounts are `amount_minor / 10^exponent`, legacy amounts `/ 10^decimal_places`). `usedPercent` is `extra_usage.utilization` when present, otherwise `used / limit * 100` when a limit exists, clamped to 0..100; the `spend.percent` field is never used. Core validation rejects an `extraUsage` whose percentage is outside 0..100 or whose amounts are negative.

`queryClaudePrepaidCredits({ fetchImpl, signal, organizationId })` reads the prepaid credit pool, which the OAuth token cannot see. `fetchImpl` must be a fetch bound to a signed-in claude.ai web session; the module never handles cookies or authorization headers, does not retry, and does not follow redirects (a redirect, 401 or 403 reports `signed-out`). It lists `/api/organizations`, keeps chat-capable organizations (or, failing that, anything that is not API-only) and reads `/api/organizations/{id}/prepaid/credits`. A session with several eligible organizations and no `organizationId` yields an `unreadable` snapshot asking to choose one. The balance is `amount / 100` in the reported currency. `balance.funded` is `false` only for a pool with a zero amount and no tranches, so a host can hide a never-funded pool while keeping a drained one at zero.

## Codex plans and tiers

`normalizeCodexPlan` maps the reported plan name to `{ plan, multiplier, tier }`: `prolite` variants are `pro` at 5x, `pro_10x`-style names, including suffixed ones such as `pro_10x_usage_based`, are `pro` at the encoded size (1 to 100), a bare `pro` is `pro` with no multiplier, `team`, `teams`, `business` and `self_serve_business_usage_based` are `business`, `enterprise` and `enterprise_cbp_usage_based` are `enterprise`, and `free`, `go`, `plus` and `edu` are kept. Other names pass through unchanged, and a value containing `@` is dropped. `tier` equals the canonical plan, and an explicit multiplier field in the response (a whole number from 1 to 100) wins over the table.

## OpenCode Go usage

`queryOpencodeGoKeyUsage(apiKey, options)` reads the Go subscription quota from `https://opencode.ai/zen/go/v1/usage` with a Bearer API key. `parseOpencodeGoUsage` maps the `rolling`, `weekly` and `monthly` windows to session, weekly and monthly usage with their reset times, and the plan is reported as `Go`. A payload without both the session and weekly windows is unreadable. A 403 carrying the `EntitlementError` body means the key has no Go subscription and yields an `unknown` snapshot with `no-limits`; any other 403 is a `server-error`. Window lengths are the documented 5 hours, 7 days and 30 days; dollar limits are not reported by the endpoint and stay unknown.

## Ollama web session and usage

`authorizeOllamaWeb` opens `ollama.com/signin`, waits for the host to observe the authenticated browser cookie, and verifies the session by reading the first-party settings page. `queryOllamaUsage` and `parseOllamaSettings` read the Cloud Usage section of that page without returning the cookie: the plan name exactly as shown, the account email as `identity`, and the session (5 hours) and weekly (7 days) windows with their percentages and reset times. Only one short window is reported: the first of Session or Hourly (1 hour) on the page. `queryOllamaUsage` follows up to four HTTPS redirects within `ollama.com` and sends the cookie nowhere else; redirects to the sign-in pages report `signed-out`, as do 401 and 403 responses and signed-out settings pages, and any other redirect target is a `server-error`. A signed-in page that shows the account email but no meters yields an `unknown` snapshot with `no-limits`. The cookie callback and persistence remain host-owned.

## Dynamic authentication and generic requests

Hosts may expose `ProviderAuthPrompt` and `ProviderAuthNotice` events through the core adapter interaction to support device codes, browser URLs, selections, and manual codes. The same adapter boundary contains generic `logout`, `request`, `stream`, and `queryUsage` callbacks; provider secrets never appear in `CredentialMetadata`, Vue state, or usage snapshots.

## Pi OAuth bridge

`@model-auth/providers/pi` adapts a host-provided Pi provider OAuth object and imports neither Pi nor credential storage. It supports Pi's `anthropic`, `openai-codex`, `github-copilot`, `kimi-coding`, `openrouter`, `xai`, `meta`, and `radius` OAuth providers. `listPiOAuthProviders` discovers available descriptors; `createPiOAuthAdapter` maps shared prompts, notices, cancellation, credential validation, refresh, and request-auth resolution. Radius has no static `models.dev` binding; its models must come from its live Pi provider. Its credential envelope binds the provider ID while retaining all provider-specific Pi credential fields.

A trusted host can pass provider objects from `builtinProviders()` in `@earendil-works/pi-ai/providers/all` to this bridge. Store each returned credential envelope securely by account, serialize refreshes for that account, and persist rotated credentials before using `toAuth()`. Forward login notices and prompts to the UI without sending credentials there. `availableModelIds()` applies Pi's credential-specific model filter so the host can populate the account's visible model list; refresh dynamic Pi catalogs before reading them. The host remains responsible for inference transport.
