export type AuthMethod = "oauth" | "api-key";
export type CredentialKind = AuthMethod;
export interface ModelConnectionTarget { providerId: string; method: AuthMethod }
export type LoadStrategy = "round-robin" | "weighted-round-robin" | "failover";
export type Theme = "system" | "light" | "dark";

export interface CatalogStatus {
  state: "ready" | "loading" | "error";
  source?: "models.dev" | "cached" | "fallback";
  checkedAt?: string;
  error?: string | null;
}

export interface OAuthCredential {
  id: string;
  label: string;
  healthy: boolean;
  enabled: boolean;
  weight: number;
  account?: string;
  models?: string[];
  cooldownUntilUtc?: string | null;
}

export interface ApiKeyCredential extends OAuthCredential {
  models: string[];
}

export interface ModelAuthProvider {
  id: string;
  name: string;
  description: string;
  authMethods: AuthMethod[];
  available: boolean;
  unavailableReason?: string | null;
  oauthEnabled?: boolean;
  loadStrategy?: LoadStrategy;
  mark?: string;
  authorizeLabel?: string;
  models: string[];
  oauthModels?: string[];
  apiKeyModels?: string[];
  oauthCredentials?: OAuthCredential[];
  apiKeyCredentials?: ApiKeyCredential[];
}

export interface ModelAuthSelection { providerId: string; model: string }
export interface AddApiKeyPayload { providerId: string; label: string; apiKey: string }
export interface CredentialUpdatePayload { providerId: string; credentialId: string; enabled: boolean; weight: number }
export interface ProviderUpdatePayload { providerId: string; oauthEnabled: boolean }
export interface StrategyUpdatePayload { providerId: string; strategy: LoadStrategy }
