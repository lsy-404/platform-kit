import { quotaWindow, usageSnapshot, type ProviderUsageData, type ProviderUsageRequestOptions, type ProviderUsageSnapshot, type ProviderUsageWindow } from "./usage.js";

export const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const REQUEST_TIMEOUT_MS = 15_000;
const WINDOWS = [
  { key: "rolling", id: "rolling", label: "Rolling", kind: "session", windowSeconds: 18_000 },
  { key: "weekly", id: "weekly", label: "Weekly", kind: "weekly", windowSeconds: 604_800 },
  { key: "monthly", id: "monthly", label: "Monthly", kind: "monthly", windowSeconds: 2_592_000 },
] as const;

/** Reads the `usage` object of the OpenCode Go usage endpoint; throws when the session and weekly windows are not both readable. */
export function parseOpencodeGoUsage(payload: unknown): ProviderUsageData {
  const usage = asRecord(asRecord(payload)?.usage);
  if (!usage) throw new Error("OpenCode Go usage response is unreadable.");
  const windows: ProviderUsageWindow[] = [];
  for (const { key, id, label, kind, windowSeconds } of WINDOWS) {
    const entry = asRecord(usage[key]);
    if (!entry) continue;
    const usedPercent = typeof entry.percent === "number" && Number.isFinite(entry.percent)
      ? Math.max(0, Math.min(100, entry.percent))
      : entry.status === "rate-limited" ? 100 : null;
    if (usedPercent === null) continue;
    const resetAt = typeof entry.resetsAt === "string" ? Date.parse(entry.resetsAt) : NaN;
    windows.push({
      ...quotaWindow({ id, label, usedPercent, remainingPercent: 100 - usedPercent, resetAt: Number.isFinite(resetAt) ? resetAt : null, windowSeconds }),
      kind,
    });
  }
  if (!windows.some(window => window.kind === "session") || !windows.some(window => window.kind === "weekly")) {
    throw new Error("OpenCode Go usage response is missing required windows.");
  }
  return { plan: "Go", windows, balance: null };
}

export async function queryOpencodeGoKeyUsage(apiKey: string, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageSnapshot> {
  options.signal?.throwIfAborted();
  const credentialId = options.credentialId ?? "opencode-go-key";
  const failure = (error: string, errorCode: NonNullable<ProviderUsageSnapshot["errorCode"]>) => usageSnapshot("opencode-go", credentialId, {
    status: "error", plan: null, windows: [], balance: null, error, errorCode,
  });
  if (typeof apiKey !== "string" || !apiKey.trim()) return failure("An OpenCode Go API key is required.", "signed-out");
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetchImpl ?? fetch)(OPENCODE_GO_USAGE_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey.trim()}` }, redirect: "manual", signal,
    });
    signal.throwIfAborted();
    if (response.status === 403) {
      // A bare 403 can come from a proxy or WAF; only the application's entitlement error means "no Go plan".
      const body = asRecord(await response.json().catch(() => null));
      signal.throwIfAborted();
      if (asRecord(body?.error)?.type === "EntitlementError") {
        return usageSnapshot("opencode-go", credentialId, { status: "unknown", plan: null, windows: [], balance: null, errorCode: "no-limits" });
      }
      return failure("OpenCode Go usage request failed (403).", "server-error");
    }
    if (response.status === 401) return failure("OpenCode Go usage request was rejected (401).", "signed-out");
    if (response.status === 429) return failure("OpenCode Go usage request was rate limited (429).", "rate-limited");
    if (response.status !== 200) return failure(`OpenCode Go usage request failed (${response.status}).`, "server-error");
    let data: ProviderUsageData;
    try { data = parseOpencodeGoUsage(await response.json()); }
    catch { signal.throwIfAborted(); return failure("OpenCode Go usage response is unreadable.", "unreadable"); }
    signal.throwIfAborted();
    return usageSnapshot("opencode-go", credentialId, data);
  } catch {
    options.signal?.throwIfAborted();
    return failure("OpenCode Go usage request failed.", "unreachable");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
