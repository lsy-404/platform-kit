import { authorizeBrowserOAuth, refreshBrowserOAuth, type BrowserOAuthAuthorizationOptions, type BrowserOAuthCredential, type BrowserOAuthRefreshOptions } from "./browser-oauth.js";

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
export const authorizeAnthropic = (options: AnthropicAuthorizationOptions): Promise<AnthropicOAuthCredential> => authorizeBrowserOAuth(ANTHROPIC_CONFIG, options);
export const refreshAnthropic = (credential: AnthropicOAuthCredential, options?: AnthropicRefreshOptions): Promise<AnthropicOAuthCredential> => refreshBrowserOAuth(ANTHROPIC_CONFIG, credential, options);
