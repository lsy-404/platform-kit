# @model-auth/vue

Complete three-step model connection dialog with a default WinUI theme.

```ts
import { ModelAuthDialog } from "@model-auth/vue";
import { registerModelAuthElement } from "@model-auth/vue/custom-element";
```

The Vue entry includes styles. The standalone entry bundles Vue and Shadow DOM styles. Pass `styled=false` as a property to disable the theme, or override CSS variables, `::part()` and Vue slots.

Credentials remain in the host. Handle OAuth/API-key events and update the controlled provider data after operations succeed. See the local [UI contract](../../docs/ui.md).

Licensed under Apache-2.0. The standalone custom-element bundle includes Vue; see THIRD-PARTY.md.
