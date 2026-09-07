# UI contract

Import `ModelAuthDialog` from `@model-auth/vue`; its default stylesheet is loaded by the package entry. The component is controlled: update its props after the host operation completes.

## Shared processing

`useModelAuth(host)` owns busy/error state, prevents duplicate mutations and reloads the host snapshot after each successful action. Implement two host methods: `getState()` returns providers, selected model and catalog status; `execute(action)` performs the requested operation. Its action union is exported as `ModelAuthAction`.

```vue
<script setup lang="ts">
import { ModelAuthDialog, useModelAuth, type ModelAuthHost } from "@model-auth/vue";
const { host } = defineProps<{ host: ModelAuthHost }>();
const { open, props: dialogProps, listeners, refresh } = useModelAuth(host);
function show() { open.value = true; void refresh(); }
</script>
<template>
  <button @click="show">添加连接</button>
  <ModelAuthDialog v-bind="dialogProps" v-on="listeners" />
</template>
```

The same composable can be used in each Vue host. It never logs action payloads and uses a generic user-facing error instead of exposing a raw exception.

## Props

| Prop | Default | Purpose |
| --- | --- | --- |
| `open` | false | Show the dialog |
| `providers` | [] | Available methods, models and credential metadata |
| `styled` | true | Enable default WinUI appearance |
| `theme` | system | system, light or dark |
| `model` | null | Selected providerId and model |
| `loadStrategy` | round-robin | Default strategy; each provider may override it |
| `catalogStatus` | loading | state, source, checkedAt and error |
| `busy` | false | Lock mutation controls while a host operation runs |
| `error` | null | Sanitized host error shown in the dialog |
| `messages` | Chinese defaults | Override any visible string |

An available provider can support OAuth, API keys or both. `oauthEnabled=false` disables the provider's OAuth independently of its individual credential preferences. Each credential has `enabled`, `weight` and health state. Supply discovered `models` on credentials to restrict eligibility; only explicitly healthy and enabled credentials can expose models for selection.

## Events

| Event | Arguments |
| --- | --- |
| `close` | none |
| `refresh-catalog` | none |
| `authorize-oauth` | providerId |
| `reconnect-oauth` | providerId, credentialId |
| `remove-oauth` / `remove-api-key` | providerId, credentialId |
| `add-api-key` | { providerId, label, apiKey } |
| `update-credential` | { providerId, credentialId, enabled, weight } |
| `update-provider` | { providerId, oauthEnabled } |
| `select-model` | { providerId, model } |
| `update-provider-strategy` | { providerId, strategy } |
| `update-strategy` | strategy; use for hosts with one shared strategy |

Use either strategy event according to your host's settings model. For provider-specific preferences, persist the result and pass `provider.loadStrategy` back. Apply the same preference with `router.setStrategy(strategy, providerId)`. Apply OAuth policy with `router.setProviderOAuthEnabled(providerId, enabled)`.

The API-key payload is emitted once; the input is cleared before emission. Do not log payloads. Map the event to the host's existing secure validation/storage action. Pass sanitized error text and set `busy=false` when the operation settles.

## Standalone element

```js
import { registerModelAuthElement } from "./model-auth-element.js";
registerModelAuthElement();
const dialog = document.createElement("model-auth-dialog");
dialog.providers = hostProviderSnapshot;
dialog.open = true;
dialog.theme = "dark";
dialog.addEventListener("close", () => { dialog.open = false; });
dialog.addEventListener("authorize-oauth", async event => {
  const [providerId] = event.detail;
  dialog.busy = true;
  try {
    await host.authorize(providerId);
    dialog.providers = await host.providers();
    dialog.error = null;
  } catch {
    dialog.error = "授权未完成，请重试。";
  } finally {
    dialog.busy = false;
  }
});
document.body.append(dialog);
```

Custom Element events carry the Vue event arguments as an array in `event.detail`. Assign objects and booleans as JavaScript properties, not serialized HTML attributes. The standalone asset includes Vue and Shadow DOM styles.

## Overrides

`styled=false` removes the default appearance, while structure, keyboard controls and events remain active. The theme never modifies page-global tokens.

Public CSS variables: `--model-auth-accent`, `--model-auth-accent-text`, `--model-auth-text`, `--model-auth-muted`, `--model-auth-surface`, `--model-auth-control`, `--model-auth-subtle`, `--model-auth-line`, `--model-auth-danger`, `--model-auth-success`, `--model-auth-radius`, `--model-auth-z-index`.

Shadow parts include `backdrop`, `dialog`, `header`, `back`, `close`, `method-card`, `search`, `catalog-status`, `provider-row`, `credential-row`, `api-key-form`, `strategy`, `strategy-menu`, `models` and `model-row`.

Vue scoped slots:

- `method-card`: method and choose; rendered inside the navigation button.
- `provider-row`: provider and method; rendered inside the provider button.
- `credential-row`: credential, provider, method, update(enabled, weight), remove; replaces the complete row content.
- `model-row`: model and provider; rendered inside the model button.
- `footer`: step and close.

Do not place nested buttons inside button-content slots. For an entirely different UI, consume `@model-auth/core` directly.
