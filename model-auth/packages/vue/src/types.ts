export type AuthMethod = "oauth" | "api-key";
export type ProviderAuthType = "oauth" | "api_key";
export type CredentialKind = AuthMethod;
export interface ModelConnectionTarget { providerId: string; method: AuthMethod }
export type LoadStrategy = "round-robin" | "failover";
export type Theme = "system" | "light" | "dark";

export type CredentialExtendValue = string | number | boolean | null;
export type CredentialExtend = Readonly<Record<string, CredentialExtendValue>>;

export type ProviderAuthPrompt =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: { id: string; label: string; description?: string }[] };

export type ProviderAuthNotice =
  | { type: "info" | "message"; message: string; links?: { label: string; url: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "progress"; message: string };

export type ProviderAuthEvent =
  | { type: "provider-auth-prompt"; loginId: string; promptId: string; prompt: ProviderAuthPrompt }
  | { type: "provider-auth-notice"; loginId: string; notice: ProviderAuthNotice };

export interface ProviderAuthResponseRequest {
  loginId: string;
  promptId: string;
  value: string;
}

export interface ProviderAuthState {
  status: "idle" | "running" | "complete" | "error";
  loginId: string | null;
  notices: ProviderAuthNotice[];
  prompt: { promptId: string; prompt: ProviderAuthPrompt } | null;
  error: string | null;
}

export interface CredentialUsageWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  remainingPercent?: number | null;
  resetAt: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: string | null;
}

export type CredentialUsageEstimateSource = "configured" | "learned" | "unknown";
export type CredentialUsageEstimateUnit = "tokens" | "requests";

export interface CredentialUsageEstimate {
  provider: string;
  account: string;
  windowHours: number;
  unit: CredentialUsageEstimateUnit | null;
  windowTokens: number;
  windowRequests: number;
  windowUsage: number;
  limitEstimate: number | null;
  remainingRatio: number | null;
  remainingPercent: number | null;
  confidence: CredentialUsageEstimateSource;
  lowConfidence: boolean;
  observations: number;
  nextResetAt: number | null;
}

export interface CredentialUsage {
  providerId: string;
  credentialId: string;
  status: "ok" | "unknown" | "error";
  plan: string | null;
  planMultiplier?: number | null;
  billingInterval?: string | null;
  subscriptionRenewsAt?: number | null;
  subscriptionExpiresAt?: number | null;
  metadataError?: string | null;
  windows: CredentialUsageWindow[];
  balance: { amount: number; unit: string } | null;
  estimate?: CredentialUsageEstimate | null;
  fetchedAtUtc: string;
  error: string | null;
}

export interface CatalogStatus {
  state: "ready" | "loading" | "error";
  source?: "models.dev" | "cached" | "fallback";
  checkedAt?: string;
  error?: string | null;
}

export interface ProviderCredential {
  id: string;
  label: string;
  healthy: boolean;
  enabled: boolean;
  account?: string;
  models?: string[];
  cooldownUntilUtc?: string | null;
  extend?: CredentialExtend;
  secret?: string;
  usage?: CredentialUsage | null;
  login?: { username: string; passwordSaved: boolean } | null;
}

export interface ApiKeyCredential extends ProviderCredential {
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
  iconUrl?: string;
  authorizeLabel?: string;
  usageEnabled?: boolean;
  logoutEnabled?: boolean;
  accountLogin?: boolean;
  models: string[];
  oauthModels?: string[];
  apiKeyModels?: string[];
  oauthCredentials?: ProviderCredential[];
  apiKeyCredentials?: ApiKeyCredential[];
}

export interface AddApiKeyPayload { providerId: string; label: string; apiKey: string; extend?: CredentialExtend }
export interface CredentialLoginInput { username: string; password?: string }
export interface CredentialUpdatePayload { providerId: string; credentialId: string; enabled: boolean; extend?: CredentialExtend; secret?: string; label?: string; login?: CredentialLoginInput | null }
export interface CredentialReorderPayload { providerId: string; method: AuthMethod; credentialIds: string[] }
export interface ProviderUpdatePayload { providerId: string; oauthEnabled: boolean }
export interface StrategyUpdatePayload { providerId: string; strategy: LoadStrategy }
