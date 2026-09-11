import { authorizeBrowserOAuth, refreshBrowserOAuth, type BrowserOAuthAuthorizationOptions, type BrowserOAuthCredential, type BrowserOAuthRefreshOptions } from "./browser-oauth.js";
import { usageSnapshot, type ProviderUsageData, type ProviderUsageRequestOptions, type ProviderUsageSnapshot, type ProviderUsageWindow } from "./usage.js";

export const GROK_ENDPOINTS = Object.freeze({
  issuer: "https://auth.x.ai",
  authorize: "https://auth.x.ai/oauth2/authorize",
  token: "https://auth.x.ai/oauth2/token",
  deviceCode: "https://auth.x.ai/oauth2/device/code",
  apiBase: "https://cli-chat-proxy.grok.com/v1",
  billing: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
  billingDefault: "https://cli-chat-proxy.grok.com/v1/billing",
});

export const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
export const GROK_DEFAULT_CLIENT_VERSION = "0.2.99";

export interface GrokOAuthCredential extends BrowserOAuthCredential {
  readonly label?: string;
  readonly email?: string;
  readonly teamId?: string;
  readonly authMode?: string;
}

export type GrokAuthorizationOptions = BrowserOAuthAuthorizationOptions;
export type GrokRefreshOptions = BrowserOAuthRefreshOptions;

const GROK_OAUTH_CONFIG = {
  authorizeUrl: GROK_ENDPOINTS.authorize,
  tokenUrl: GROK_ENDPOINTS.token,
  clientId: GROK_OAUTH_CLIENT_ID,
  redirectUri: "http://127.0.0.1:56121/callback",
  callbackPath: "/callback",
  scope: GROK_OAUTH_SCOPE,
  extraAuthorize: { referrer: "grok-build" },
  tokenEncoding: "form" as const,
  accountIdFromAccess: accessTokenSubject,
};

export async function authorizeGrok(options: GrokAuthorizationOptions): Promise<GrokOAuthCredential> {
  const credential = await authorizeBrowserOAuth(GROK_OAUTH_CONFIG, options);
  return { ...credential, ...(credential.accountId ? { label: credential.accountId } : {}) };
}

export async function refreshGrok(credential: GrokOAuthCredential, options: GrokRefreshOptions = {}): Promise<GrokOAuthCredential> {
  const refreshed = await refreshBrowserOAuth(GROK_OAUTH_CONFIG, credential, options);
  return { ...credential, ...refreshed };
}

export function grokHeaders(credential: Pick<GrokOAuthCredential, "access">, clientVersion = GROK_DEFAULT_CLIENT_VERSION): Record<string, string> {
  if (typeof credential.access !== "string" || !credential.access.trim()) throw new Error("Grok OAuth access token is required.");
  if (typeof clientVersion !== "string" || !clientVersion.trim() || clientVersion.length > 64) throw new Error("Grok client version is invalid.");
  return {
    accept: "application/json",
    authorization: `Bearer ${credential.access}`,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": clientVersion.trim(),
  };
}

export interface GrokUsageRequestOptions extends ProviderUsageRequestOptions {
  readonly clientVersion?: string;
}

export async function queryGrokUsage(
  credential: GrokOAuthCredential,
  options: GrokUsageRequestOptions = {},
): Promise<ProviderUsageSnapshot> {
  const credentialId = options.credentialId ?? credential.accountId ?? "grok-oauth";
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = grokHeaders(credential, options.clientVersion);
  try {
    const credits = await requestJson(GROK_ENDPOINTS.billing, headers, fetchImpl, options.signal);
    const parsed = parseGrokBilling(credits);
    if (parsed.status !== "unknown") return usageSnapshot("grok", credentialId, parsed);
    try {
      const monthly = await requestJson(GROK_ENDPOINTS.billingDefault, headers, fetchImpl, options.signal);
      const fallback = parseGrokBilling(monthly);
      if (fallback.status !== "unknown") return usageSnapshot("grok", credentialId, { ...fallback, plan: fallback.plan ?? parsed.plan });
    } catch {
      // The credits response is retained below so a secondary endpoint outage does not erase its plan metadata.
    }
    return usageSnapshot("grok", credentialId, { ...parsed, status: "unknown", error: "Grok usage fields are unavailable." });
  } catch (error) {
    return usageSnapshot("grok", credentialId, {
      status: "error",
      plan: null,
      windows: [],
      balance: null,
      error: error instanceof Error ? error.message : "Grok usage request failed.",
    });
  }
}

export function parseGrokBilling(payload: unknown): ProviderUsageData {
  const root = object(payload);
  const config = object(root.config ?? root);
  const currentPeriod = object(config.currentPeriod ?? config.current_period ?? config.billingCycle ?? config.billing_cycle);
  const resetAt = timestamp(currentPeriod.end ?? currentPeriod.billingPeriodEnd ?? config.billingPeriodEnd ?? config.billing_period_end);
  const periodStart = timestamp(currentPeriod.start ?? currentPeriod.billingPeriodStart ?? config.billingPeriodStart ?? config.billing_period_start);
  const periodIsCurrent = periodStart === null || resetAt === null || (periodStart <= Date.now() && Date.now() < resetAt);
  const explicitPercent = percent(config.creditUsagePercent ?? config.credit_usage_percent ?? config.usagePercent ?? config.usage_percent);
  const onDemandCap = amount(config.onDemandCap ?? config.on_demand_cap);
  const onDemandUsed = amount(config.onDemandUsed ?? config.on_demand_used);
  const monthlyLimit = amount(config.monthlyLimit ?? config.monthly_limit);
  const usage = object(config.usage);
  const includedUsed = amount(usage.includedUsed ?? usage.included_used ?? usage.totalUsed ?? usage.total_used);
  const prepaid = amount(config.prepaidBalance ?? config.prepaid_balance);
  const windows: ProviderUsageWindow[] = [];
  if (periodIsCurrent && explicitPercent !== null) {
    windows.push({ id: "credits", label: periodLabel(periodStart, resetAt), usedPercent: explicitPercent, resetAt });
  } else if (periodIsCurrent && monthlyLimit !== null && monthlyLimit > 0 && includedUsed !== null) {
    windows.push({ id: "included", label: "Monthly included", usedPercent: ratioPercent(includedUsed, monthlyLimit), resetAt,
      used: includedUsed, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - includedUsed), unit: "credits" });
  } else if (periodIsCurrent && onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null) {
    windows.push({ id: "on-demand", label: "On-demand", usedPercent: ratioPercent(onDemandUsed, onDemandCap), resetAt,
      used: onDemandUsed, limit: onDemandCap, remaining: Math.max(0, onDemandCap - onDemandUsed), unit: "credits" });
  }
  const plan = firstText(config.subscriptionTierDisplay, config.subscription_tier_display, config.subscriptionTier, config.subscription_tier, config.plan, root.plan);
  return {
    plan,
    windows,
    balance: prepaid === null ? null : { amount: prepaid, unit: "credits" },
    ...(windows.length || prepaid !== null ? { status: "ok" as const } : { status: "unknown" as const }),
  };
}

async function requestJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { headers, redirect: "error", ...(signal ? { signal } : {}) });
  if (!response.ok || response.redirected) throw new Error(`Grok usage request failed (${response.status}).`);
  try { return await response.json(); } catch { throw new Error("Grok usage response is invalid."); }
}

function accessTokenSubject(value: string): string | undefined {
  const payload = value.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return firstText(decoded.sub, decoded.user_id, decoded.userId) ?? undefined;
  } catch { return undefined; }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function amount(value: unknown): number | null {
  const row = object(value);
  const raw = Object.keys(row).length ? row.val ?? row.value ?? row.amount : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  const parsed = amount(value);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}

function ratioPercent(used: number, limit: number): number {
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function timestamp(value: unknown): number | null {
  const parsed = amount(value);
  if (parsed !== null && parsed > 0) return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : null;
}

function periodLabel(start: number | null, end: number | null): string {
  if (start !== null && end !== null) {
    const days = Math.round((end - start) / 86_400_000);
    if (days >= 6 && days <= 8) return "Weekly credits";
    if (days >= 27 && days <= 32) return "Monthly credits";
  }
  return "Credits";
}
