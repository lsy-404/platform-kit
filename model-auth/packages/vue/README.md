# @model-auth/vue

Persistent connection information and a separate authorization dialog, with a default Fluent-style theme.

```ts
import { ModelConnectionPanel, ModelAuthDialog, useModelAuth } from "@model-auth/vue";
import { registerModelConnectionPanelElement, registerModelAuthElement } from "@model-auth/vue/custom-element";
```

Pass the host state to `ModelConnectionPanel` (`providers`, `busy`, `error`). Its `manage` event carries `{ providerId, method }`; pass that value as `ModelAuthDialog.initialConnection` to open the saved connection directly. The `add` event opens the dialog with `initialConnection: null`. Handle `refresh` by reloading host state. Custom-element events carry Vue argument arrays in `event.detail`.

Load saved state when the host page mounts and update it after account operations. The panel keeps disabled, unhealthy and temporarily unavailable connections visible. The information dialog exposes safe account metadata, models, status, order and routing strategy; management actions remain in this view instead of advancing through the authorization wizard.

Credentials remain in the host. Handle authentication/API-key events and update controlled provider data after operations succeed. Dynamic provider prompts and notices are exposed through `auth` state and the `respond-auth`/`cancel-auth` events. `ProviderCredential.secret` is optional host-supplied text (an API key, or the host's serialised OAuth token information) that the dialog shows in plain text by default, with a hide toggle and a Save button that emits `update-credential` with the new `secret`. The host owns persistence and chooses whether to supply it; never render it elsewhere, log it, or place it in `extend`, which is for non-sensitive scalar context. `ModelConnectionPanel` never shows secrets.

The Vue entry includes styles. The standalone entry bundles Vue and Shadow DOM styles. Pass `styled=false` to disable the theme, or override CSS variables, `::part()` and Vue slots.

`ModelAuthDialog` accepts `percentagePrecision`: `0` shows whole percentages, `-1` keeps the full meaningful decimal representation, and any other non-negative integer sets fixed decimal places. The default is `2`.

Licensed under Apache-2.0. The standalone custom-element bundle includes Vue and both bundles include provider icons and Microsoft Fluent UI System Icons for controls (baked in at build time, no runtime dependency); see THIRD-PARTY.md.

Each connection card in the panel expands to list its models, and the connection details show the same list: the union of the provider's method models (or catalog models) and the models of its saved credentials. The list is read-only with a search field for long lists; there is no selected or current model, so hosts choose models themselves.

Provider icons for known ids are bundled as inline SVG and never fetched. `ModelAuthProvider.iconUrl` overrides the built-in icon (http(s) or same-origin only); unknown providers show a letter mark.

New connections start with one searchable provider list. Each entry identifies its OAuth or Key method. For a provider with `accountLogin: true`, each API key can include an optional `login` payload for host-side usage queries. Return only `username` and `passwordSaved` in the credential view; keep the password in the host's encrypted store.
