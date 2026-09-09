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

Use `@model-auth/providers/openai` (`authorizeOpenAI`, `refreshOpenAI`), `@model-auth/providers/anthropic` (`authorizeAnthropic`, `refreshAnthropic`), `@model-auth/providers/workbuddy`, or `@model-auth/providers/trae`. OpenAI runtime credentials use provider ID `openai-codex`; Anthropic uses `anthropic`. Their metadata adapters are `createOpenAIAdapter` and `createAnthropicAdapter`. Both receive the same `ProviderAdapterHost` contract shown below.

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

`host`, `signal`, `credentialId`, `verifiedModels`, and `hostSecureCredentialStore` above are host values. New accounts require distinct IDs; reconnect replaces the selected ID only. For API keys, validate and store the key in the host, then return metadata with `authMethod: "api-key"`; never put the key into `CredentialMetadata`.

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
  strategy: "weighted-round-robin",
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

Use `setEnabled` for an independent on/off control and `setWeight` for traffic share. `401`/`403` permanently isolate a credential; `429`, server errors, and transport errors use bounded cooling. `failover` preserves registration order, while the round-robin modes rotate among eligible credentials.

## Presentation contract

Present OAuth and API key as the first two cards, then replace them with a searchable single-column provider list, then show model and credential configuration for the selected provider. The host should provide the actual callback functions and a secure persistence implementation to either the native Vue integration or the standalone Custom Element. Do not imply that selecting a card has authenticated the user.
