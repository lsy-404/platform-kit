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

The host owns model availability, secret persistence, account removal and routing policy. OAuth switches, independent credential weights, and cooldowns are handled by `@model-auth/core`. Removing a local credential is not a claim of vendor-side revocation.

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

## Ollama web session and usage

`authorizeOllamaWeb` opens `ollama.com/signin`, waits for the host to observe the authenticated browser cookie, and verifies the session by reading the first-party settings page. `queryOllamaUsage` and `parseOllamaSettings` expose plan and usage information without returning the cookie. The cookie callback and persistence remain host-owned.

## Dynamic authentication and generic requests

Hosts may expose `ProviderAuthPrompt` and `ProviderAuthNotice` events through the core adapter interaction to support device codes, browser URLs, selections, and manual codes. The same adapter boundary contains generic `logout`, `request`, `stream`, and `queryUsage` callbacks; provider secrets never appear in `CredentialMetadata`, Vue state, or usage snapshots.

## Pi OAuth bridge

`@model-auth/providers/pi` adapts a host-provided Pi provider OAuth object and imports neither Pi, Pine, nor credential storage. It supports Pi's built-in `github-copilot`, `kimi-coding`, and `openrouter` providers. `listPiOAuthProviders` discovers available descriptors; `createPiOAuthAdapter` maps shared prompts, notices, cancellation, credential validation, refresh, and request-auth resolution. Its credential envelope binds the provider ID while retaining all provider-specific Pi credential fields.
