import { latestClientVersion, type ClientVersionOptions } from "./client-versions.js";
import { BrowserOAuthError, authorizeBrowserOAuth, refreshBrowserOAuth, type BrowserOAuthAuthorizationOptions, type BrowserOAuthCredential, type BrowserOAuthRefreshOptions } from "./browser-oauth.js";

const ANTHROPIC_CONFIG = {
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  clientId: Buffer.from("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl", "base64").toString("utf8"),
  redirectUri: "http://localhost:53692/callback",
  callbackPath: "/callback",
  scope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  extraAuthorize: { code: "true" },
  sendStateToToken: true,
  tokenEncoding: "json" as const,
};

export type AnthropicOAuthCredential = BrowserOAuthCredential;
export type AnthropicAuthorizationOptions = BrowserOAuthAuthorizationOptions;
export type AnthropicRefreshOptions = BrowserOAuthRefreshOptions;

/** Token counts reported by one Anthropic Messages response. */
export interface AnthropicRequestUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWrite5m?: number;
  readonly cacheWrite1h?: number;
}

/** Normalize the provider's response usage without treating omitted fields as zero. */
export function normalizeAnthropicRequestUsage(value: unknown): AnthropicRequestUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const count = (entry: unknown): number | undefined => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 ? entry : undefined;
  const result: {
    input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cacheWrite5m?: number; cacheWrite1h?: number;
  } = {};
  const input = count(source.input_tokens);
  const output = count(source.output_tokens);
  const cacheRead = count(source.cache_read_input_tokens);
  const cacheWrite = count(source.cache_creation_input_tokens);
  if (input !== undefined) result.input = input;
  if (output !== undefined) result.output = output;
  if (cacheRead !== undefined) result.cacheRead = cacheRead;
  if (cacheWrite !== undefined) result.cacheWrite = cacheWrite;
  const creation = source.cache_creation;
  if (creation && typeof creation === "object" && !Array.isArray(creation)) {
    const details = creation as Record<string, unknown>;
    const short = count(details.ephemeral_5m_input_tokens);
    const long = count(details.ephemeral_1h_input_tokens);
    if (short !== undefined) result.cacheWrite5m = short;
    if (long !== undefined) result.cacheWrite1h = long;
    if (cacheWrite === undefined && short !== undefined && long !== undefined) result.cacheWrite = short + long;
  }
  return Object.keys(result).length ? result : null;
}

export async function anthropicClientHeaders(options: ClientVersionOptions = {}): Promise<Record<string, string>> {
  return { "user-agent": `claude-cli/${await latestClientVersion("claude", options)} (external, sdk-cli)`, "x-app": "cli" };
}

export async function authorizeAnthropic(options: AnthropicAuthorizationOptions): Promise<AnthropicOAuthCredential> {
  return authorizeBrowserOAuth(ANTHROPIC_CONFIG, await withClientHeaders(options));
}

export async function refreshAnthropic(credential: AnthropicOAuthCredential, options: AnthropicRefreshOptions = {}): Promise<AnthropicOAuthCredential> {
  return refreshBrowserOAuth(ANTHROPIC_CONFIG, credential, await withClientHeaders(options));
}

async function withClientHeaders<T extends BrowserOAuthRefreshOptions>(options: T): Promise<T> {
  if (options.signal?.aborted) throw new BrowserOAuthError("aborted", "Browser authorization was cancelled.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientHeaders = await anthropicClientHeaders({ fetchImpl, ...(options.signal ? { signal: options.signal } : {}) });
  if (options.signal?.aborted) throw new BrowserOAuthError("aborted", "Browser authorization was cancelled.");
  return { ...options, fetchImpl: (input, init) => fetchImpl(input, {
    ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...clientHeaders },
  }) };
}
