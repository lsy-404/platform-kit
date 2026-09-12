/**
 * Provider features that a host may safely expose. This describes public
 * package support only; a host must still verify its own transport and policy
 * before presenting a provider as available.
 */
export type ModelAuthProviderId = "anthropic" | "openai-codex" | "workbuddy" | "traecode" | "grok" | "ollama-cloud";
export type ProviderAuthorizationKind = "browser-oauth" | "browser-web-session";

export interface ModelAuthProviderCapability {
  readonly id: ModelAuthProviderId;
  readonly displayName: string;
  readonly authorization: {
    readonly kind: ProviderAuthorizationKind;
    readonly renewable: boolean;
    readonly multiAccount: boolean;
  };
  readonly access: {
    readonly inference: boolean;
    readonly modelCatalog: boolean;
    readonly usage: boolean;
  };
  /** Catalog ids are hints only; a host must not invent models when absent. */
  readonly catalogProviderIds: readonly string[];
  /** Primary Models.dev id for hosts that use one catalog provider per entry. */
  readonly catalogProviderId: string | null;
}

export const MODEL_AUTH_PROVIDER_CAPABILITIES: readonly ModelAuthProviderCapability[] = Object.freeze([
  { id: "anthropic", displayName: "Claude", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true }, catalogProviderIds: ["anthropic"], catalogProviderId: "anthropic" },
  { id: "openai-codex", displayName: "Codex", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true }, catalogProviderIds: ["openai", "openai-codex"], catalogProviderId: "openai" },
  { id: "workbuddy", displayName: "WorkBuddy", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false }, catalogProviderIds: ["zhipuai", "tencent-tokenhub", "deepseek"], catalogProviderId: "zhipuai" },
  { id: "traecode", displayName: "TRAE", authorization: { kind: "browser-oauth", renewable: true, multiAccount: false }, access: { inference: true, modelCatalog: true, usage: false }, catalogProviderIds: [], catalogProviderId: null },
  { id: "grok", displayName: "Grok", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true }, catalogProviderIds: ["xai"], catalogProviderId: "xai" },
  { id: "ollama-cloud", displayName: "Ollama", authorization: { kind: "browser-web-session", renewable: false, multiAccount: false }, access: { inference: false, modelCatalog: false, usage: true }, catalogProviderIds: ["ollama"], catalogProviderId: "ollama" },
]);

const BY_ID = new Map(MODEL_AUTH_PROVIDER_CAPABILITIES.map((capability) => [capability.id, capability]));

export function modelAuthProviderCapability(id: string): ModelAuthProviderCapability | null {
  return BY_ID.get(id as ModelAuthProviderId) ?? null;
}
