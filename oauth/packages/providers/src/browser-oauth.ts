import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface BrowserOAuthCredential {
  readonly type: "oauth";
  readonly access: string;
  readonly refresh: string;
  /** Expiry in Unix milliseconds. */
  readonly expires: number;
  readonly accountId?: string;
}

export interface BrowserOAuthAuthorizationOptions {
  readonly openExternal: (url: string) => Promise<unknown> | unknown;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Total authorization budget, capped at ten minutes. */
  readonly timeoutMs?: number;
}

export interface BrowserOAuthRefreshOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export type BrowserOAuthErrorCode = "aborted" | "browser" | "callback" | "response" | "timeout" | "transport";

export class BrowserOAuthError extends Error {
  constructor(public readonly code: BrowserOAuthErrorCode, message: string) {
    super(message);
    this.name = "BrowserOAuthError";
  }
}

export interface BrowserOAuthConfiguration {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly callbackPath: string;
  readonly scope: string;
  readonly extraAuthorize?: Readonly<Record<string, string>>;
  readonly sendStateToToken?: boolean;
  readonly tokenEncoding: "form" | "json";
  readonly accountIdFromAccess?: (access: string) => string | undefined;
}

const TOKEN_TIMEOUT_MS = 30_000;
const MAX_AUTH_TIMEOUT_MS = 600_000;
const EXPIRY_SKEW_MS = 300_000;

export async function authorizeBrowserOAuth(
  config: BrowserOAuthConfiguration,
  options: BrowserOAuthAuthorizationOptions,
): Promise<BrowserOAuthCredential> {
  if (typeof options.openExternal !== "function") throw new BrowserOAuthError("browser", "Browser authorization could not be opened.");
  ensureNotAborted(options.signal);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), authorizationTimeout(options.timeoutMs));
  const signal = anySignal(options.signal, timeoutController.signal);
  let callback: CallbackListener | undefined;
  try {
    ensureNotAborted(signal, timeoutController.signal);
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    callback = await startCallbackListener(config, state, signal, timeoutController.signal);
    const parameters = new URLSearchParams({
      response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: config.scope,
      code_challenge: challenge, code_challenge_method: "S256", state, ...config.extraAuthorize,
    });
    const opening = Promise.resolve().then(() => options.openExternal(`${config.authorizeUrl}?${parameters}`));
    const browser = opening.then(
      () => undefined,
      () => { throw new BrowserOAuthError("browser", "Browser authorization could not be opened."); },
    );
    // The host opener can remain pending after a browser has already reached the callback.
    void browser.catch(() => {});
    const first = await Promise.race([
      browser,
      callback.result.then(code => ({ code })),
    ]);
    const code = first ? first.code : await callback.result;
    ensureNotAborted(signal, timeoutController.signal);
    const token = await requestToken(config, {
      grant_type: "authorization_code", client_id: config.clientId, code, code_verifier: verifier, redirect_uri: config.redirectUri,
      ...(config.sendStateToToken ? { state } : {}),
    }, options.fetchImpl ?? fetch, signal, timeoutController.signal);
    return token;
  } finally {
    clearTimeout(timeout);
    await callback?.close();
  }
}

export async function refreshBrowserOAuth(
  config: BrowserOAuthConfiguration,
  credential: BrowserOAuthCredential,
  options: BrowserOAuthRefreshOptions = {},
): Promise<BrowserOAuthCredential> {
  ensureNotAborted(options.signal);
  const refresh = requiredText(credential?.refresh);
  if (!refresh) throw new BrowserOAuthError("response", "OAuth credential is invalid.");
  return requestToken(config, { grant_type: "refresh_token", client_id: config.clientId, refresh_token: refresh }, options.fetchImpl ?? fetch, options.signal, undefined, refresh, credential.accountId);
}

async function requestToken(
  config: BrowserOAuthConfiguration, form: Record<string, string>, fetchImpl: typeof fetch, signal?: AbortSignal, timeoutSignal?: AbortSignal, previousRefresh?: string, previousAccountId?: string,
): Promise<BrowserOAuthCredential> {
  const tokenTimeout = new AbortController();
  const timer = setTimeout(() => tokenTimeout.abort(), TOKEN_TIMEOUT_MS);
  const requestSignal = anySignal(signal, tokenTimeout.signal);
  try {
    let response: Response;
    try {
      response = await fetchImpl(config.tokenUrl, {
        method: "POST", redirect: "error", signal: requestSignal,
        headers: { accept: "application/json", "content-type": config.tokenEncoding === "form" ? "application/x-www-form-urlencoded" : "application/json" },
        body: config.tokenEncoding === "form" ? new URLSearchParams(form) : JSON.stringify(form),
      });
    } catch {
      ensureNotAborted(signal, timeoutSignal, tokenTimeout.signal);
      throw new BrowserOAuthError("transport", "OAuth token request could not be completed.");
    }
    ensureNotAborted(signal, timeoutSignal, tokenTimeout.signal);
    if (!response.ok || response.redirected) throw new BrowserOAuthError("transport", "OAuth token request was rejected.");
    let payload: unknown;
    try {
      const body = await response.text();
      if (body.length > 131_072) throw new Error();
      payload = JSON.parse(body);
    } catch { throw new BrowserOAuthError("response", "OAuth token response is invalid."); }
    ensureNotAborted(signal, timeoutSignal, tokenTimeout.signal);
    return credentialFrom(payload, config.accountIdFromAccess, previousRefresh, previousAccountId);
  } finally {
    clearTimeout(timer);
  }
}

function credentialFrom(payload: unknown, accountIdFromAccess?: (access: string) => string | undefined, previousRefresh?: string, previousAccountId?: string): BrowserOAuthCredential {
  const value = record(payload);
  const access = requiredText(value?.access_token);
  const refresh = value && Object.prototype.hasOwnProperty.call(value, "refresh_token") ? requiredText(value.refresh_token) : previousRefresh;
  const expiresIn = Number(value?.expires_in);
  if (!access || !refresh || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 365 * 86400) {
    throw new BrowserOAuthError("response", "OAuth token response is incomplete.");
  }
  const accountId = accountIdFromAccess?.(access) ?? previousAccountId;
  const lifetimeMs = expiresIn * 1000;
  return { type: "oauth", access, refresh, expires: Date.now() + lifetimeMs - Math.min(EXPIRY_SKEW_MS, Math.floor(lifetimeMs / 10)), ...(accountId ? { accountId } : {}) };
}

interface CallbackListener { readonly result: Promise<string>; close(force?: boolean): Promise<void>; }

async function startCallbackListener(config: BrowserOAuthConfiguration, state: string, signal: AbortSignal, timeoutSignal: AbortSignal): Promise<CallbackListener> {
  const redirect = safeLoopbackRedirect(config.redirectUri, config.callbackPath);
  const server = createServer({ maxHeaderSize: 16_384 });
  let finished = false;
  let closing: Promise<void> | undefined;
  let removeAbort = () => {};
  let resolveCode!: (value: string) => void;
  let rejectCode!: (reason: BrowserOAuthError) => void;
  const result = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // The request handler can reject before the caller reaches `await result`.
  void result.catch(() => {});
  const close = async (force = false) => {
    removeAbort();
    if (force) server.closeAllConnections();
    if (!closing && server.listening) closing = new Promise<void>(resolve => server.close(() => resolve()));
    await closing;
  };
  const finish = (error?: BrowserOAuthError, code?: string) => {
    if (finished) return;
    finished = true;
    void close();
    if (error) rejectCode(error); else resolveCode(code!);
  };
  const abort = () => { void close(true); finish(cancellation(signal, timeoutSignal)); };
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const host = typeof request.headers.host === "string" ? request.headers.host : "";
    const expectedHost = redirect.host;
    if (host !== expectedHost || request.method !== "GET") { response.writeHead(404).end(); return; }
    let url: URL;
    try { url = new URL(request.url ?? "/", redirect); } catch { response.writeHead(400).end(); return; }
    if (url.pathname !== config.callbackPath) { response.writeHead(404).end(); return; }
    const code = singleParameter(url, "code"), callbackState = singleParameter(url, "state"), error = singleParameter(url, "error");
    if (!code || !callbackState || callbackState !== state || error || hasDuplicate(url, "error_description")) {
      response.once("finish", () => finish(new BrowserOAuthError("callback", "Browser authorization callback was rejected.")));
      response.writeHead(400, { "connection": "close", "content-type": "text/html; charset=utf-8" }).end(callbackPage(false));
      return;
    }
    response.once("finish", () => finish(undefined, code));
    response.writeHead(200, { "connection": "close", "content-type": "text/html; charset=utf-8" }).end(callbackPage(true));
  };
  server.on("request", handler);
  signal.addEventListener("abort", abort, { once: true });
  removeAbort = () => signal.removeEventListener("abort", abort);
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new BrowserOAuthError("transport", "OAuth callback listener could not bind."));
      server.once("error", onError);
      server.listen(Number(redirect.port), "127.0.0.1", () => { server.removeListener("error", onError); resolve(); });
    });
  } catch (error) {
    await close(true);
    throw error;
  }
  if (signal.aborted) { await close(true); throw cancellation(signal, timeoutSignal); }
  server.once("error", () => finish(new BrowserOAuthError("transport", "OAuth callback listener failed.")));
  return { result, close };
}

function safeLoopbackRedirect(value: string, path: string): URL {
  let redirect: URL;
  try { redirect = new URL(value); } catch { throw new BrowserOAuthError("response", "OAuth redirect URI is invalid."); }
  if (redirect.protocol !== "http:" || redirect.hostname !== "localhost" || !redirect.port || redirect.pathname !== path || redirect.username || redirect.password || redirect.search || redirect.hash) throw new BrowserOAuthError("response", "OAuth redirect URI is invalid.");
  return redirect;
}
function authorizationTimeout(value?: number): number {
  if (value === undefined) return MAX_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) throw new BrowserOAuthError("response", "OAuth authorization timeout is invalid.");
  return Math.min(value, MAX_AUTH_TIMEOUT_MS);
}
function anySignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => Boolean(signal)));
}
function cancellation(signal?: AbortSignal, timeoutSignal?: AbortSignal, tokenTimeout?: AbortSignal): BrowserOAuthError {
  return timeoutSignal?.aborted || tokenTimeout?.aborted ? new BrowserOAuthError("timeout", "OAuth authorization timed out.") : new BrowserOAuthError("aborted", "Browser authorization was cancelled.");
}
function ensureNotAborted(signal?: AbortSignal, timeoutSignal?: AbortSignal, tokenTimeout?: AbortSignal): void {
  if (signal?.aborted || timeoutSignal?.aborted || tokenTimeout?.aborted) throw cancellation(signal, timeoutSignal, tokenTimeout);
}
function singleParameter(url: URL, key: string): string | undefined { const values = url.searchParams.getAll(key); return values.length === 1 && values[0] ? values[0] : undefined; }
function hasDuplicate(url: URL, key: string): boolean { return url.searchParams.getAll(key).length > 1; }
function callbackPage(ok: boolean): string { return `<!doctype html><title>Authorization</title><p>${ok ? "Authorization complete. You can close this window." : "Authorization could not be completed. Return to the application."}</p>`; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function requiredText(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
