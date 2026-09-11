import {
  createCredentialMetadata,
  createTraeAdapter,
  createWorkBuddyAdapter,
  type ProviderAdapterHost,
} from "@model-auth/core";

// These host functions are deliberately placeholders: the host implements the protocol and storage.
declare const runOAuthAndStoreTokens: (providerId: string) => Promise<void>;
declare const secureCredentialStore: { remove: (credentialId: string) => Promise<void> };

const workBuddyHost: ProviderAdapterHost = {
  async authorize() {
    await runOAuthAndStoreTokens("workbuddy");
    return createCredentialMetadata({
      id: "workbuddy-account-1",
      providerId: "workbuddy",
      authMethod: "oauth",
      modelIds: ["glm-5.2", "glm-5.1"],
      enabled: true,
      weight: 2,
    });
  },
  remove: (credentialId) => secureCredentialStore.remove(credentialId),
};

const traeHost: ProviderAdapterHost = {
  async authorize() {
    await runOAuthAndStoreTokens("traecode");
    return createCredentialMetadata({
      id: "trae-account-1",
      providerId: "traecode",
      authMethod: "oauth",
      modelIds: ["trae-account-default"],
    });
  },
  remove: (credentialId) => secureCredentialStore.remove(credentialId),
};

export const workBuddyAdapter = createWorkBuddyAdapter(workBuddyHost);
export const traeAdapter = createTraeAdapter(traeHost);
