import { parseRetryAfter } from "@model-auth/core";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;

export interface GeminiModel {
  readonly id: string;
  readonly displayName: string;
  readonly inputTokenLimit: number | null;
  readonly outputTokenLimit: number | null;
  readonly thinking: boolean;
}

export type GeminiErrorCode = "aborted" | "signed-out" | "rate-limited" | "http" | "response" | "transport";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(code: GeminiErrorCode, message: string, details: { status?: number; retryAfterMs?: number | null } = {}) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    if (details.status !== undefined) this.status = details.status;
    if (details.retryAfterMs != null) this.retryAfterMs = details.retryAfterMs;
  }
}

export interface GeminiRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** Lists the models a Gemini API key can call `generateContent` on; a successful listing also proves the key is valid. */
export async function listGeminiModels(apiKey: string, options: GeminiRequestOptions = {}): Promise<GeminiModel[]> {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) throw new GeminiError("signed-out", "A Gemini API key is required.");
  const models: GeminiModel[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getPage(key, pageToken, options);
    const entries = body.models;
    if (entries !== undefined && !Array.isArray(entries)) throw new GeminiError("response", "Gemini model list is unreadable.");
    for (const entry of entries ?? []) {
      const model = parseModel(entry);
      if (model) models.push(model);
    }
    const next = body.nextPageToken;
    if (typeof next !== "string" || !next) return models;
    pageToken = next;
  }
  throw new GeminiError("response", "Gemini model list has too many pages.");
}

async function getPage(apiKey: string, pageToken: string, options: GeminiRequestOptions): Promise<Record<string, unknown>> {
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = `${GEMINI_API_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, { headers: { accept: "application/json", "x-goog-api-key": apiKey }, redirect: "error", signal });
  } catch {
    throw failedTransport(options.signal, signal);
  }
  const status = response.status;
  if (status === 401 || status === 403) throw new GeminiError("signed-out", `Gemini rejected the API key (${status}).`, { status });
  if (status === 429) throw new GeminiError("rate-limited", "Gemini request was rate limited (429).", { status, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) });
  if (status === 400 && await invalidKey(response)) throw new GeminiError("signed-out", "Gemini rejected the API key (400).", { status });
  if (status !== 200) throw new GeminiError("http", `Gemini request failed (${status}).`, { status, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) });
  let body: unknown;
  try { body = await response.json(); }
  catch { throw failedResponse(options.signal, signal); }
  const record = asRecord(body);
  if (!record) throw new GeminiError("response", "Gemini model list is unreadable.");
  return record;
}

/** Reads the 400 body only to recognise an invalid key; nothing from it is surfaced. */
async function invalidKey(response: Response): Promise<boolean> {
  try {
    const details = asRecord(asRecord(await response.json())?.error)?.details;
    return Array.isArray(details) && details.some((detail) => asRecord(detail)?.reason === "API_KEY_INVALID");
  } catch {
    return false;
  }
}

function failedTransport(caller: AbortSignal | undefined, signal: AbortSignal): GeminiError {
  if (caller?.aborted) return new GeminiError("aborted", "Gemini request was aborted.");
  if (signal.aborted) return new GeminiError("transport", "Gemini request timed out.");
  return new GeminiError("transport", "Gemini request failed.");
}

function failedResponse(caller: AbortSignal | undefined, signal: AbortSignal): GeminiError {
  if (caller?.aborted) return new GeminiError("aborted", "Gemini request was aborted.");
  if (signal.aborted) return new GeminiError("transport", "Gemini request timed out.");
  return new GeminiError("response", "Gemini model list is unreadable.");
}

function parseModel(entry: unknown): GeminiModel | null {
  const record = asRecord(entry);
  const name = record?.name;
  const methods = record?.supportedGenerationMethods;
  if (!record || typeof name !== "string" || !Array.isArray(methods) || !methods.includes("generateContent")) return null;
  const id = name.startsWith("models/") ? name.slice("models/".length) : name;
  if (!id) return null;
  return {
    id,
    displayName: typeof record.displayName === "string" && record.displayName.trim() ? record.displayName : id,
    inputTokenLimit: limit(record.inputTokenLimit),
    outputTokenLimit: limit(record.outputTokenLimit),
    thinking: record.thinking === true,
  };
}

function limit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
