# Platform Kit

Apache-2.0 theme and OAuth packages, distributed directly through this repository's GitHub Releases.

| Package | Contents |
| --- | --- |
| `@platform-kit/fluent` | Native Fluent themes, Vue controls, navigation and overlays |
| `@platform-kit/ui-tokens` | Lightweight CSS theme variables |
| `@model-auth/core` | Authentication state, credential routing and provider contracts |
| `@model-auth/providers` | Complete host-side WorkBuddy and Trae authorization adapters |
| `@model-auth/vue` | Vue authentication interface and custom element |

## Install

Use public release archive URLs in `package.json`. No private registry token or global registry replacement is required. Consumers may choose their own dependency alias:

```json
{
  "dependencies": {
    "@lsypkg/fluent": "https://github.com/lsy-404/platform-kit/releases/download/v0.2.0/platform-kit-fluent-0.2.0.tgz",
    "@model-auth/core": "https://github.com/lsy-404/platform-kit/releases/download/v0.2.0/model-auth-core-0.3.0.tgz",
    "@model-auth/providers": "https://github.com/lsy-404/platform-kit/releases/download/v0.2.0/model-auth-providers-0.3.0.tgz",
    "@model-auth/vue": "https://github.com/lsy-404/platform-kit/releases/download/v0.2.0/model-auth-vue-0.3.0.tgz"
  }
}
```

Public npm dependencies such as Vue and tough-cookie continue to resolve from the consumer's normal npm registry.

## Develop

Node.js 24 and pnpm 10.17.1 are used in CI.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir oauth install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack:release
node test/release-consumer.mjs
```

See [Fluent](styles/fluent/README.md) and [OAuth](oauth/README.md) for their APIs. The OAuth providers require host-owned browser authorization and credential storage; credentials never belong in this repository.

Pushing a version tag runs the same verification pipeline and publishes `.tgz` archives with SHA-256 checksums. Third-party dependencies retain their own licenses; applicable bundled-code notices ship with the corresponding package.

## License

[Apache License 2.0](LICENSE).
