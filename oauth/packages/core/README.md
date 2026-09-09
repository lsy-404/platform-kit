# @model-auth/core

Framework-neutral model authentication primitives. The package parses host-fetched `models.dev` snapshots, keeps OAuth/API-key metadata free of secrets, and routes eligible credentials with round-robin, weighted round-robin, or failover policies.

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

OAuth authorization uses the providers package in the trusted host. API-key validation, secret storage and model requests remain host responsibilities. See the local integration guides for adapter boundaries.
