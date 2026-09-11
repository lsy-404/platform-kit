import { usageSnapshot, type ProviderUsageData, type ProviderUsageRequestOptions, type ProviderUsageSnapshot, type ProviderUsageWindow } from "./usage.js";

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

export async function queryOllamaUsage(options: OllamaUsageRequestOptions = {}): Promise<ProviderUsageSnapshot> {
  const credentialId = options.credentialId ?? "ollama-web";
  if (!options.cookie?.trim()) {
    return usageSnapshot("ollama-cloud", credentialId, {
      status: "error", plan: null, windows: [], balance: null,
      error: "Ollama web session is not available.",
    });
  }
  try {
    const response = await (options.fetchImpl ?? fetch)(OLLAMA_WEB_ENDPOINTS.settings, {
      headers: { accept: "text/html,application/xhtml+xml", cookie: options.cookie.trim() },
      redirect: "manual",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status >= 300 && response.status < 400 || response.redirected || !response.ok) {
      throw new Error(response.status === 401 || response.status === 403 || response.status === 302
        ? "Ollama web session has expired."
        : `Ollama settings request failed (${response.status}).`);
    }
    const html = await response.text();
    if (/\/signin(?:[/?#]|$)/i.test(response.url)) throw new Error("Ollama web session has expired.");
    return usageSnapshot("ollama-cloud", credentialId, parseOllamaSettings(html));
  } catch (error) {
    return usageSnapshot("ollama-cloud", credentialId, {
      status: "error", plan: null, windows: [], balance: null,
      error: error instanceof Error ? error.message : "Ollama usage request failed.",
    });
  }
}

/** Best-effort parser for the authenticated Ollama Plan & Billing page. */
export function parseOllamaSettings(html: string): ProviderUsageData {
  const source = typeof html === "string" ? html : "";
  const text = decodeHtml(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
  const cloudStart = source.search(/cloud usage|included usage|plan & billing/i);
  const cloudHtml = cloudStart >= 0 ? source.slice(cloudStart, cloudStart + 12_000) : source;
  const cloudText = decodeHtml(cloudHtml.replace(/<[^>]+>/g, " "));
  const plan = firstMatch(cloudText, /\b(?:plan|included usage|cloud usage)[^\n]{0,120}?\b(free|pro|max)\b/i, /\b(free|pro|max)\b/i);
  const windows: ProviderUsageWindow[] = [];
  const included = sectionAround(text, /included usage|monthly included|included credits/i, 3_000);
  const money = included.match(/\$\s*([\d,.]+)\s*(?:of|\/)\s*\$?\s*([\d,.]+)/i);
  if (money) {
    const used = parseMoney(money[1]);
    const limit = parseMoney(money[2]);
    if (used !== null && limit !== null && limit > 0) {
      windows.push({ id: "included", label: "Monthly included", usedPercent: ratioPercent(used, limit), resetAt: resetAtNear(source, source.search(/included usage|monthly included|included credits/i)), used, limit, remaining: Math.max(0, limit - used), unit: "USD" });
    }
  }
  for (const [id, label, pattern] of [
    ["session", "Session", /session(?: usage)?/i],
    ["hourly", "Hourly", /hourly(?: usage)?/i],
    ["weekly", "Weekly", /weekly(?: usage)?/i],
  ] as const) {
    const index = text.search(pattern);
    if (index < 0) continue;
    const segment = text.slice(index, index + 900);
    const match = segment.match(/(\d+(?:\.\d+)?)\s*%/);
    const usedPercent = match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
    if (usedPercent === null) continue;
    windows.push({ id, label, usedPercent, resetAt: resetAtNear(source, source.toLowerCase().indexOf(label.toLowerCase())) });
  }
  return {
    plan: plan ? plan.toLowerCase().replace(/^./, (value) => value.toUpperCase()) : null,
    windows,
    balance: null,
    ...(windows.length ? { status: "ok" as const } : { status: "unknown" as const }),
  };
}

function sectionAround(value: string, pattern: RegExp, length: number): string {
  const index = value.search(pattern);
  return index < 0 ? "" : value.slice(index, index + length);
}

function resetAtNear(source: string, index: number): number | null {
  if (index < 0) return null;
  const nearby = source.slice(index, index + 2_000);
  const match = nearby.match(/data-time\s*=\s*["']([^"']+)["']/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(match[1]!);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function ratioPercent(used: number, limit: number): number {
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function firstMatch(value: string, ...patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#36;/g, "$");
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
