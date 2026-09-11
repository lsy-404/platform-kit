# Platform Kit

Apache-2.0 theme and public AI access packages, distributed directly through this repository's GitHub Releases.

| Package | Contents |
| --- | --- |
| `@platform-kit/fluent` | Native Fluent themes, Vue controls, navigation and overlays |
| `@platform-kit/ui-tokens` | Lightweight CSS theme variables |
| `@model-auth/core` | Framework-neutral provider access, credential routing, authentication interaction and usage contracts |
| `@model-auth/providers` | Host-side provider authentication, requests, streams and usage queries for OpenAI, Anthropic, WorkBuddy, Trae, Grok and Ollama |
| `model-auth-native` | Rust browser authentication for OpenAI and Anthropic; host-owned credential storage |
| `@model-auth/vue` | Vue provider connection, dynamic authentication and usage interface/custom element |

## Install

Use public release archive URLs in `package.json`. No private registry token or global registry replacement is required. Consumers may choose their own dependency alias:

```json
{
  "dependencies": {
    "@lsypkg/fluent": "https://github.com/lsy-404/platform-kit/releases/download/v0.5.0/platform-kit-fluent-0.2.1.tgz",
    "@model-auth/core": "https://github.com/lsy-404/platform-kit/releases/download/v0.5.0/model-auth-core-0.5.0.tgz",
    "@model-auth/providers": "https://github.com/lsy-404/platform-kit/releases/download/v0.5.0/model-auth-providers-0.5.0.tgz",
    "@model-auth/vue": "https://github.com/lsy-404/platform-kit/releases/download/v0.5.0/model-auth-vue-0.5.0.tgz"
  }
}
```

Public npm dependencies such as Vue and tough-cookie continue to resolve from the consumer's normal npm registry.

Rust hosts use the native crate from the same release:

```toml
model-auth-native = { git = "https://github.com/lsy-404/platform-kit", tag = "v0.5.0" }
```

The release also includes `model-auth-native-0.5.0.crate`. See [native authentication](model-auth/rust/README.md) for the backend API.

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
pnpm pack:release
node test/release-consumer.mjs
```

See [Fluent](styles/fluent/README.md) and [AI access](model-auth/README.md) for their APIs. Provider authentication and usage queries run in a trusted host; credentials and API keys never belong in this repository.

Pushing a version tag runs the same verification pipeline and publishes `.tgz` archives with SHA-256 checksums. Third-party dependencies retain their own licenses; applicable bundled-code notices ship with the corresponding package.

## License

[Apache License 2.0](LICENSE).
