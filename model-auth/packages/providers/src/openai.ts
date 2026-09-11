import { authorizeBrowserOAuth, refreshBrowserOAuth, type BrowserOAuthAuthorizationOptions, type BrowserOAuthCredential, type BrowserOAuthRefreshOptions } from "./browser-oauth.js";

const OPENAI_CONFIG = {
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: Buffer.from("YXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubg==", "base64").toString("utf8"),
  redirectUri: "http://localhost:1455/auth/callback",
  callbackPath: "/auth/callback",
  scope: "openid profile email offline_access",
  extraAuthorize: { id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "pi" },
  tokenEncoding: "form" as const,
  accountIdFromAccess(access: string): string | undefined {
    try {
      const payload = JSON.parse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
      const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
      const accountId = typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id.trim() : "";
      return accountId || undefined;
    } catch { return undefined; }
  },
};

export type OpenAIOAuthCredential = BrowserOAuthCredential;
export type OpenAIAuthorizationOptions = BrowserOAuthAuthorizationOptions;
export type OpenAIRefreshOptions = BrowserOAuthRefreshOptions;
export const authorizeOpenAI = (options: OpenAIAuthorizationOptions): Promise<OpenAIOAuthCredential> => authorizeBrowserOAuth(OPENAI_CONFIG, options);
export const refreshOpenAI = (credential: OpenAIOAuthCredential, options?: OpenAIRefreshOptions): Promise<OpenAIOAuthCredential> => refreshBrowserOAuth(OPENAI_CONFIG, credential, options);
