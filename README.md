# Platform Kit

Apache-2.0 theme and OAuth packages, distributed directly through this repository's GitHub Releases.

| Package | Contents |
| --- | --- |
| `@platform-kit/fluent` | Native Fluent themes, Vue controls, navigation and overlays |
| `@platform-kit/ui-tokens` | Lightweight CSS theme variables |
| `@model-auth/core` | Authentication state, credential routing and provider contracts |
| `@model-auth/providers` | Host-side OpenAI, Anthropic, WorkBuddy and Trae browser OAuth |
| `model-auth-native` | Rust browser OAuth for OpenAI and Anthropic; host-owned credential storage |
| `@model-auth/vue` | Vue authentication interface and custom element |

## Install

Use public release archive URLs in `package.json`. No private registry token or global registry replacement is required. Consumers may choose their own dependency alias:

```json
{
  "dependencies": {
    "@lsypkg/fluent": "https://github.com/lsy-404/platform-kit/releases/download/v0.4.0/platform-kit-fluent-0.2.1.tgz",
    "@model-auth/core": "https://github.com/lsy-404/platform-kit/releases/download/v0.4.0/model-auth-core-0.4.0.tgz",
    "@model-auth/providers": "https://github.com/lsy-404/platform-kit/releases/download/v0.4.0/model-auth-providers-0.4.0.tgz",
    "@model-auth/vue": "https://github.com/lsy-404/platform-kit/releases/download/v0.4.0/model-auth-vue-0.4.2.tgz"
  }
}
```

Public npm dependencies such as Vue and tough-cookie continue to resolve from the consumer's normal npm registry.

Rust hosts use the native crate from the same release:

```toml
model-auth-native = { git = "https://github.com/lsy-404/platform-kit", tag = "v0.4.0" }
```

The release also includes `model-auth-native-0.4.0.crate`. See [native OAuth](oauth/rust/README.md) for the backend API.

## Develop

Node.js 24 and pnpm 10.17.1 are used in CI.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir oauth install --frozen-lockfile
pnpm typecheck
pnpm test
cargo test --manifest-path test/rust/Cargo.toml --locked
pnpm build
pnpm pack:release
node test/release-consumer.mjs
```

See [Fluent](styles/fluent/README.md) and [OAuth](oauth/README.md) for their APIs. The OAuth providers require host-owned browser authorization and credential storage; credentials never belong in this repository.

Pushing a version tag runs the same verification pipeline and publishes `.tgz` archives with SHA-256 checksums. Third-party dependencies retain their own licenses; applicable bundled-code notices ship with the corresponding package.

## License

[Apache License 2.0](LICENSE).
