# @model-auth/providers

Real provider authorization for trusted desktop host processes. Never import this package into a renderer or send its credentials through renderer IPC.

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
