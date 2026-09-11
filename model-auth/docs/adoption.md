# Adoption guide

## Integrating with a host application

Move provider discovery and credential selection into the shared flow:

1. Call the provider package authorization function in a trusted host process with a system-browser opener and an `AbortSignal`: `authorizeOpenAI`, `authorizeAnthropic`, `authorizeWorkBuddy`, `authorizeTrae`, `authorizeGrok`, or `authorizeOllamaWeb`.
2. Keep API-key validation, refresh scheduling, revocation, and secure storage in the host. Call the matching shared refresh function for token renewal.
3. Convert stored entries to `CredentialMetadata` with opaque IDs and no secrets.
4. Use `setEnabled`, `setWeight`, and `setExtend` independently when restoring preferences. `extend` is for non-sensitive per-credential context only.
5. Route requests through `CredentialRouter` and the host request/stream callbacks, then report classified success or errors.
6. Query non-secret provider usage through `queryGrokUsage`, `queryOllamaUsage`, `queryProviderUsage`, or a host adapter's `queryUsage` callback.

`createOpenAIAdapter`, `createAnthropicAdapter`, `createWorkBuddyAdapter` and `createTraeAdapter` remain metadata-only validation boundaries. Keep secret storage in the host and verify its adapter before release.

## Integrating models.dev

The host owns fetching and persistence. Pass cached data to `CatalogCache`, refresh it in the background, and retain the old catalog when refresh fails. Use `bindRuntimeProviders` for host IDs that differ from catalog IDs; do not rely on provider names matching.

## Host entry points

- **Vue host:** mount `ModelAuthDialog` in the renderer and map events to the host IPC service.
- **Tauri host:** mount the standalone element and map events to Tauri commands; use `model-auth/rust` for shared browser authentication and retain encrypted storage and transport in the native backend.
- **Electron host:** import the standalone asset in the renderer and map events to preload methods; retain secret operations in the main process.

See [UI contract](ui.md) for all events.
