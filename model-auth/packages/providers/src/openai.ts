import { normalizeModelId, type ModelDescriptor } from "@model-auth/core";
import { latestClientVersion } from "./client-versions.js";
import { authorizeBrowserOAuth, refreshBrowserOAuth, type BrowserOAuthAuthorizationOptions, type BrowserOAuthCredential, type BrowserOAuthRefreshOptions } from "./browser-oauth.js";

const CODEX_ORIGINATOR = "pi";
const OPENAI_CONFIG = {
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: Buffer.from("YXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubg==", "base64").toString("utf8"),
  redirectUri: "http://localhost:1455/auth/callback",
  callbackPath: "/auth/callback",
  scope: "openid profile email offline_access",
  extraAuthorize: { id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: CODEX_ORIGINATOR },
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

export interface OpenAICodexModel extends ModelDescriptor {
  readonly defaultReasoningEffort?: string;
}

export interface OpenAICodexModelsOptions {
  /** Defaults to the latest official Codex CLI version. */
  readonly clientVersion?: string;
  /** Defaults to the originator used by the OAuth flow. */
  readonly originator?: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_MODELS_TIMEOUT_MS = 30_000;

/** Fetch the authenticated Codex model catalog for the supplied ChatGPT account. */
export async function listOpenAICodexModels(
  credential: Pick<OpenAIOAuthCredential, "access" | "accountId">,
  options: OpenAICodexModelsOptions = {},
): Promise<readonly OpenAICodexModel[]> {
  if (typeof credential?.access !== "string" || !credential.access.trim()) throw new Error("OpenAI OAuth access token is required.");
  const timeout = AbortSignal.timeout(options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : CODEX_MODELS_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const clientVersion = requiredHeader(options.clientVersion ?? await latestClientVersion("codex", { ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), signal }), "clientVersion");
  const originator = requiredHeader(options.originator ?? CODEX_ORIGINATOR, "originator");
  const url = new URL(CODEX_MODELS_URL);
  url.searchParams.set("client_version", clientVersion);
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${credential.access}`,
    originator,
  };
  if (typeof credential.accountId === "string" && credential.accountId.trim()) {
    headers["ChatGPT-Account-ID"] = credential.accountId.trim();
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, { headers, redirect: "error", signal });
  } catch (error) {
    if (options.signal?.aborted) throw new Error("OpenAI Codex model catalog request was cancelled.");
    throw new Error(error instanceof Error && error.name === "TimeoutError"
      ? "OpenAI Codex model catalog request timed out."
      : "OpenAI Codex model catalog request failed.");
  }
  if (!response.ok || response.redirected) {
    const detail = response.redirected ? undefined : await errorDetail(response);
    throw new Error(`OpenAI Codex model catalog request failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("OpenAI Codex model catalog response is invalid."); }
  return parseOpenAICodexModels(payload);
}

/** Parse the Codex `/models` response without supplying a local model fallback. */
export function parseOpenAICodexModels(payload: unknown): readonly OpenAICodexModel[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.models)) throw new Error("OpenAI Codex model catalog response is invalid.");
  const seen = new Set<string>();
  return root.models.flatMap((value): OpenAICodexModel[] => {
    const model = record(value);
    if (!model || model.hidden === true) return [];
    const visibility = stringValue(model.visibility)?.toLowerCase();
    if (visibility && visibility !== "list") return [];
    const rawId = stringValue(model.slug) ?? stringValue(model.id) ?? stringValue(model.model);
    if (!rawId) return [];
    let id: string;
    try { id = normalizeModelId(rawId); } catch { return []; }
    if (seen.has(id)) return [];
    seen.add(id);
    const name = stringValue(model.display_name) ?? stringValue(model.name) ?? id;
    const description = stringValue(model.description);
    const defaultReasoningEffort = stringValue(model.default_reasoning_level) ?? stringValue(model.default_reasoning_effort);
    const reasoningEfforts = listReasoningEfforts(model.supported_reasoning_levels ?? model.supported_reasoning_efforts);
    const reasoning = typeof model.supports_reasoning === "boolean" ? model.supports_reasoning : reasoningEfforts ? true : undefined;
    const context = numberValue(model.context_window) ?? numberValue(model.max_context_window);
    const output = numberValue(model.max_output_tokens) ?? numberValue(model.max_completion_tokens);
    const input = Array.isArray(model.input_modalities) ? [...new Set(model.input_modalities.flatMap(entry => stringValue(entry) ?? []))] : [];
    return [{
      id,
      name,
      ...(description ? { description } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(reasoningEfforts ? { reasoningEfforts } : {}),
      ...(input.length ? { modalities: { input } } : {}),
      ...(context !== undefined || output !== undefined ? { limits: { ...(context !== undefined ? { context } : {}), ...(output !== undefined ? { output } : {}) } } : {}),
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    }];
  });
}

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = record(await response.json());
    const text = stringValue(record(payload?.error)?.message) ?? stringValue(payload?.message) ?? stringValue(payload?.detail);
    // Server text is shown to users, so keep it short and on one line.
    return text?.replace(/\s+/g, " ").slice(0, 200);
  } catch { return undefined; }
}

function requiredHeader(value: unknown, field: string): string {
  const text = stringValue(value);
  if (!text || text.length > 256 || /[\r\n]/.test(text)) throw new Error(`OpenAI Codex ${field} is invalid.`);
  return text;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function listReasoningEfforts(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = [...new Set(value.flatMap((entry) => {
    if (typeof entry === "string") return stringValue(entry) ?? [];
    const option = record(entry);
    const effort = option && (stringValue(option.effort) ?? stringValue(option.reasoning_effort) ?? stringValue(option.reasoningEffort));
    return effort ? [effort] : [];
  }))];
  return efforts.length ? efforts : undefined;
}
