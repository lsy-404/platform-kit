import { createHash, randomBytes } from "node:crypto";

const REDIRECT_URI = "https://antigravity.google/oauth-callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://daily-cloudcode-pa.googleapis.com/v1internal:";
const SCOPES = ["cloud-platform", "userinfo.email", "userinfo.profile", "cclog", "experimentsandconfigs", "aicode"]
  .map(scope => 'https://www.googleapis.com/auth/' + scope).concat("openid").join(" ");

export interface AntigravityCredential {
  readonly type: "oauth";
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}
export interface AntigravityRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}
export interface AntigravityOAuthClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
}
export interface AntigravityAuthorizationOptions extends AntigravityRequestOptions, AntigravityOAuthClientOptions {
  readonly openExternal: (url: string) => Promise<unknown> | unknown;
  readonly prompt: () => Promise<string> | string;
  readonly timeoutMs?: number;
}
export interface AntigravityRefreshOptions extends AntigravityRequestOptions, AntigravityOAuthClientOptions {}
export interface AntigravityApiOptions extends AntigravityRequestOptions {
  readonly userAgent: string;
}
export type AntigravityErrorCode = "aborted" | "timeout" | "browser" | "callback" | "transport" | "http" | "response";
export class AntigravityError extends Error {
  constructor(public readonly code: AntigravityErrorCode, public readonly status?: number) {
    super('Antigravity ' + code + (status === undefined ? '' : ' (' + status + ')') + '.');
    this.name = "AntigravityError";
  }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AntigravityError("response");
  return value as JsonObject;
}
function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new AntigravityError("response");
  return value;
}
function abortCheck(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AntigravityError("aborted");
}
async function withAbort<T>(operation: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
  abortCheck(signal);
  if (!signal) return operation();
  let listener = () => {};
  try {
    return await Promise.race([
      Promise.resolve().then(() => { abortCheck(signal); return operation(); }),
      new Promise<never>((_, reject) => {
        listener = () => reject(new AntigravityError("aborted"));
        signal.addEventListener("abort", listener, { once: true });
        if (signal.aborted) listener();
      }),
    ]);
  } finally { signal.removeEventListener("abort", listener); }
}
async function fetchResponse(url: string, init: RequestInit, options: AntigravityRequestOptions): Promise<Response> {
  abortCheck(options.signal);
  try {
    const response = await withAbort(() => (options.fetchImpl ?? fetch)(url, { ...init, ...(options.signal ? { signal: options.signal } : {}), redirect: "error" }), options.signal);
    if (response.redirected) throw new AntigravityError("response");
    if (!response.ok) throw new AntigravityError("http", response.status);
    return response;
  } catch (error) {
    if (options.signal?.aborted) throw new AntigravityError("aborted");
    if (error instanceof AntigravityError) throw error;
    throw new AntigravityError("transport");
  }
}
async function responseObject(response: Response, signal?: AbortSignal): Promise<JsonObject> {
  try { return object(await withAbort(() => response.json(), signal)); }
  catch (error) {
    if (signal?.aborted) throw new AntigravityError("aborted");
    if (error instanceof AntigravityError) throw error;
    throw new AntigravityError("response");
  }
}
async function tokenRequest(params: Record<string, string>, options: AntigravityRefreshOptions, previousRefresh?: string): Promise<AntigravityCredential> {
  abortCheck(options.signal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const body = new URLSearchParams({ client_id: required(options.clientId), client_secret: required(options.clientSecret), ...params });
    const response = await fetchResponse(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, { ...options, signal });
    const data = await responseObject(response, signal);
    const access = required(data.access_token);
    const refresh = required(data.refresh_token ?? previousRefresh);
    const seconds = data.expires_in;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) throw new AntigravityError("response");
    return { type: "oauth", access, refresh, expires: Date.now() + seconds * 1000 };
  } catch (error) {
    if (options.signal?.aborted) throw new AntigravityError("aborted");
    if (controller.signal.aborted) throw new AntigravityError("timeout");
    throw error;
  } finally { clearTimeout(timer); }
}
function callbackCode(input: string, state: string): string {
  const value = input.trim();
  if (!value) throw new AntigravityError("callback");
  if (!/^https?:\/\//i.test(value)) {
    if (!/^[A-Za-z0-9._~+\/-]+$/.test(value)) throw new AntigravityError("callback");
    return value;
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new AntigravityError("callback"); }
  if (url.origin + url.pathname !== REDIRECT_URI || url.username || url.password || url.hash ||
      url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state ||
      url.searchParams.getAll("code").length !== 1) throw new AntigravityError("callback");
  const code = url.searchParams.get("code");
  if (!code || /\s/.test(code)) throw new AntigravityError("callback");
  return code;
}
export async function authorizeAntigravity(options: AntigravityAuthorizationOptions): Promise<AntigravityCredential> {
  abortCheck(options.signal);
  required(options.clientId);
  required(options.clientSecret);
  if (typeof options.openExternal !== "function" || typeof options.prompt !== "function") throw new AntigravityError("browser");
  const timeout = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new AntigravityError("response");
  const timerController = new AbortController();
  const timer = setTimeout(() => timerController.abort(), Math.min(timeout, 600_000));
  const signal = options.signal ? AbortSignal.any([options.signal, timerController.signal]) : timerController.signal;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/auth");
  url.search = new URLSearchParams({ response_type: "code", client_id: required(options.clientId), redirect_uri: REDIRECT_URI, scope: SCOPES,
    state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent" }).toString();
  try {
    try { await withAbort(() => options.openExternal(url.href), signal); }
    catch (error) { if (signal.aborted) throw error; throw new AntigravityError("browser"); }
    let input: string;
    try { input = await withAbort(() => options.prompt(), signal); }
    catch (error) { if (signal.aborted) throw error; throw new AntigravityError("callback"); }
    if (typeof input !== "string") throw new AntigravityError("callback");
    const code = callbackCode(input, state);
    return await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT_URI }, { ...options, signal });
  } catch (error) {
    if (options.signal?.aborted) throw new AntigravityError("aborted");
    if (timerController.signal.aborted) throw new AntigravityError("timeout");
    throw error;
  } finally { clearTimeout(timer); }
}
export function antigravityNeedsRefresh(credential: AntigravityCredential, now = Date.now()): boolean {
  return credential.expires - 300_000 <= now;
}
export async function refreshAntigravity(credential: AntigravityCredential, options: AntigravityRefreshOptions): Promise<AntigravityCredential> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: required(credential.refresh) }, options, credential.refresh);
}
export function antigravityHeaders(credential: AntigravityCredential, userAgent: string): Record<string, string> {
  try {
    const headers = new Headers({ authorization: 'Bearer ' + required(credential.access), "content-type": "application/json", "user-agent": required(userAgent) });
    return Object.fromEntries(headers);
  } catch { throw new AntigravityError("response"); }
}
async function apiRequest(method: string, body: JsonObject, credential: AntigravityCredential, options: AntigravityApiOptions, query = ""): Promise<Response> {
  return fetchResponse(API_BASE + method + query, { method: "POST", headers: antigravityHeaders(credential, options.userAgent), body: JSON.stringify(body) }, options);
}
export async function loadAntigravityCodeAssist(credential: AntigravityCredential, options: AntigravityApiOptions, project?: string): Promise<JsonObject> {
  const body = { metadata: { ideType: "ANTIGRAVITY" }, ...(project !== undefined ? { cloudaicompanionProject: project } : {}) };
  return responseObject(await apiRequest("loadCodeAssist", body, credential, options), options.signal);
}
export async function onboardAntigravityUser(credential: AntigravityCredential, tierId: string, options: AntigravityApiOptions, project?: string): Promise<JsonObject> {
  const body = { tierId: required(tierId), metadata: { ideType: "ANTIGRAVITY" }, ...(project !== undefined ? { cloudaicompanionProject: project } : {}) };
  return responseObject(await apiRequest("onboardUser", body, credential, options), options.signal);
}
export async function fetchAntigravityModels(credential: AntigravityCredential, project: string, options: AntigravityApiOptions): Promise<JsonObject> {
  return responseObject(await apiRequest("fetchAvailableModels", { project: required(project) }, credential, options), options.signal);
}
export async function streamAntigravityContent(credential: AntigravityCredential, request: JsonObject, options: AntigravityApiOptions): Promise<Response> {
  return apiRequest("streamGenerateContent", request, credential, options, "?alt=sse");
}

export * from "./antigravity-telemetry.js";
