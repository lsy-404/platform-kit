import type { ProviderUsageCredential, ProviderUsageRequestOptions } from "./usage.js";

export type ClaudeResetLimitType =
  | "five_hour"
  | "seven_day"
  | "seven_day_overage_included"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "seven_day_cowork"
  | "seven_day_omelette"
  | "seven_day_oauth_apps";

export interface ClaudeResetGrant {
  readonly id: string;
  readonly label: string | null;
  readonly resetsTotal: number;
  readonly resetsLeft: number;
  readonly startsAt: number | null;
  readonly expiresAt: number;
  readonly clears: readonly ClaudeResetLimitType[];
  readonly givesBackWeekly: boolean;
  readonly paused: boolean;
  readonly usableNow: boolean;
  readonly claimable: boolean;
  readonly useRequiresLimit: boolean;
  readonly percentUsed: Partial<Record<ClaudeResetLimitType, number>>;
  readonly blocking: readonly ClaudeResetLimitType[];
}

export interface ClaudeResetGrants {
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
  readonly atLimit: boolean;
  readonly exhausted: readonly ClaudeResetLimitType[];
  readonly grants: readonly ClaudeResetGrant[];
  readonly nextGrantId: string | null;
  readonly weeklyResetsAt: number | null;
  readonly cooldownUntil: number | null;
}

export interface ClaudeResetRequestOptions {
  readonly fetchImpl: typeof fetch;
  readonly organizationId: string;
  readonly signal?: AbortSignal;
}

export type ClaudeResetResultCode = "reset" | "already_used" | "not_limited" | "cooldown" | "ineligible" | "unavailable" | "unknown";

export interface ClaudeResetRedemption {
  readonly result: ClaudeResetResultCode;
  readonly rawResult: string | null;
  readonly reason: string | null;
  readonly reset: boolean;
  readonly grantId: string | null;
  readonly resetsLeft: number | null;
  readonly cleared: readonly ClaudeResetLimitType[];
  readonly weeklyResetsAt: number | null;
  readonly cooldownUntil: number | null;
}

export interface CodexResetCredit {
  readonly id: string;
  readonly resetType: string;
  readonly status: string;
  readonly grantedAt: number;
  readonly expiresAt: number | null;
  readonly title: string | null;
  readonly description: string | null;
}

export interface CodexResetCredits {
  readonly availableCount: number;
  readonly credits: readonly CodexResetCredit[];
}

export type CodexResetRedemptionCode = "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed" | "unknown";

export interface CodexResetRedemption {
  readonly code: CodexResetRedemptionCode;
  readonly rawCode: string | null;
  readonly windowsReset: number;
}

export interface CodexResetRedemptionInput {
  readonly creditId: string;
  readonly requestId: string;
}

const CLAUDE_ORIGIN = "https://claude.ai";
const CODEX_ORIGIN = "https://chatgpt.com/backend-api/wham";
const RESET_TIMEOUT_MS = 12_000;
const CLAUDE_LIMIT_TYPES: readonly ClaudeResetLimitType[] = [
  "five_hour",
  "seven_day",
  "seven_day_overage_included",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_cowork",
  "seven_day_omelette",
  "seven_day_oauth_apps",
];
const CLAUDE_RESET_RESULTS: readonly ClaudeResetResultCode[] = ["reset", "already_used", "not_limited", "cooldown", "ineligible", "unavailable"];
const CODEX_RESET_CODES: readonly CodexResetRedemptionCode[] = ["reset", "nothing_to_reset", "no_credit", "already_redeemed"];

export async function queryClaudeResetGrants(options: ClaudeResetRequestOptions): Promise<ClaudeResetGrants | null> {
  const organizationId = required(options.organizationId, "Claude organization id");
  const url = `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/usage?cedar_ember=1&skip_spend=1`;
  const payload = await requestJson(options.fetchImpl, url, { method: "GET", headers: { accept: "application/json" }, credentials: "include", redirect: "error" }, options.signal);
  return parseClaudeResetGrants(record(payload).cedar_ember);
}

export async function redeemClaudeResetGrant(
  input: { readonly organizationId: string; readonly grantId: string; readonly requestId: string },
  options: Pick<ClaudeResetRequestOptions, "fetchImpl" | "signal">,
): Promise<ClaudeResetRedemption> {
  const organizationId = required(input.organizationId, "Claude organization id");
  const grantId = required(input.grantId, "Claude reset grant id");
  const requestId = requiredUuid(input.requestId, "Claude reset request id");
  const payload = await requestJson(options.fetchImpl, `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/reset_rate_limits`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "include",
    redirect: "error",
    body: JSON.stringify({ program: "cedar_ember", grant_id: grantId, request_id: requestId }),
  }, options.signal);
  return parseClaudeResetRedemption(payload);
}

export async function queryCodexResetCredits(
  credential: ProviderUsageCredential,
  options: ProviderUsageRequestOptions = {},
): Promise<CodexResetCredits> {
  const payload = await requestJson(options.fetchImpl ?? fetch, `${CODEX_ORIGIN}/rate-limit-reset-credits`, {
    method: "GET",
    headers: codexHeaders(credential),
    redirect: "manual",
  }, options.signal);
  return parseCodexResetCredits(payload);
}

export async function redeemCodexResetCredit(
  credential: ProviderUsageCredential,
  input: CodexResetRedemptionInput,
  options: ProviderUsageRequestOptions = {},
): Promise<CodexResetRedemption> {
  const creditId = required(input.creditId, "Codex reset credit id");
  const requestId = required(input.requestId, "Codex reset request id");
  const payload = await requestJson(options.fetchImpl ?? fetch, `${CODEX_ORIGIN}/rate-limit-reset-credits/consume`, {
    method: "POST",
    headers: { ...codexHeaders(credential), "content-type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ redeem_request_id: requestId, credit_id: creditId }),
  }, options.signal);
  return parseCodexResetRedemption(payload);
}

export function parseClaudeResetGrants(value: unknown): ClaudeResetGrants | null {
  const root = record(value);
  if (typeof root.eligible !== "boolean") return null;
  const eligible = root.eligible;
  const atLimit = root.at_limit === true;
  const exhausted = atLimit ? limitTypes(root.exhausted) : [];
  const cooldownUntil = timestamp(root.cooldown_until);
  const nextGrantId = cooldownUntil === null ? nonEmptyString(root.next_grant_id) : null;
  const seen = new Set<string>();
  const grants: ClaudeResetGrant[] = [];
  for (const item of eligible && Array.isArray(root.grants) ? root.grants : []) {
    const grant = parseClaudeResetGrant(item, nextGrantId, atLimit, exhausted, cooldownUntil !== null);
    if (grant && !seen.has(grant.id)) {
      seen.add(grant.id);
      grants.push(grant);
    }
  }
  const next = grants.find((grant) => grant.usableNow && claimAllowed(grant, atLimit, exhausted)) ?? null;
  return {
    eligible,
    ineligibleReason: eligible ? null : nonEmptyString(root.ineligible_reason),
    atLimit,
    exhausted,
    grants: grants.map((grant) => ({
      ...grant,
      usableNow: grant === next,
      claimable: grant.claimable && cooldownUntil === null && claimAllowed(grant, atLimit, exhausted),
    })),
    nextGrantId: next?.id ?? null,
    weeklyResetsAt: timestamp(root.weekly_resets_at),
    cooldownUntil,
  };
}

export function parseCodexResetCredits(value: unknown): CodexResetCredits {
  const root = record(value);
  const availableCount = integer(root.available_count);
  if (availableCount === null || !Array.isArray(root.credits)) throw new Error("Codex reset credits response is invalid.");
  return {
    availableCount,
    credits: root.credits.map((value) => {
      const item = record(value);
      const id = nonEmptyString(item.id);
      const resetType = nonEmptyString(item.reset_type);
      const status = nonEmptyString(item.status);
      const grantedAt = timestamp(item.granted_at);
      const expiresAt = item.expires_at === null || item.expires_at === undefined ? null : timestamp(item.expires_at);
      if (!id || !resetType || !status || grantedAt === null || (item.expires_at != null && expiresAt === null)) {
        throw new Error("Codex reset credit entry is invalid.");
      }
      return {
        id,
        resetType,
        status,
        grantedAt,
        expiresAt,
        title: nonEmptyString(item.title),
        description: nonEmptyString(item.description),
      };
    }),
  };
}

function parseClaudeResetGrant(value: unknown, nextGrantId: string | null, atLimit: boolean, exhausted: readonly ClaudeResetLimitType[], coolingDown: boolean): ClaudeResetGrant | null {
  const root = record(value);
  const id = nonEmptyString(root.id);
  const resetsTotal = integer(root.resets_total);
  const resetsLeft = integer(root.resets_left);
  const endsAt = timestamp(root.ends_at);
  if (!id || !/^[a-z0-9_-]{1,40}$/.test(id) || resetsTotal === null || resetsTotal < 1 || resetsLeft === null || endsAt === null) return null;
  const clears = limitTypes(root.clears);
  const givesBackWeekly = root.gives_back_weekly === true;
  const blocking = limitTypes(root.blocking).filter((type) => !clears.includes(type));
  const paused = root.paused === true;
  const usable = root.usable_now === true && !paused && blocking.length === 0;
  const useRequiresLimit = root.use_requires_limit !== false;
  const percentUsed: Partial<Record<ClaudeResetLimitType, number>> = {};
  const percentages = record(root.percent_used);
  for (const type of clears) {
    const value = percentages[type];
    if (typeof value === "number" && Number.isFinite(value)) percentUsed[type] = Math.max(0, Math.min(100, Math.round(value)));
  }
  const grant: ClaudeResetGrant = {
    id,
    label: nonEmptyString(root.label),
    resetsTotal,
    resetsLeft: Math.min(resetsLeft, resetsTotal),
    startsAt: timestamp(root.starts_at),
    expiresAt: endsAt,
    clears,
    givesBackWeekly,
    paused,
    usableNow: usable && id === nextGrantId,
    claimable: usable,
    useRequiresLimit,
    percentUsed,
    blocking,
  };
  return { ...grant, claimable: grant.claimable && !coolingDown && claimAllowed(grant, atLimit, exhausted) };
}

function claimAllowed(grant: ClaudeResetGrant, atLimit: boolean, exhausted: readonly ClaudeResetLimitType[]): boolean {
  if (!grant.useRequiresLimit) return true;
  const clears: readonly ClaudeResetLimitType[] = grant.givesBackWeekly && !grant.clears.includes("seven_day")
    ? [...grant.clears, "seven_day"]
    : grant.clears;
  return atLimit && clears.some((type) => exhausted.includes(type));
}

function parseClaudeResetRedemption(value: unknown): ClaudeResetRedemption {
  const root = record(value);
  const rawResult = nonEmptyString(root.result);
  const result = rawResult && CLAUDE_RESET_RESULTS.includes(rawResult as ClaudeResetResultCode)
    ? rawResult as ClaudeResetResultCode
    : "unknown";
  return {
    result,
    rawResult,
    reason: nonEmptyString(root.reason),
    reset: root.reset === true,
    grantId: nonEmptyString(root.grant_id),
    resetsLeft: integer(root.resets_left),
    cleared: limitTypes(root.cleared),
    weeklyResetsAt: timestamp(root.weekly_resets_at),
    cooldownUntil: timestamp(root.cooldown_until),
  };
}

function parseCodexResetRedemption(value: unknown): CodexResetRedemption {
  const root = record(value);
  const rawCode = nonEmptyString(root.code);
  const code = rawCode && CODEX_RESET_CODES.includes(rawCode as CodexResetRedemptionCode)
    ? rawCode as CodexResetRedemptionCode
    : "unknown";
  const windowsReset = root.windows_reset === undefined ? 0 : integer(root.windows_reset);
  if (windowsReset === null) throw new Error("Codex reset redemption response is invalid.");
  return { code, rawCode, windowsReset };
}

async function requestJson(fetchImpl: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(RESET_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "manual", signal: requestSignal });
  } catch (error) {
    if (signal?.aborted) throw new Error("Reset credit request was cancelled.");
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "Reset credit request timed out." : "Reset credit request failed.");
  }
  if (!response.ok || response.redirected) throw new Error(`Reset credit request failed (${response.status}).`);
  try { return await response.json(); } catch { throw new Error("Reset credit response is invalid JSON."); }
}

function codexHeaders(credential: ProviderUsageCredential): Record<string, string> {
  if (typeof credential?.access !== "string" || !credential.access.trim()) throw new Error("OpenAI OAuth access token is required.");
  const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${credential.access}` };
  if (typeof credential.accountId === "string" && credential.accountId.trim()) headers["ChatGPT-Account-ID"] = credential.accountId.trim();
  return headers;
}

function limitTypes(value: unknown): ClaudeResetLimitType[] {
  return Array.isArray(value) ? CLAUDE_LIMIT_TYPES.filter((type) => value.includes(type)) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function required(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function requiredUuid(value: string, label: string): string {
  const result = required(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return result;
}
