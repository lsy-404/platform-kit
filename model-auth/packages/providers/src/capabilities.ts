export type ModelAuthProviderId = "anthropic" | "openai-codex" | "workbuddy" | "traecode" | "antigravity" | "grok" | "ollama-cloud" | "opencode-go" | "github-copilot" | "kimi-coding" | "openrouter" | "xai" | "meta" | "radius";
export type ProviderAuthorizationKind = "browser-oauth" | "browser-web-session" | "runtime-oauth" | "api-key";

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
    /** The subscription can run the provider's server-side web search. */
    readonly webSearch: boolean;
  };
  /** Catalog ids are hints only; a host must not invent models when absent. */
  readonly catalogProviderIds: readonly string[];
  /** Primary Models.dev id for hosts that use one catalog provider per entry. */
  readonly catalogProviderId: string | null;
}

export const MODEL_AUTH_PROVIDER_CAPABILITIES: readonly ModelAuthProviderCapability[] = Object.freeze([
  { id: "anthropic", displayName: "Claude", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true, webSearch: true }, catalogProviderIds: ["anthropic"], catalogProviderId: "anthropic" },
  { id: "openai-codex", displayName: "Codex", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true, webSearch: true }, catalogProviderIds: ["openai", "openai-codex"], catalogProviderId: "openai" },
  { id: "workbuddy", displayName: "WorkBuddy", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["zhipuai", "tencent-tokenhub", "deepseek"], catalogProviderId: "zhipuai" },
  { id: "traecode", displayName: "TRAE", authorization: { kind: "browser-oauth", renewable: true, multiAccount: false }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: [], catalogProviderId: null },
  { id: "antigravity", displayName: "Antigravity", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: [], catalogProviderId: null },
  { id: "grok", displayName: "Grok", authorization: { kind: "browser-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: true, webSearch: false }, catalogProviderIds: ["xai"], catalogProviderId: "xai" },
  { id: "ollama-cloud", displayName: "Ollama", authorization: { kind: "api-key", renewable: false, multiAccount: false }, access: { inference: false, modelCatalog: false, usage: true, webSearch: false }, catalogProviderIds: ["ollama"], catalogProviderId: "ollama" },
  { id: "opencode-go", displayName: "OpenCode Go", authorization: { kind: "api-key", renewable: false, multiAccount: false }, access: { inference: false, modelCatalog: false, usage: true, webSearch: false }, catalogProviderIds: ["opencode-go"], catalogProviderId: "opencode-go" },
  { id: "github-copilot", displayName: "GitHub Copilot", authorization: { kind: "runtime-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["github-copilot"], catalogProviderId: "github-copilot" },
  { id: "kimi-coding", displayName: "Kimi Coding", authorization: { kind: "runtime-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["kimi-code-plan-cn", "kimi-code-plan-global"], catalogProviderId: "kimi-code-plan-cn" },
  { id: "openrouter", displayName: "OpenRouter", authorization: { kind: "runtime-oauth", renewable: false, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["openrouter"], catalogProviderId: "openrouter" },
  { id: "xai", displayName: "xAI", authorization: { kind: "runtime-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["xai"], catalogProviderId: "xai" },
  { id: "meta", displayName: "Meta", authorization: { kind: "runtime-oauth", renewable: true, multiAccount: true }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: ["meta"], catalogProviderId: "meta" },
  { id: "radius", displayName: "Radius", authorization: { kind: "runtime-oauth", renewable: true, multiAccount: false }, access: { inference: true, modelCatalog: true, usage: false, webSearch: false }, catalogProviderIds: [], catalogProviderId: null },
]);

const BY_ID = new Map(MODEL_AUTH_PROVIDER_CAPABILITIES.map((capability) => [capability.id, capability]));

export function modelAuthProviderCapability(id: string): ModelAuthProviderCapability | null {
  return BY_ID.get(id as ModelAuthProviderId) ?? null;
}

export type ServerToolAuth = "subscription" | "api-key";

export interface WebSearchToolSpec {
  /** Wire API the tool definition belongs to, named as pi-ai names its APIs. */
  readonly api: "anthropic-messages" | "openai-responses" | "openai-codex-responses";
  /** Tool definition appended to the request's `tools` array. */
  readonly tool: Readonly<Record<string, unknown>>;
  readonly auth: readonly ServerToolAuth[];
}

export const WEB_SEARCH_TOOLS: readonly WebSearchToolSpec[] = Object.freeze([
  { api: "anthropic-messages", tool: Object.freeze({ type: "web_search_20250305", name: "web_search", max_uses: 3 }), auth: ["subscription", "api-key"] },
  { api: "openai-responses", tool: Object.freeze({ type: "web_search" }), auth: ["api-key"] },
  { api: "openai-codex-responses", tool: Object.freeze({ type: "web_search", external_web_access: true }), auth: ["subscription"] },
]);

/** The server-side web search tool for a wire API under the given kind of credential, or null when there is none. */
export function webSearchToolFor(api: string, auth: ServerToolAuth): WebSearchToolSpec | null {
  return WEB_SEARCH_TOOLS.find((spec) => spec.api === api && spec.auth.includes(auth)) ?? null;
}
