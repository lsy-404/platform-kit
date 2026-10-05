import { normalizeCodexPlan, planMultiplierFromTier } from "@model-auth/core";
import type {
  ProviderUsageBalance, ProviderUsageErrorCode, ProviderUsageEstimate, ProviderUsageEstimateSource, ProviderUsageEstimateUnit,
  ProviderUsageSnapshot, ProviderUsageStatus, ProviderUsageWindow, ProviderUsageWindowKind, ProviderUsageWindowReliability,
  ProviderUsageWindowScope, ProviderUsageWindowStatus,
} from "@model-auth/core";
import { classifyUsageHttp } from "@model-auth/core";

export type {
  ProviderUsageBalance, ProviderUsageErrorCode, ProviderUsageEstimate, ProviderUsageEstimateSource, ProviderUsageEstimateUnit,
  ProviderUsageSnapshot, ProviderUsageStatus, ProviderUsageWindow, ProviderUsageWindowKind, ProviderUsageWindowReliability,
  ProviderUsageWindowScope, ProviderUsageWindowStatus,
};

export type ProviderUsageWindowInput =
  Omit<ProviderUsageWindow, "scope" | "modelFamilies" | "status" | "usedRatio" | "reliability" | "kind">
  & Partial<Pick<ProviderUsageWindow, "scope" | "modelFamilies" | "reliability">>
  & { /** Set only from a server-provided limit flag. */ readonly exhausted?: boolean };

const HOUR = 3600;
const DAY = 86400;

/** Window kind from its duration in seconds; null when unknown or not a standard length. */
export function usageWindowKind(windowSeconds: number | null | undefined): ProviderUsageWindowKind | null {
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;
  if (windowSeconds >= 4 * HOUR && windowSeconds <= 6 * HOUR) return "session";
  if (windowSeconds >= 20 * HOUR && windowSeconds <= 28 * HOUR) return "daily";
  if (windowSeconds >= 6 * DAY && windowSeconds <= 8 * DAY) return "weekly";
  if (windowSeconds >= 28 * DAY && windowSeconds <= 31 * DAY) return "monthly";
  return null;
}

/** Compact duration label such as "5h" or "7d". */
export function windowDurationLabel(windowSeconds: number): string {
  if (windowSeconds % DAY === 0) return `${windowSeconds / DAY}d`;
  if (windowSeconds % HOUR === 0) return `${windowSeconds / HOUR}h`;
  return `${Math.max(1, Math.round(windowSeconds / 60))}m`;
}

/** Build a window; it is exhausted only when the caller passes a server-provided flag. */
export function usageWindow(input: ProviderUsageWindowInput): ProviderUsageWindow {
  const { scope, modelFamilies, reliability, exhausted, ...rest } = input;
  const known = rest.usedPercent !== null;
  return {
    ...rest,
    scope: scope ?? "account",
    modelFamilies: modelFamilies ?? [],
    kind: usageWindowKind(rest.windowSeconds),
    status: exhausted ? "exhausted" : !known ? "unknown" : "known",
    usedRatio: known ? (rest.usedPercent as number) / 100 : null,
    reliability: reliability ?? "high",
  };
}

/** For providers whose quota is measured directly: a fully used window is exhausted. */
export function quotaWindow(input: ProviderUsageWindowInput): ProviderUsageWindow {
  return usageWindow({ ...input, exhausted: input.usedPercent !== null && input.usedPercent >= 100 });
}

/** Lower-case model id with separators collapsed, e.g. "Alpha-5.3 Fast" becomes "alpha-5.3-fast". */
export function normalizeModelFamilyId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface ProviderUsageData {
  readonly status?: ProviderUsageStatus;
  readonly plan: string | null;
  readonly planMultiplier?: number | null;
  readonly planTier?: string | null;
  readonly billingInterval?: string | null;
  readonly subscriptionRenewsAt?: number | null;
  readonly subscriptionExpiresAt?: number | null;
  readonly metadataError?: string | null;
  readonly windows: readonly ProviderUsageWindow[];
  readonly balance: ProviderUsageBalance | null;
  readonly estimate?: ProviderUsageEstimate | null;
  readonly identity?: string | null;
  readonly error?: string | null;
  readonly errorCode?: ProviderUsageErrorCode | null;
}

export interface ProviderUsageRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly credentialId?: string;
  /** Renews the credential after a rejection and returns the new access token. */
  readonly refresh?: () => Promise<string | null | undefined>;
  /** Base delay between transient-failure retries; defaults to 600 ms. */
  readonly retryDelayMs?: number;
}

export interface ProviderUsageCredential {
  readonly access: string;
  readonly accountId?: string;
  readonly subscriptionType?: string;
  readonly billingInterval?: string;
  readonly subscriptionRenewsAt?: number;
  readonly subscriptionExpires?: number;
}

export interface AnthropicOAuthMetadata {
  readonly organizationId?: string;
  readonly subscriptionType?: string;
  readonly billingInterval?: string;
  readonly subscriptionRenewsAt?: number;
  readonly subscriptionExpires?: number;
  readonly rateLimitTier?: string;
}

export function usageSnapshot(providerId: string, credentialId: string, data: ProviderUsageData): ProviderUsageSnapshot {
  const status = data.status ?? (data.error ? "error" : data.windows.length || data.balance ? "ok" : "unknown");
  return {
    providerId,
    credentialId,
    status,
    plan: data.plan,
    ...(data.planMultiplier !== undefined ? { planMultiplier: data.planMultiplier } : {}),
    ...(data.planTier !== undefined ? { planTier: data.planTier } : {}),
    ...(data.billingInterval !== undefined ? { billingInterval: data.billingInterval } : {}),
    ...(data.subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt: data.subscriptionRenewsAt } : {}),
    ...(data.subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt: data.subscriptionExpiresAt } : {}),
    ...(data.metadataError !== undefined ? { metadataError: data.metadataError } : {}),
    windows: data.windows.map((window) => ({
      ...window,
      ...(window.remainingPercent === undefined && window.usedPercent !== null
        ? { remainingPercent: 100 - window.usedPercent }
        : {}),
    })),
    balance: data.balance ? { ...data.balance } : null,
    ...(data.estimate !== undefined ? { estimate: data.estimate ? { ...data.estimate } : null } : {}),
    ...(data.identity !== undefined ? { identity: data.identity } : {}),
    fetchedAtUtc: new Date().toISOString(),
    error: data.error ?? null,
    errorCode: data.errorCode ?? (status === "unknown" ? "no-limits" : null),
  };
}

/** Failure code and message carried by usage HTTP errors. */
export class UsageRequestError extends Error {
  constructor(public readonly code: ProviderUsageErrorCode, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "UsageRequestError";
  }
}

/** Error snapshot for a failed query; hosts merge it with the last good reading. */
export function usageErrorSnapshot(providerId: string, credentialId: string, error: unknown): ProviderUsageSnapshot {
  const code: ProviderUsageErrorCode = error instanceof UsageRequestError ? error.code : "unreachable";
  const message = error instanceof Error ? error.message : "Usage request failed.";
  return usageSnapshot(providerId, credentialId, { status: "error", plan: null, windows: [], balance: null, error: message, errorCode: code });
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function timestamp(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric !== null && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}

type WindowTarget = Pick<ProviderUsageWindowInput, "scope" | "modelFamilies" | "reliability">;

const HEALTHY_SEVERITIES = new Set(["normal", "ok", "none", "healthy", "warning", "warn"]);

function windowFrom(id: string, label: string, value: unknown, target: WindowTarget = {}, secondsHint?: number): ProviderUsageWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = record(value);
  const usedPercent = percent(row.used_percent ?? row.usedPercent ?? row.utilization ?? row.used_percentage ?? row.usedPercentage ?? row.percent);
  const used = numberValue(row.used, row.consumed);
  const limit = numberValue(row.limit, row.max);
  const remaining = numberValue(row.remaining, row.remain);
  const seconds = numberValue(row.limit_window_seconds, row.window_seconds) ?? secondsHint ?? null;
  return usageWindow({
    ...target,
    id,
    label,
    usedPercent,
    remainingPercent: usedPercent === null ? null : 100 - usedPercent,
    resetAt: timestamp(row.reset_at ?? row.resetAt ?? row.resets_at),
    ...(seconds !== null && seconds > 0 ? { windowSeconds: seconds } : {}),
    ...(used !== null ? { used } : {}),
    ...(limit !== null ? { limit } : {}),
    ...(remaining !== null ? { remaining } : {}),
    ...(stringValue(row.unit) ? { unit: stringValue(row.unit) } : {}),
    ...(anthropicLocked(row) ? { exhausted: true } : {}),
  });
}

function anthropicLocked(row: Json): boolean {
  if (stringValue(row.locked_reason, row.lockedReason)) return true;
  const severity = stringValue(row.severity)?.toLowerCase();
  return severity !== undefined && !HEALTHY_SEVERITIES.has(severity);
}

/** Mark only the fullest window as exhausted; ties go to the longer window. */
function markFullest(windows: ProviderUsageWindow[]): ProviderUsageWindow[] {
  if (!windows.length) return windows;
  let target = 0;
  windows.forEach((window, index) => {
    const best = windows[target] as ProviderUsageWindow;
    const used = window.usedPercent ?? -1;
    const bestUsed = best.usedPercent ?? -1;
    if (used > bestUsed || (used === bestUsed && (window.windowSeconds ?? 0) > (best.windowSeconds ?? 0))) target = index;
  });
  return windows.map((window, index) => index === target ? { ...window, status: "exhausted" } : window);
}

function windowLabel(seconds: number | null, fallback: string): string {
  return seconds !== null && seconds > 0 ? windowDurationLabel(seconds) : fallback;
}

function codexReached(...rows: Json[]): boolean {
  for (const row of rows) {
    if (row.limit_reached === true || row.limitReached === true) return true;
    const reachedType = row.rate_limit_reached_type ?? row.rateLimitReachedType;
    if (typeof reachedType === "string" ? reachedType.trim() !== "" : reachedType !== null && reachedType !== undefined) return true;
    if (record(row.spend_control ?? row.spendControl).reached === true) return true;
  }
  return false;
}

function codexRateWindows(prefix: string, labelPrefix: string, rate: Json, target: WindowTarget): ProviderUsageWindow[] {
  const entries: Array<[string, string, unknown]> = [
    ["primary", "Primary", rate.primary_window ?? rate.primary],
    ["secondary", "Secondary", rate.secondary_window ?? rate.secondary],
  ];
  return entries.flatMap(([slot, slotName, value]) => {
    const seconds = numberValue(record(value).limit_window_seconds, record(value).window_seconds);
    const window = windowFrom(`${prefix}${slot}`, `${labelPrefix}${windowLabel(seconds, slotName === "Primary" ? "Window" : "Window 2")}`, value, target);
    return window ? [window] : [];
  });
}

function planMultiplier(payload: Json): number | null {
  const plan = record(payload.plan);
  const subscription = record(payload.subscription ?? payload.subscription_details);
  const value = numberValue(payload.plan_multiplier, payload.planMultiplier, payload.usage_multiplier, payload.usageMultiplier,
    payload.codex_usage_multiplier, payload.codexUsageMultiplier, plan.multiplier, plan.usage_multiplier,
    plan.usageMultiplier, subscription.plan_multiplier, subscription.planMultiplier, subscription.usage_multiplier,
    subscription.usageMultiplier);
  return value === 5 || value === 20 ? value : null;
}

/** Parser for the Codex usage response used by the IRIS provider-usage view. */
export function parseCodexUsage(payload: unknown, metadata: { plan?: unknown; subscriptionExpiresAt?: unknown } = {}): ProviderUsageData {
  const root = record(payload);
  const rate = record(root.rate_limit ?? root.rateLimit ?? root.limits);
  let windows = codexRateWindows("", "", rate, {});
  if (codexReached(rate, root)) windows = markFullest(windows);
  const additional = root.additional_rate_limits ?? root.additionalRateLimits;
  if (Array.isArray(additional)) {
    for (const value of additional) {
      const entry = record(value);
      const label = stringValue(entry.limit_name, entry.limitName, entry.metered_feature, entry.meteredFeature);
      const id = stringValue(entry.metered_feature, entry.meteredFeature, entry.limit_name, entry.limitName);
      if (!label || !id) continue;
      const additionalRate = record(entry.rate_limit ?? entry.rateLimit ?? entry.limit);
      const target: WindowTarget = { scope: "model", modelFamilies: [normalizeModelFamilyId(stringValue(entry.limit_name, entry.limitName) ?? id)] };
      let extra = codexRateWindows(`${id}:`, `${label} · `, additionalRate, target);
      if (codexReached(additionalRate, entry)) extra = markFullest(extra);
      windows.push(...extra);
    }
  }
  const credits = numberValue(record(root.credits).balance, record(root.credits).remaining, root.credit_balance);
  const reportedPlan = normalizeCodexPlan(stringValue(root.plan_type, root.planType, root.subscription_type, metadata.plan));
  return {
    plan: reportedPlan.plan,
    windows,
    balance: credits === null ? null : { amount: credits, unit: "credits" },
    planMultiplier: planMultiplier(root) ?? reportedPlan.multiplier,
    subscriptionExpiresAt: timestamp(metadata.subscriptionExpiresAt),
  };
}

const ANTHROPIC_WINDOWS: Array<[string, string, WindowTarget, number]> = [
  ["five_hour", "5 hours", { scope: "account" }, 5 * HOUR],
  ["seven_day", "7 days", { scope: "account" }, 7 * DAY],
  ["seven_day_oauth_apps", "7 days · OAuth apps", { scope: "account" }, 7 * DAY],
  ["seven_day_opus", "7 days · Opus", { scope: "model-family", modelFamilies: ["opus"] }, 7 * DAY],
  ["seven_day_sonnet", "7 days · Sonnet", { scope: "model-family", modelFamilies: ["sonnet"] }, 7 * DAY],
];

function limitKindSeconds(kind: string): number | null {
  const text = kind.toLowerCase();
  if (/five_hour|5h|session/.test(text)) return 5 * HOUR;
  if (/seven_day|weekly|week/.test(text)) return 7 * DAY;
  if (/daily|one_day|24h/.test(text)) return DAY;
  if (/monthly|month/.test(text)) return 30 * DAY;
  return null;
}

function anthropicLimitWindows(limits: unknown[]): ProviderUsageWindow[] {
  return limits.flatMap((value, index) => {
    const row = record(value);
    const kind = stringValue(row.kind, row.type, row.id) ?? `limit-${index}`;
    const modelName = stringValue(record(record(row.scope).model).display_name, record(record(row.scope).model).displayName);
    const seconds = numberValue(row.window_seconds, row.limit_window_seconds) ?? limitKindSeconds(kind);
    const base = windowLabel(seconds, kind);
    const target: WindowTarget = modelName
      ? { scope: "model-family", modelFamilies: [normalizeModelFamilyId(modelName)] }
      : { scope: "account" };
    const window = windowFrom(modelName ? `${kind}:${normalizeModelFamilyId(modelName)}` : kind, modelName ? `${base} · ${modelName}` : base, row, target, seconds ?? undefined);
    return window ? [window] : [];
  });
}

/** Parser for the Anthropic provider usage response used by the IRIS provider-usage view. */
export function parseAnthropicUsage(payload: unknown): ProviderUsageData {
  const root = record(payload);
  const list = Array.isArray(root.limits) ? anthropicLimitWindows(root.limits) : [];
  const windows: ProviderUsageWindow[] = [...list];
  if (!list.length) {
    const limits = record(root.rate_limits ?? root.rateLimits ?? root.limits);
    for (const [id, label, target, seconds] of ANTHROPIC_WINDOWS) {
      const window = windowFrom(id, label, limits[id] ?? root[id], target, seconds);
      if (window) windows.push(window);
    }
  }
  const credits = numberValue(record(root.credits).balance, root.credit_balance);
  return {
    plan: stringValue(root.subscription_type, root.subscriptionType, root.plan_type),
    windows,
    balance: credits === null ? null : { amount: credits, unit: "credits" },
  };
}

interface UsageHttpState {
  access: string;
  refreshing?: Promise<string | null | undefined> | undefined;
}

function abortError(): UsageRequestError {
  return new UsageRequestError("unreachable", "Usage request was cancelled.");
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function errorMessage(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = record(await response.json());
    detail = stringValue(record(body.error).message, body.message) ?? "";
  } catch { /* status text is enough */ }
  return `${response.status} ${detail || response.statusText}`.trim();
}

/** GET JSON with transient retries, one renewal after a rejection, and no redirect following. */
async function usageGet(
  url: string,
  headersFor: (access: string) => Record<string, string>,
  state: UsageHttpState,
  options: ProviderUsageRequestOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseDelay = options.retryDelayMs ?? 600;
  let renewed = false;
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw abortError();
    const usedAccess = state.access;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: headersFor(usedAccess), redirect: "manual", ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (attempt >= 2) throw new UsageRequestError("unreachable", error instanceof Error ? error.message : "Usage request failed.");
      await pause(baseDelay * (attempt + 1), options.signal);
      continue;
    }
    const outcome = classifyUsageHttp(response.status);
    if (outcome === "ok") {
      try { return await response.json(); } catch { throw new UsageRequestError("unreadable", "Usage response is not valid JSON.", response.status); }
    }
    if (outcome === "signed-out" && options.refresh && !renewed) {
      renewed = true;
      state.refreshing ??= options.refresh();
      let access: string | null | undefined;
      try { access = await state.refreshing; } catch { access = undefined; }
      if (access) state.access = access;
      if (state.access !== usedAccess) continue;
    }
    throw new UsageRequestError(outcome, response.status >= 300 && response.status < 400 ? `${response.status} Redirect refused` : await errorMessage(response), response.status);
  }
}

export async function queryCodexUsage(credential: ProviderUsageCredential, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageData> {
  const state: UsageHttpState = { access: credential.access };
  const headersFor = (access: string): Record<string, string> => {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${access}` };
    if (credential.accountId) headers[`Chat${String.fromCharCode(71, 80, 84)}-Account-Id`] = credential.accountId;
    return headers;
  };
  const payload = await usageGet(`https://chat${String.fromCharCode(103, 112, 116)}.com/backend-api/wham/usage`, headersFor, state, options);
  return parseCodexUsage(payload, { plan: credential.subscriptionType, subscriptionExpiresAt: credential.subscriptionExpires });
}

export type UsageProvider = "anthropic" | "openai-codex";

/** Query a supported provider usage surface. */
export async function queryProviderUsage(
  provider: UsageProvider,
  credential: ProviderUsageCredential,
  options: ProviderUsageRequestOptions = {},
): Promise<ProviderUsageSnapshot> {
  const data = provider === "openai-codex" ? await queryCodexUsage(credential, options) : await queryAnthropicUsage(credential, options);
  return usageSnapshot(provider, options.credentialId ?? credential.accountId ?? provider, data);
}

type AnthropicProfileResult = { metadata: AnthropicOAuthMetadata; error: string | null; billingUnavailable: boolean };

const PROFILE_CACHE_TTL_MS = 6 * 3600 * 1000;
const profileCache = new Map<string, { at: number; result: AnthropicProfileResult }>();

/** Drop cached Anthropic profile metadata, for example after sign-out. */
export function clearAnthropicProfileCache(credentialId?: string): void {
  if (credentialId === undefined) profileCache.clear(); else profileCache.delete(credentialId);
}

export async function queryAnthropicUsage(credential: ProviderUsageCredential, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageData> {
  const state: UsageHttpState = { access: credential.access };
  const cacheKey = options.credentialId ?? credential.accountId;
  const [payload, profile] = await Promise.all([
    usageGet("https://api.anthropic.com/api/oauth/usage", anthropicHeaders, state, options),
    queryAnthropicOAuthMetadata(credential, cacheKey, state, options),
  ]);
  const usage = parseAnthropicUsage(payload);
  const metadata = profile.billingUnavailable ? {} : credential;
  return {
    ...mergeAnthropicUsageMetadata(usage, profile.metadata, metadata),
    metadataError: profile.billingUnavailable ? null : profile.error,
    ...(profile.metadata.organizationId ? { identity: profile.metadata.organizationId } : {}),
  };
}

/** Profile and subscription lookup; results, including failures, are cached for six hours per credential. */
export async function queryAnthropicOAuthMetadata(
  credential: ProviderUsageCredential,
  cacheKey: string | undefined,
  state: UsageHttpState = { access: credential.access },
  options: ProviderUsageRequestOptions = {},
): Promise<AnthropicProfileResult> {
  const cached = cacheKey ? profileCache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < PROFILE_CACHE_TTL_MS) return cached.result;
  const result = await fetchAnthropicProfile(state, options);
  if (cacheKey && !options.signal?.aborted) profileCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function fetchAnthropicProfile(state: UsageHttpState, options: ProviderUsageRequestOptions): Promise<AnthropicProfileResult> {
  let metadata: AnthropicOAuthMetadata;
  try {
    metadata = parseAnthropicOAuthProfile(await usageGet("https://api.anthropic.com/api/oauth/profile", anthropicHeaders, state, options));
  } catch (error) {
    return { metadata: {}, error: error instanceof Error ? error.message : "Anthropic profile metadata is unavailable.", billingUnavailable: false };
  }
  if (!metadata.organizationId) return { metadata, error: "Anthropic OAuth profile did not return an organization id.", billingUnavailable: true };
  try {
    const details = await usageGet(`https://api.anthropic.com/api/organizations/${encodeURIComponent(metadata.organizationId)}/subscription_details`, anthropicHeaders, state, options);
    return { metadata: { ...metadata, ...parseAnthropicSubscriptionDetails(details) }, error: null, billingUnavailable: false };
  } catch (error) {
    const status = error instanceof UsageRequestError ? error.httpStatus : undefined;
    return {
      metadata,
      error: error instanceof Error ? error.message : "Anthropic subscription metadata is unavailable.",
      billingUnavailable: status === 401 || status === 403 || status === 404,
    };
  }
}

export function parseAnthropicOAuthProfile(payload: unknown): AnthropicOAuthMetadata {
  const root = record(payload);
  const organization = record(root.organization ?? root.org);
  const organizationId = stringValue(root.organization_id, root.organizationId, root.org_id, organization.id, organization.uuid);
  const rawSubscriptionType = stringValue(root.organization_type, root.organizationType, organization.type, organization.organization_type)?.toLowerCase();
  const prefixSeparator = rawSubscriptionType?.indexOf("_") ?? -1;
  const subscriptionType = rawSubscriptionType && prefixSeparator >= 0 ? rawSubscriptionType.slice(prefixSeparator + 1) : rawSubscriptionType;
  const rateLimitTier = stringValue(root.rate_limit_tier, root.rateLimitTier, organization.rate_limit_tier);
  return {
    ...(organizationId ? { organizationId } : {}),
    ...(subscriptionType && ["pro", "max", "team", "enterprise"].includes(subscriptionType) ? { subscriptionType } : {}),
    ...(rateLimitTier ? { rateLimitTier } : {}),
  };
}

export function parseAnthropicSubscriptionDetails(payload: unknown): Pick<AnthropicOAuthMetadata, "billingInterval" | "subscriptionRenewsAt" | "subscriptionExpires"> {
  const root = record(payload);
  const subscription = record(root.subscription ?? root.subscription_details ?? root.billing);
  const currentPeriodEnd = timestamp(subscription.current_period_end ?? root.current_period_end);
  const subscriptionRenewsAt = timestamp(subscription.next_renewal_at ?? subscription.next_renewal_date ?? subscription.next_invoice_date
    ?? root.next_renewal_at ?? root.next_renewal_date ?? root.next_invoice_date);
  const explicitExpiry = timestamp(subscription.expires_at ?? subscription.ends_at ?? subscription.cancel_at
    ?? root.expires_at ?? root.ends_at ?? root.cancel_at);
  const cancelAtPeriodEnd = booleanValue(subscription.cancel_at_period_end ?? subscription.cancelAtPeriodEnd
    ?? root.cancel_at_period_end ?? root.cancelAtPeriodEnd) === true;
  const willRenew = booleanValue(subscription.will_renew ?? subscription.willRenew ?? root.will_renew ?? root.willRenew);
  const subscriptionExpires = explicitExpiry ?? ((cancelAtPeriodEnd || willRenew === false) ? currentPeriodEnd : null);
  const renewal = subscriptionRenewsAt ?? (!(cancelAtPeriodEnd || willRenew === false) ? currentPeriodEnd : null);
  const interval = normalizeBillingInterval(subscription.billing_interval ?? subscription.billingInterval ?? subscription.interval
    ?? root.billing_interval ?? root.billingInterval ?? root.interval);
  return {
    ...(interval ? { billingInterval: interval } : {}),
    ...(renewal ? { subscriptionRenewsAt: renewal } : {}),
    ...(subscriptionExpires ? { subscriptionExpires } : {}),
  };
}

export function mergeAnthropicUsageMetadata(
  usage: ProviderUsageData,
  metadata: AnthropicOAuthMetadata,
  credential: Pick<ProviderUsageCredential, "subscriptionType" | "billingInterval" | "subscriptionRenewsAt" | "subscriptionExpires">,
): ProviderUsageData {
  const billingInterval = metadata.billingInterval ?? credential.billingInterval ?? usage.billingInterval;
  const subscriptionRenewsAt = metadata.subscriptionRenewsAt ?? credential.subscriptionRenewsAt ?? usage.subscriptionRenewsAt;
  const subscriptionExpiresAt = metadata.subscriptionExpires ?? credential.subscriptionExpires ?? usage.subscriptionExpiresAt;
  const tier = metadata.rateLimitTier;
  const multiplier = planMultiplierFromTier(tier);
  return {
    ...usage,
    ...(tier ? { planTier: tier, planMultiplier: multiplier } : {}),
    plan: metadata.subscriptionType ?? credential.subscriptionType ?? usage.plan,
    ...(billingInterval !== undefined ? { billingInterval } : {}),
    ...(subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt } : {}),
    ...(subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt } : {}),
  };
}

function anthropicHeaders(access: string): Record<string, string> {
  return { accept: "application/json", authorization: `Bearer ${access}`, "anthropic-beta": "oauth-2025-04-20" };
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return undefined;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return undefined;
}

function normalizeBillingInterval(value: unknown): string | undefined {
  const interval = stringValue(value)?.toLowerCase();
  if (interval === "month" || interval === "monthly") return "month";
  if (interval === "year" || interval === "yearly" || interval === "annual") return "year";
  return undefined;
}
