# Architecture

`model-auth` separates provider metadata, trusted authentication/request transport, usage inspection, and presentation.

## Core

`@model-auth/core` is framework-neutral. The host fetches a `models.dev` payload and passes it to `parseModelsDevPayload`; the core parser filters unusable providers and models and returns a stable catalog. `CatalogCache` can retain a cached or fallback snapshot while a live refresh runs. The core package does not fetch the source, persist credentials, open browsers, or call provider APIs.

Usage snapshots expose validated provider windows, balances, and an optional `ProviderUsageEstimate`. The estimate carries observed token/request amounts, configured or learned limit data, confidence, and both a 0..1 `remainingRatio` and an unrounded 0..100 `remainingPercent`. Hosts attach estimates from their own transcript or request history; an unknown limit remains `null`.

Credentials are non-secret metadata: an opaque host-owned ID, provider and authentication method, enabled state, independent weight, allowed model IDs, health state, and a validated scalar `extend` object for non-sensitive per-key context. `CredentialRouter` selects eligible credentials by provider and model using `round-robin`, `weighted-round-robin`, or stable-order `failover`. Enabled state and weight are independent: disabling a credential does not change its weight, and changing weight does not enable it.

Use an explicit runtime binding when a host provider is not named exactly like its `models.dev` provider. `bindRuntimeProviders` accepts a catalog provider ID and an optional `includeModel` predicate, so one catalog entry can safely serve several host-specific runtime providers.

## Native Vue integration

`@model-auth/vue` is the Vue-facing layer. In a complete host integration, the Vue flow is:

1. Two entry cards: browser authentication or API key.
2. A searchable, single-column provider list filtered by the selected method.
3. Provider credential and model configuration, with enabled and weight controlled independently.

The host supplies the catalog, existing metadata, and callbacks. Authentication actions invoke the shared provider implementation in a trusted host, store secrets securely, and return only non-secret metadata. Dynamic provider flows use `ProviderAuthPrompt`/`ProviderAuthNotice` events, so device codes, URLs, selections, and manual codes do not require a provider-specific UI. API-key actions likewise validate and store the key in the host boundary. Closing the dialog aborts an active authorization through `execute(action, { signal })`; host IPC must propagate cancellation.

## Trusted authorization

`@model-auth/providers` contains OpenAI, Anthropic, WorkBuddy, Trae, Grok and Ollama access. OpenAI, Anthropic and Grok share PKCE, bounded loopback callback handling and renewable-token validation. WorkBuddy uses state issuance, a validated browser login URL, a private cookie jar, bounded token polling, profile lookup, and renewable tokens. Ollama opens its first-party sign-in page and polls a host-provided browser session before reading the authenticated settings page. Redirects never receive credential headers, and errors contain only safe codes. Account IDs, encrypted persistence, request transport, and pool routing remain host-owned. Use the same credential ID for renewal, reconnect, request routing, usage queries, and removal.

The package is not renderer-safe: import it only in the Electron main process or a trusted service. Native hosts use the Rust library in `model-auth/rust` and keep browser opening, encrypted storage and cancellation wiring in their backend.

## Standalone Custom Element

The Custom Element entry is for hosts that do not use Vue. It presents the same host contract as a web component and can be mounted beside a native Vue application. Keep the actual OAuth callback, secret storage, API transport, and adapter state in the host; the element is not a credential vault.

The Vue entry exports `ModelAuthDialog`, messages and public types, and includes its stylesheet. The standalone entry exports `registerModelAuthElement` and bundles Vue plus inline Shadow DOM styles. Both expose the same controlled state and events.

## Host boundary

The boundary is one-way for secrets. A host adapter may receive secrets internally, but `ProviderAdapterHost.authorize()` and `refresh()` must return sanitized metadata. `request`, `stream`, and `queryUsage` stay in the trusted host; usage results are non-secret windows/balances and are validated before crossing the adapter boundary. `createOpenAIAdapter`, `createAnthropicAdapter`, `createWorkBuddyAdapter`, `createTraeAdapter`, and `createGrokAdapter` validate metadata against their capability descriptors; they do not know provider keychain APIs or renderer APIs.
