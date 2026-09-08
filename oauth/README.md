# Model Auth

Model Auth is an open-source workspace for model-provider discovery, OAuth and API-key connection UI, trusted provider authorization, and credential routing. It publishes `@model-auth/core`, `@model-auth/providers`, and `@model-auth/vue`.

## Verify and package

From this repository root:

```sh
pnpm --dir oauth install --frozen-lockfile
pnpm --dir oauth check
pnpm --dir oauth pack
pnpm --dir oauth test:packages
```

The pack command writes local artifacts to `oauth/release/`:

- `model-auth-core-0.3.0.tgz`
- `model-auth-providers-0.3.0.tgz`
- `model-auth-vue-0.4.1.tgz`

The package-consumer test installs those archives into a temporary consumer and verifies exports, declarations, styles, runtime behavior, and included notices.

## Boundaries

The toolkit does not contain credentials or provider binaries. Hosts own credential persistence, network authorization, provider availability, and model selection. See `docs/` and package READMEs for API contracts.

## License

Licensed under [Apache-2.0](LICENSE). See [THIRD-PARTY.md](THIRD-PARTY.md) for bundled and runtime dependency notices.
