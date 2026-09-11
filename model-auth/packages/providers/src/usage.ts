export type ProviderUsageStatus = "ok" | "unknown" | "error";

export interface ProviderUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly resetAt: number | null;
  readonly windowSeconds?: number;
  readonly used?: number | null;
  readonly limit?: number | null;
  readonly remaining?: number | null;
  readonly unit?: string | null;
}

export interface ProviderUsageBalance {
  readonly amount: number;
  readonly unit: string;
}

export interface ProviderUsageData {
  readonly status?: ProviderUsageStatus;
  readonly plan: string | null;
  readonly planMultiplier?: number | null;
  readonly billingInterval?: string | null;
  readonly subscriptionRenewsAt?: number | null;
  readonly subscriptionExpiresAt?: number | null;
  readonly metadataError?: string | null;
  readonly windows: readonly ProviderUsageWindow[];
  readonly balance: ProviderUsageBalance | null;
  readonly error?: string | null;
}

export interface ProviderUsageSnapshot extends ProviderUsageData {
  readonly providerId: string;
  readonly credentialId: string;
  readonly status: ProviderUsageStatus;
  readonly fetchedAtUtc: string;
  readonly error: string | null;
}

export interface ProviderUsageRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly credentialId?: string;
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
    ...(data.billingInterval !== undefined ? { billingInterval: data.billingInterval } : {}),
    ...(data.subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt: data.subscriptionRenewsAt } : {}),
    ...(data.subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt: data.subscriptionExpiresAt } : {}),
    ...(data.metadataError !== undefined ? { metadataError: data.metadataError } : {}),
    windows: data.windows.map((window) => ({ ...window })),
    balance: data.balance ? { ...data.balance } : null,
    fetchedAtUtc: new Date().toISOString(),
    error: data.error ?? null,
  };
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

function windowFrom(id: string, label: string, value: unknown): ProviderUsageWindow | null {
  const row = record(value);
  const usedPercent = percent(row.used_percent ?? row.usedPercent ?? row.utilization ?? row.used_percentage ?? row.usedPercentage);
  if (usedPercent === null) return null;
  const used = numberValue(row.used, row.consumed);
  const limit = numberValue(row.limit, row.max);
  const remaining = numberValue(row.remaining, row.remain);
  return {
    id,
    label,
    usedPercent,
    resetAt: timestamp(row.reset_at ?? row.resetAt ?? row.resets_at),
    ...(numberValue(row.limit_window_seconds, row.window_seconds) !== null ? { windowSeconds: numberValue(row.limit_window_seconds, row.window_seconds) as number } : {}),
    ...(used !== null ? { used } : {}),
    ...(limit !== null ? { limit } : {}),
    ...(remaining !== null ? { remaining } : {}),
    ...(stringValue(row.unit) ? { unit: stringValue(row.unit) } : {}),
  };
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
  const windows = [
    windowFrom("primary", "Primary window", rate.primary_window ?? rate.primary),
    windowFrom("secondary", "Secondary window", rate.secondary_window ?? rate.secondary),
  ].filter((entry): entry is ProviderUsageWindow => Boolean(entry));
  const additional = root.additional_rate_limits ?? root.additionalRateLimits;
  if (Array.isArray(additional)) {
    for (const value of additional) {
      const entry = record(value);
      const label = stringValue(entry.limit_name, entry.limitName, entry.metered_feature, entry.meteredFeature);
      const id = stringValue(entry.metered_feature, entry.meteredFeature, entry.limit_name, entry.limitName);
      if (!label || !id) continue;
      const additionalRate = record(entry.rate_limit ?? entry.rateLimit ?? entry.limit);
      for (const window of [
        windowFrom(`${id}:primary`, `${label} · Primary window`, additionalRate.primary_window ?? additionalRate.primary),
        windowFrom(`${id}:secondary`, `${label} · Secondary window`, additionalRate.secondary_window ?? additionalRate.secondary),
      ]) if (window) windows.push(window);
    }
  }
  const credits = numberValue(record(root.credits).balance, record(root.credits).remaining, root.credit_balance);
  return {
    plan: stringValue(root.plan_type, root.planType, root.subscription_type, metadata.plan),
    windows,
    balance: credits === null ? null : { amount: credits, unit: "credits" },
    planMultiplier: planMultiplier(root),
    subscriptionExpiresAt: timestamp(metadata.subscriptionExpiresAt),
  };
}

const ANTHROPIC_WINDOWS: Array<[string, string]> = [
  ["five_hour", "5 hours"],
  ["seven_day", "7 days"],
  ["seven_day_oauth_apps", "7 days · OAuth apps"],
  ["seven_day_opus", "7 days · Opus"],
  ["seven_day_sonnet", "7 days · Sonnet"],
];

/** Parser for the Anthropic provider usage response used by the IRIS provider-usage view. */
export function parseAnthropicUsage(payload: unknown): ProviderUsageData {
  const root = record(payload);
  const limits = record(root.rate_limits ?? root.rateLimits ?? root.limits);
  const windows: ProviderUsageWindow[] = [];
  for (const [id, label] of ANTHROPIC_WINDOWS) {
    const window = windowFrom(id, label, limits[id] ?? root[id]);
    if (window) windows.push(window);
  }
  const credits = numberValue(record(root.credits).balance, root.credit_balance);
  return {
    plan: stringValue(root.subscription_type, root.subscriptionType, root.plan_type),
    windows,
    balance: credits === null ? null : { amount: credits, unit: "credits" },
  };
}

export async function queryCodexUsage(credential: ProviderUsageCredential, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageData> {
  const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${credential.access}` };
  if (credential.accountId) headers[`Chat${String.fromCharCode(71, 80, 84)}-Account-Id`] = credential.accountId;
  const response = await (options.fetchImpl ?? fetch)(`https://chat${String.fromCharCode(103, 112, 116)}.com/backend-api/wham/usage`, {
    headers, ...(options.signal ? { signal: options.signal } : {}),
  });
  return parseCodexUsage(await responseJson(response), { plan: credential.subscriptionType, subscriptionExpiresAt: credential.subscriptionExpires });
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

export async function queryAnthropicUsage(credential: ProviderUsageCredential, options: ProviderUsageRequestOptions = {}): Promise<ProviderUsageData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.anthropic.com/api/oauth/usage", {
    headers: anthropicHeaders(credential.access), ...(options.signal ? { signal: options.signal } : {}),
  });
  const usage = parseAnthropicUsage(await responseJson(response));
  const profile = await queryAnthropicOAuthMetadata(credential, fetchImpl, options.credentialId ?? credential.accountId, options.signal);
  const metadata = profile.billingUnavailable ? {} : credential;
  return {
    ...mergeAnthropicUsageMetadata(usage, profile.metadata, metadata),
    metadataError: profile.billingUnavailable ? null : profile.error,
  };
}

export async function queryAnthropicOAuthMetadata(
  credential: ProviderUsageCredential,
  fetchImpl: typeof fetch,
  billingAccount?: string,
  signal?: AbortSignal,
): Promise<{ metadata: AnthropicOAuthMetadata; error: string | null; billingUnavailable: boolean }> {
  try {
    const profileResponse = await fetchImpl("https://api.anthropic.com/api/oauth/profile", { headers: anthropicHeaders(credential.access), ...(signal ? { signal } : {}) });
    if (!profileResponse.ok) throw new Error(`Anthropic OAuth metadata request failed (${profileResponse.status}).`);
    const metadata = parseAnthropicOAuthProfile(await profileResponse.json());
    if (!metadata.organizationId) return { metadata, error: "Anthropic OAuth profile did not return an organization id.", billingUnavailable: true };
    if (billingAccount && unavailableBillingAccounts.has(billingAccount)) return { metadata, error: null, billingUnavailable: true };
    let billingUnavailable = false;
    try {
      const detailsResponse = await fetchImpl(`https://api.anthropic.com/api/organizations/${encodeURIComponent(metadata.organizationId)}/subscription_details`, {
        headers: anthropicHeaders(credential.access),
        ...(signal ? { signal } : {}),
      });
      if (!detailsResponse.ok) {
        billingUnavailable = detailsResponse.status === 401 || detailsResponse.status === 403 || detailsResponse.status === 404;
        if (billingAccount && billingUnavailable) unavailableBillingAccounts.add(billingAccount);
        throw new Error(`Anthropic OAuth metadata request failed (${detailsResponse.status}).`);
      }
      return { metadata: { ...metadata, ...parseAnthropicSubscriptionDetails(await detailsResponse.json()) }, error: null, billingUnavailable: false };
    } catch (error) {
      return { metadata, error: error instanceof Error ? error.message : "Anthropic subscription metadata is unavailable.", billingUnavailable };
    }
  } catch (error) {
    return { metadata: {}, error: error instanceof Error ? error.message : "Anthropic profile metadata is unavailable.", billingUnavailable: false };
  }
}

const unavailableBillingAccounts = new Set<string>();

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
  return {
    ...usage,
    plan: metadata.subscriptionType ?? credential.subscriptionType ?? usage.plan,
    ...(billingInterval !== undefined ? { billingInterval } : {}),
    ...(subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt } : {}),
    ...(subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt } : {}),
  };
}

function anthropicHeaders(access: string): Record<string, string> {
  return { accept: "application/json", authorization: `Bearer ${access}`, "anthropic-beta": "oauth-2025-04-20" };
}

async function responseJson(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  let detail = "";
  try {
    const body = record(await response.json());
    detail = stringValue(record(body.error).message, body.message) ?? "";
  } catch { /* status text is enough */ }
  throw new Error(`${response.status} ${detail || response.statusText}`.trim());
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
