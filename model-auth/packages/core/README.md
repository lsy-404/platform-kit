# @model-auth/core

Framework-neutral AI provider access primitives. The package parses host-fetched `models.dev` snapshots, keeps authentication metadata free of secrets, routes eligible credentials, validates per-key `extend` fields, and defines request, stream, dynamic-authentication, and usage contracts. Usage contracts can carry provider windows plus host-owned token/request estimates with confidence and unrounded remaining percentages.

```ts
import { CredentialRouter, createCredentialMetadata } from "@model-auth/core";

const credential = createCredentialMetadata({
  id: "workbuddy-account-1",
  providerId: "workbuddy",
  authMethod: "api-key",
  modelIds: ["glm-5.2"],
  weight: 1,
});
const router = new CredentialRouter([credential], { strategy: "failover" });
const [candidate] = router.candidates({ providerId: "workbuddy", modelId: "glm-5.2" });
```

The host looks up the secret by `candidate.id`; no secret is passed to this package.

Provider authentication uses the providers package in the trusted host. API-key validation, secret storage, request transport, and browser/session control remain host responsibilities. See the local integration guides for adapter boundaries.
