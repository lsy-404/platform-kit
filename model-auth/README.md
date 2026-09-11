# Model Auth

Model Auth is an open-source workspace for model-provider discovery, provider authentication, requests, streams, usage queries, per-credential metadata, and routing. It publishes `@model-auth/core`, `@model-auth/providers`, and `@model-auth/vue`.

## Verify and package

From this repository root:

```sh
pnpm --dir model-auth install --frozen-lockfile
pnpm --dir model-auth check
pnpm --dir model-auth pack
pnpm --dir model-auth test:packages
```

The pack command writes local artifacts to `model-auth/release/`:

- `model-auth-core-0.5.2.tgz`
- `model-auth-providers-0.5.2.tgz`
- `model-auth-vue-0.5.2.tgz`

The package-consumer test installs those archives into a temporary consumer and verifies exports, declarations, styles, runtime behavior, and included notices.

## Boundaries

The toolkit does not contain credentials or provider binaries. The providers package implements trusted-host authentication and provider access for OpenAI, Anthropic, WorkBuddy, Trae, Grok and Ollama. Hosts own secure credential persistence, browser opening, provider availability and request transport. See `docs/` and package READMEs for API contracts.

## License

Licensed under [Apache-2.0](LICENSE). See [THIRD-PARTY.md](THIRD-PARTY.md) for bundled and runtime dependency notices.
