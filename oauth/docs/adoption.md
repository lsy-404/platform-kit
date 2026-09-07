# Adoption guide

## Integrating with a host application

Move provider discovery and credential selection into the shared flow:

1. Call `authorizeWorkBuddy` in a trusted host process with a system-browser opener and an `AbortSignal`.
2. Keep API-key validation, token refresh, revocation, and secure storage in the host.
3. Convert stored entries to `CredentialMetadata` with opaque IDs and no secrets.
4. Use `setEnabled` and `setWeight` independently when restoring preferences.
5. Route requests through `CredentialRouter` and report classified success or errors.

`createWorkBuddyAdapter` and `createTraeAdapter` remain metadata-only validation boundaries. Keep secret storage in the host and verify its adapter before release.

## Integrating models.dev

The host owns fetching and persistence. Pass cached data to `CatalogCache`, refresh it in the background, and retain the old catalog when refresh fails. Use `bindRuntimeProviders` for host IDs that differ from catalog IDs; do not rely on provider names matching.

## Host entry points

- **Vue host:** mount `ModelAuthDialog` in the renderer and map events to the host IPC service.
- **Tauri host:** mount the standalone element and map events to Tauri commands; retain OAuth, keyring and transport in the native backend.
- **Electron host:** import the standalone asset in the renderer and map events to preload methods; retain secret operations in the main process.

See [UI contract](ui.md) for all events.
