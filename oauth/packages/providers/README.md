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

## TRAE Enterprise CLI

```ts
import { TraeProvider } from "@model-auth/providers/trae";

const trae = new TraeProvider({ session: { homeDir: appOwnedTraeDirectory } });
await trae.login(signal);
const result = await trae.execute({ prompt, tools, signal });
await trae.logout(signal);
```

Install the official `traecli` separately. `TRAE_HOME` isolates the application's configuration/runtime directory without changing HOME. `status()` distinguishes a missing executable from a logged-out session; login and logout verify the resulting status. Execution returns only `{ assistantText, toolCalls }`, never raw CLI diagnostics. Tool calls are proposals for the host to validate and execute, not an authorization to bypass its approval rules.

The official CLI requires a TRAE Enterprise flagship subscription; personal subscriptions are not claimed as supported. The adapter reports `accountProfilesSupported: false`: use one application-owned session until vendor account isolation can be verified. Omitting `model` uses the CLI's own default; this is not a models.dev model entry. Do not display guessed model names.

The implementation has process and contract tests. Verify CLI login and inference separately with an actual binary in the target host environment.

Apache-2.0. See LICENSE and THIRD-PARTY.md.
