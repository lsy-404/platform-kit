# Architecture

`model-auth` separates metadata, trusted authorization, and presentation.

## Core

`@model-auth/core` is framework-neutral. The host fetches a `models.dev` payload and passes it to `parseModelsDevPayload`; the core parser filters unusable providers and models and returns a stable catalog. `CatalogCache` can retain a cached or fallback snapshot while a live refresh runs. The core package does not fetch the source, persist credentials, open browsers, or call provider APIs.

Credentials are non-secret metadata: an opaque host-owned ID, provider and authentication method, enabled state, independent weight, allowed model IDs, and health state. `CredentialRouter` selects eligible credentials by provider and model using `round-robin`, `weighted-round-robin`, or stable-order `failover`. Enabled state and weight are independent: disabling a credential does not change its weight, and changing weight does not enable it.

Use an explicit runtime binding when a host provider is not named exactly like its `models.dev` provider. `bindRuntimeProviders` accepts a catalog provider ID and an optional `includeModel` predicate, so one catalog entry can safely serve several host-specific runtime providers.

## Native Vue integration

`@model-auth/vue` is the Vue-facing layer. In a complete host integration, the Vue flow is:

1. Two entry cards: OAuth or API key.
2. A searchable, single-column provider list filtered by the selected method.
3. Provider credential and model configuration, with enabled and weight controlled independently.

The host supplies the catalog, existing metadata, and callbacks. OAuth actions invoke the shared provider implementation in a trusted host, store tokens securely, and return only non-secret metadata. API-key actions likewise validate and store the key in the host boundary. Closing the dialog aborts an active authorization through `execute(action, { signal })`; host IPC must propagate cancellation.

## Trusted authorization

`@model-auth/providers` contains OpenAI, Anthropic, WorkBuddy and Trae authorization. OpenAI and Anthropic share PKCE, bounded loopback callback handling and renewable-token validation. WorkBuddy uses state issuance, a validated browser login URL, a private cookie jar, bounded token polling, profile lookup, and renewable tokens. Redirects never receive credential headers, and errors contain only safe codes. Account IDs, encrypted persistence, and pool routing remain host-owned. Use the same credential ID for renewal, reconnect, request routing, and removal.

The package is not renderer-safe: import it only in the Electron main process or a trusted service. Native hosts use the Rust library in `oauth/rust` and keep browser opening, encrypted storage and cancellation wiring in their backend.

## Standalone Custom Element

The Custom Element entry is for hosts that do not use Vue. It presents the same host contract as a web component and can be mounted beside a native Vue application. Keep the actual OAuth callback, secret storage, API transport, and adapter state in the host; the element is not a credential vault.

The Vue entry exports `ModelAuthDialog`, messages and public types, and includes its stylesheet. The standalone entry exports `registerModelAuthElement` and bundles Vue plus inline Shadow DOM styles. Both expose the same controlled state and events.

## Host boundary

The boundary is one-way for secrets. A host adapter may receive secrets internally, but `ProviderAdapterHost.authorize()` and `refresh()` must return sanitized metadata. `createOpenAIAdapter`, `createAnthropicAdapter`, `createWorkBuddyAdapter` and `createTraeAdapter` validate that metadata against their capability descriptors; they do not know OAuth endpoints, API-key formats, browser APIs, or keychain APIs.
