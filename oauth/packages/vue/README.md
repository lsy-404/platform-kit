# @model-auth/vue

Persistent connection information and a separate authorization dialog, with a default Fluent-style theme.

```ts
import { ModelConnectionPanel, ModelAuthDialog, useModelAuth } from "@model-auth/vue";
import { registerModelConnectionPanelElement, registerModelAuthElement } from "@model-auth/vue/custom-element";
```

Pass the host state to `ModelConnectionPanel` (`providers`, `model`, `busy`, `error`). Its `manage` event carries `{ providerId, method }`; pass that value as `ModelAuthDialog.initialConnection` to open the saved connection directly. The `add` event opens the dialog with `initialConnection: null`. Handle `refresh` by reloading host state. Custom-element events carry Vue argument arrays in `event.detail`.

Load saved state when the host page mounts and update it after account operations. The panel keeps disabled, unhealthy and temporarily unavailable connections visible. The information dialog exposes safe account metadata, models, status, weights and routing strategy; management actions remain in this view instead of advancing through the authorization wizard.

Credentials remain in the host. Handle OAuth/API-key events and update controlled provider data after operations succeed. Never pass tokens or API-key values as connection metadata.

The Vue entry includes styles. The standalone entry bundles Vue and Shadow DOM styles. Pass `styled=false` to disable the theme, or override CSS variables, `::part()` and Vue slots.

Licensed under Apache-2.0. The standalone custom-element bundle includes Vue; see THIRD-PARTY.md.
