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
export async function anthropicClientHeaders(options: ClientVersionOptions = {}): Promise<Record<string, string>> {
  return { "user-agent": `claude-cli/${await latestClientVersion("claude", options)}`, "x-app": "cli" };
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
