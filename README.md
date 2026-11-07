# Platform Kit

Apache-2.0 theme and public AI access packages, distributed directly through this repository's GitHub Releases.

**Fluent preview:** [showcase](https://lsy-404.github.io/platform-kit/) · [control catalog](https://lsy-404.github.io/platform-kit/catalog.html) — deployed to GitHub Pages from `main` and every `fluent-v*` release.

| Package | Contents |
| --- | --- |
| `@platform-kit/fluent` | Native Fluent themes, Vue controls, navigation and overlays; [usage](styles/fluent/README.md), [preview](https://lsy-404.github.io/platform-kit/) |
| `@platform-kit/visual-center` | Background-aware pixel/SVG centroid estimates; [usage](tooling/visual-center/README.md) |
| `@platform-kit/ui-tokens` | Lightweight CSS theme variables |
| `@platform-kit/toast` | Transient notifications with Vue and framework-free hosts; [usage](styles/toast/README.md) |
| `@platform-kit/liquid-glass` | Liquid glass appearance pack: a rim-refracting lens with surface and field materials; [usage](styles/liquid-glass/README.md) |
| `@platform-kit/appearance-check` | Development-time appearance checks with stable IDs, optional DESIGN.md token baselines, CLI and Vite build warnings; [usage](tooling/appearance-check/README.md) |
| `@platform-kit/ffmpeg-lgpl` | LGPL-2.1-or-later FFmpeg executable for audio decoding and AAC encoding on five desktop targets; [usage](tooling/ffmpeg-lgpl/README.md) |
| `@model-auth/core` | Framework-neutral provider access, credential routing, authentication interaction and usage contracts |
| `@model-auth/providers` | Host-side provider authentication, requests, streams and usage queries for OpenAI, Anthropic, WorkBuddy, Trae, Grok, Ollama and OpenCode Go |
| `model-auth-native` | Rust browser authentication for OpenAI and Anthropic; host-owned credential storage |
| `@model-auth/vue` | Vue provider connection, dynamic authentication and usage interface/custom element |

## Install

Use public release archive URLs in `package.json`. No private registry token or global registry replacement is required. Consumers may choose their own dependency alias:

```json
{
  "dependencies": {
    "@lsypkg/fluent": "https://github.com/lsy-404/platform-kit/releases/download/fluent-v0.3.2/platform-kit-fluent-0.3.2.tgz",
    "@model-auth/core": "https://github.com/lsy-404/platform-kit/releases/download/model-auth-core-v0.11.1/model-auth-core-0.11.1.tgz",
    "@model-auth/providers": "https://github.com/lsy-404/platform-kit/releases/download/model-auth-providers-v0.24.3/model-auth-providers-0.24.3.tgz",
    "@model-auth/vue": "https://github.com/lsy-404/platform-kit/releases/download/model-auth-vue-v0.14.2/model-auth-vue-0.14.2.tgz"
  }
}
```

Public npm dependencies such as Vue and tough-cookie continue to resolve from the consumer's normal npm registry.

Rust hosts use the package-specific native release:

```toml
model-auth-native = { git = "https://github.com/lsy-404/platform-kit", tag = "model-auth-native-v0.6.1" }
```

The `model-auth-native-v0.6.1` release includes `model-auth-native-0.6.1.crate`. See [native authentication](model-auth/rust/README.md) for the backend API.

## Develop

Node.js 24 and pnpm 10.17.1 are used in CI.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir model-auth install --frozen-lockfile
pnpm typecheck
pnpm test
cargo test --manifest-path test/rust/Cargo.toml --locked
pnpm build
pnpm run pack:release
node test/release-consumer.mjs
```

See [Fluent](styles/fluent/README.md) and [AI access](model-auth/README.md) for their APIs. Provider authentication and usage queries run in a trusted host; credentials and API keys never belong in this repository.

Pushing a package tag such as `fluent-v0.3.2` runs the same verification pipeline and publishes only that package archive with a package-specific SHA-256 checksum. The generated `release/` directory groups archives as `release/<package-name>/<package-name>-<version>.*`; package archive basenames remain unchanged. There is no root `platform-kit` release version or main release tag. Third-party dependencies retain their own licenses; applicable bundled-code notices ship with the corresponding package.

## Feedback

This repository does not accept code contributions; pull requests are limited to maintainers. Bug reports and suggestions are welcome through [Issues](https://github.com/lsy-404/platform-kit/issues/new/choose). See [CONTRIBUTING](CONTRIBUTING.md) for what to include, and [SECURITY](SECURITY.md) for credential exposure.

## License

[Apache License 2.0](LICENSE).
