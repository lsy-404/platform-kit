import { parseRetryAfter } from "@model-auth/core";
import { quotaWindow, usageSnapshot, type ProviderUsageData, type ProviderUsageRequestOptions, type ProviderUsageSnapshot, type ProviderUsageWindow } from "./usage.js";

export const OLLAMA_BALANCE_URL = "https://ollama.com/api/balance";
const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_SECONDS = 5 * 3600;
const WEEK_SECONDS = 7 * 86400;

/** Reads the included allowance and purchased credits of the account behind an Ollama API key. */
export async function queryOllamaKeyUsage(apiKey: string, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageSnapshot> {
  options.signal?.throwIfAborted();
  const credentialId = options.credentialId ?? "ollama-key";
  const failure = (error: string, errorCode: NonNullable<ProviderUsageSnapshot["errorCode"]>, retryAfterMs?: number | null) => usageSnapshot("ollama-cloud", credentialId, {
    status: "error", plan: null, windows: [], balance: null, error, errorCode,
    ...(retryAfterMs != null ? { retryAfterMs } : {}),
  });
  if (typeof apiKey !== "string" || !apiKey.trim()) return failure("An Ollama API key is required.", "signed-out");
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetchImpl ?? fetch)(OLLAMA_BALANCE_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey.trim()}` }, redirect: "manual", signal,
    });
    signal.throwIfAborted();
    if (response.status === 401 || response.status === 403) return failure(`Ollama balance request was rejected (${response.status}).`, "signed-out");
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (response.status === 429) return failure("Ollama balance request was rate limited (429).", "rate-limited", retryAfter);
    if (response.status !== 200) return failure(`Ollama balance request failed (${response.status}).`, "server-error", retryAfter);
    let data: ProviderUsageData;
    try { data = parseOllamaBalance(await response.json()); }
    catch { signal.throwIfAborted(); return failure("Ollama balance response is unreadable.", "unreadable"); }
    signal.throwIfAborted();
    return usageSnapshot("ollama-cloud", credentialId, data);
  } catch {
    options.signal?.throwIfAborted();
    return failure("Ollama balance request failed.", "unreachable");
  }
}

/** Parses `GET /api/balance`: a monthly USD allowance, or session and weekly percentages on legacy plans, plus purchased credits. */
export function parseOllamaBalance(payload: unknown): ProviderUsageData {
  const body = asRecord(payload);
  if (!body) throw new Error("Ollama balance response is not an object.");
  const included = asRecord(body.included);
  const windows: ProviderUsageWindow[] = [];
  const monthly = included && allowanceWindow(included);
  if (monthly) windows.push(monthly);
  for (const [id, label, windowSeconds] of [["session", "Session", SESSION_SECONDS], ["weekly", "Weekly", WEEK_SECONDS]] as const) {
    const window = included && percentWindow(asRecord(included[id]), id, label, windowSeconds);
    if (window) windows.push(window);
  }
  const purchased = finite(asRecord(body.purchased)?.balance_usd);
  const balance = purchased === null ? null : { amount: purchased, unit: "USD" };
  if (!windows.length && !balance) return { status: "unknown", plan: null, windows, balance, errorCode: "no-limits" };
  return { status: windows.length ? "ok" : "unknown", plan: null, windows, balance };
}

function allowanceWindow(included: Record<string, unknown>): ProviderUsageWindow | null {
  const remaining = finite(included.balance_usd);
  const limit = finite(included.allowance_usd);
  if (remaining === null || limit === null || limit <= 0) return null;
  const period = asRecord(included.period);
  const from = timestamp(period?.from);
  const until = timestamp(period?.until);
  const remainingPercent = clampPercent(remaining / limit * 100);
  return quotaWindow({
    id: "monthly", label: "Monthly", usedPercent: 100 - remainingPercent, remainingPercent, resetAt: until,
    ...(from !== null && until !== null && until > from ? { windowSeconds: Math.round((until - from) / 1000) } : {}),
    used: Math.max(0, limit - remaining), limit, remaining, unit: "USD",
  });
}

function percentWindow(entry: Record<string, unknown> | null, id: string, label: string, windowSeconds: number): ProviderUsageWindow | null {
  const value = finite(entry?.remaining_percent);
  if (value === null) return null;
  const remainingPercent = clampPercent(value);
  return quotaWindow({ id, label, usedPercent: 100 - remainingPercent, remainingPercent, resetAt: timestamp(entry?.resets_at), windowSeconds });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
