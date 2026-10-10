import { classifyUsageHttp, parseRetryAfter } from "@model-auth/core";
import { UsageRequestError, quotaWindow, usageSnapshot, type ProviderUsageData, type ProviderUsageRequestOptions, type ProviderUsageSnapshot, type ProviderUsageWindow } from "./usage.js";

export const OLLAMA_WEB_ENDPOINTS = Object.freeze({
  signIn: "https://ollama.com/signin",
  settings: "https://ollama.com/settings",
});

export interface OllamaWebSession {
  /** Keep this value in the host credential store; never put it in renderer state. */
  readonly cookie: string;
  readonly accountId?: string;
  readonly label?: string;
}

export interface OllamaUsageRequestOptions extends ProviderUsageRequestOptions {
  readonly cookie?: string;
}

export interface OllamaWebAuthorizationOptions extends ProviderUsageRequestOptions {
  readonly openExternal: (url: string) => Promise<unknown> | unknown;
  readonly readCookieHeader: () => Promise<string | null>;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

const SESSION_MISSING = "Ollama web session is not available.";
const SESSION_EXPIRED = "Ollama web session has expired.";
export const OLLAMA_SIGN_IN_INEFFECTIVE = "Ollama sign-in completed but the web session is still unavailable.";
const MAX_AUTH_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_MS = 1_500;

/** Open the first-party sign-in page and wait for a host-provided browser session. */
export async function authorizeOllamaWeb(options: OllamaWebAuthorizationOptions): Promise<{ session: OllamaWebSession; usage: ProviderUsageSnapshot }> {
  if (typeof options.openExternal !== "function" || typeof options.readCookieHeader !== "function") throw new Error("Ollama browser authorization requires host callbacks.");
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), authorizationTimeout(options.timeoutMs));
  const signal = combineSignals(options.signal, timeoutController.signal);
  try {
    if (signal.aborted) throw new Error("Ollama browser authorization was cancelled.");
    await openBrowser(() => options.openExternal(OLLAMA_WEB_ENDPOINTS.signIn), signal);
    const interval = Math.max(250, Math.min(30_000, options.pollMs ?? DEFAULT_POLL_MS));
    for (;;) {
      if (signal.aborted) throw new Error(timeoutController.signal.aborted ? "Ollama browser authorization timed out." : "Ollama browser authorization was cancelled.");
      const cookie = (await withAbort(options.readCookieHeader(), signal))?.trim();
      if (cookie) {
        const usage = await queryOllamaUsage({ cookie, signal, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
        if (usage.status !== "error") return { session: { cookie }, usage };
      }
      await wait(interval, signal);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface OllamaAccountLogin {
  readonly username: string;
  readonly password: string;
}

export interface OllamaAccountUsageOptions extends ProviderUsageRequestOptions {
  readonly readCookieHeader: () => Promise<string | null>;
  readonly login?: OllamaAccountLogin | null;
  /** Host-driven browser sign-in; must leave a fresh session readable through readCookieHeader. */
  readonly signIn?: (login: OllamaAccountLogin, context: { signal?: AbortSignal }) => Promise<void>;
}

/** Query usage, signing in once through the host when the stored session is missing or expired. */
export async function queryOllamaAccountUsage(options: OllamaAccountUsageOptions): Promise<ProviderUsageSnapshot> {
  const { signal } = options;
  const query = async () => {
    if (signal?.aborted) throw new Error("Ollama usage query was cancelled.");
    const cookie = (await options.readCookieHeader())?.trim() ?? "";
    if (signal?.aborted) throw new Error("Ollama usage query was cancelled.");
    return queryOllamaUsage({
      cookie, ...(signal ? { signal } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.credentialId ? { credentialId: options.credentialId } : {}),
    });
  };
  const first = await query();
  const { login, signIn } = options;
  if (first.status !== "error" || (first.error !== SESSION_MISSING && first.error !== SESSION_EXPIRED) || !login || !signIn) return first;
  signal?.throwIfAborted();
  await signIn(login, signal ? { signal } : {});
  const second = await query();
  if (second.status === "error" && (second.error === SESSION_MISSING || second.error === SESSION_EXPIRED)) {
    return { ...second, error: OLLAMA_SIGN_IN_INEFFECTIVE };
  }
  return second;
}

const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const SETTINGS_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

export async function queryOllamaUsage(options: OllamaUsageRequestOptions = {}): Promise<ProviderUsageSnapshot> {
  const credentialId = options.credentialId ?? "ollama-web";
  const failure = (error: string, errorCode: NonNullable<ProviderUsageSnapshot["errorCode"]>, retryAfterMs?: number | null) => usageSnapshot("ollama-cloud", credentialId, {
    status: "error", plan: null, windows: [], balance: null, error, errorCode,
    ...(retryAfterMs != null ? { retryAfterMs } : {}),
  });
  const cookie = options.cookie?.trim();
  if (!cookie) return failure(SESSION_MISSING, "signed-out");
  const timeout = AbortSignal.timeout(SETTINGS_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await requestSettings(cookie, signal, options.fetchImpl ?? fetch);
    if (response.status === 0 || response.type === "opaqueredirect") return failure("Ollama settings request failed (redirect).", "server-error");
    if (response.status === 401 || response.status === 403) return failure(SESSION_EXPIRED, "signed-out");
    const code = classifyUsageHttp(response.status);
    if (code !== "ok") {
      return failure(`Ollama settings request failed (${response.status}).`, code === "signed-out" ? "server-error" : code, parseRetryAfter(response.headers.get("retry-after")));
    }
    const finalUrl = parseUrl(response.url);
    if (finalUrl && isOllamaAuthUrl(finalUrl)) return failure(SESSION_EXPIRED, "signed-out");
    const html = await response.text();
    const data = parseOllamaSettings(html);
    if (!data.windows.length) {
      if (looksSignedOut(html)) return failure(SESSION_EXPIRED, "signed-out");
      // A header email proves the session is valid even when the page carries no meters.
      if (data.identity) return usageSnapshot("ollama-cloud", credentialId, { ...data, errorCode: "no-limits" });
      return failure("Ollama settings page has no usage meters.", "unreadable");
    }
    return usageSnapshot("ollama-cloud", credentialId, data);
  } catch (error) {
    if (error instanceof UsageRequestError) return failure(error.message, error.code);
    return failure("Ollama usage request failed.", "unreachable");
  }
}

/** Fetch the settings page, following only HTTPS redirects inside ollama.com so the cookie never leaves it. */
async function requestSettings(cookie: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<Response> {
  let url = new URL(OLLAMA_WEB_ENDPOINTS.settings);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(url.href, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        // Cloudflare challenges script-like agents on the settings page.
        "user-agent": BROWSER_USER_AGENT,
        cookie,
      },
      redirect: "manual",
      signal,
    });
    if (response.status < 300 || response.status >= 400) return response;
    const next = parseUrl(response.headers.get("location"), url);
    if (!next) return response;
    if (isOllamaAuthUrl(next)) throw new UsageRequestError("signed-out", SESSION_EXPIRED);
    if (!isOllamaOrigin(next)) return response;
    url = next;
  }
  throw new UsageRequestError("server-error", "Ollama returned too many redirects.");
}

function parseUrl(value: string | null | undefined, base?: URL): URL | null {
  if (!value) return null;
  try { return new URL(value, base); } catch { return null; }
}

function isOllamaOrigin(url: URL): boolean {
  return url.protocol === "https:" && (url.hostname === "ollama.com" || url.hostname === "www.ollama.com");
}

function isOllamaAuthUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if ((host === "ollama.com" || host === "www.ollama.com") && path === "/signin") return true;
  if (host === "signin.ollama.com") return true;
  return host.endsWith(".workos.com") && path.startsWith("/user_management/authorize");
}

function looksSignedOut(html: string): boolean {
  const lower = html.toLowerCase();
  if (!lower.includes("<form")) return false;
  const authRoute = /(?:action|href)=["']\/(?:signin|login)["']/.test(lower) || lower.includes("/api/auth/signin") || lower.includes("/auth/signin");
  const email = /(?:type|name)=["']email["']/.test(lower);
  const password = /(?:type|name)=["']password["']/.test(lower);
  return authRoute || lower.includes("sign in to ollama") || (email && password);
}

const USAGE_LABEL = /(Session usage|Hourly usage|Weekly usage)/gi;
const MAX_BLOCK_CHARS = 4_000;
const WINDOW_SPECS = {
  session: { id: "session", label: "Session", windowSeconds: 18_000, kind: "session" },
  hourly: { id: "hourly", label: "Hourly", windowSeconds: 3_600, kind: "session" },
  weekly: { id: "weekly", label: "Weekly", windowSeconds: 604_800, kind: "weekly" },
} as const;

/** Reads the Cloud Usage section of the authenticated Ollama settings page. */
export function parseOllamaSettings(html: string): ProviderUsageData {
  const source = typeof html === "string" ? html : "";
  const labels = [...source.matchAll(USAGE_LABEL)].map(match => ({
    index: match.index,
    spec: WINDOW_SPECS[match[1]!.split(" ")[0]!.toLowerCase() as keyof typeof WINDOW_SPECS],
  }));
  const windows: ProviderUsageWindow[] = [];
  const seen = new Set<string>();
  labels.forEach((current, position) => {
    const { kind } = current.spec;
    if (seen.has(kind)) return;
    const nextOther = labels.slice(position + 1).find(candidate => candidate.spec.kind !== kind);
    const block = source.slice(current.index, Math.min(nextOther?.index ?? source.length, current.index + MAX_BLOCK_CHARS));
    const percentText = /([0-9]+(?:\.[0-9]+)?)\s*%\s*used/i.exec(block)?.[1] ?? /width\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(block)?.[1];
    if (percentText === undefined) return;
    const usedPercent = Math.max(0, Math.min(100, Number(percentText)));
    seen.add(kind);
    windows.push({
      ...quotaWindow({
        id: current.spec.id, label: current.spec.label, usedPercent, remainingPercent: 100 - usedPercent,
        resetAt: resetAtIn(block), windowSeconds: current.spec.windowSeconds,
      }),
      kind,
    });
  });
  windows.sort((a, b) => Number(a.kind === "weekly") - Number(b.kind === "weekly"));
  const plan = /Cloud Usage\s*<\/span\s*>\s*<span[^>]*>([^<]+)<\/span\s*>/i.exec(source)?.[1]?.trim();
  const email = /id=["']header-email["'][^>]*>([^<]+)</i.exec(source)?.[1]?.trim();
  return {
    plan: plan || null,
    windows,
    balance: null,
    status: windows.length ? "ok" : "unknown",
    ...(email?.includes("@") ? { identity: email.toLowerCase() } : {}),
  };
}

function resetAtIn(block: string): number | null {
  const raw = /data-time\s*=\s*["']([^"']+)["']/i.exec(block)?.[1];
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function authorizationTimeout(value: number | undefined): number {
  if (value === undefined) return MAX_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Ollama browser authorization timeout is invalid.");
  return Math.min(value, MAX_AUTH_TIMEOUT_MS);
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  return active.length === 1 ? active[0]! : AbortSignal.any(active);
}

async function openBrowser(open: () => Promise<unknown> | unknown, signal: AbortSignal): Promise<void> {
  await withAbort(Promise.resolve().then(open), signal);
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Ollama browser authorization was cancelled.");
  void operation.catch(() => undefined);
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Ollama browser authorization was cancelled."));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("Ollama browser authorization was cancelled.")); };
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
