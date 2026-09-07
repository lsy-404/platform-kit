import { CookieJar } from "tough-cookie";

export const WORKBUDDY_ENDPOINTS = Object.freeze({
  apiBase: "https://copilot.tencent.com/v2/plugin",
  chatBase: "https://copilot.tencent.com/v2",
  origin: "https://www.codebuddy.cn",
});

export interface WorkBuddyCredential {
  access: string;
  refresh: string;
  /** Expiry in Unix milliseconds. */
  expires: number;
  accountId?: string;
  userId?: string;
  enterpriseId?: string;
  domain?: string;
  label?: string;
}

export type WorkBuddyErrorCode = "cancelled" | "timeout" | "transport" | "http" | "response" | "browser";

export class WorkBuddyAuthError extends Error {
  constructor(public readonly code: WorkBuddyErrorCode, public readonly status?: number) {
    super(`WorkBuddy authorization ${code}${status === undefined ? "" : ` (${status})`}.`);
    this.name = "WorkBuddyAuthError";
  }
}

export interface WorkBuddyRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface WorkBuddyAuthorizationOptions extends WorkBuddyRequestOptions {
  openExternal(url: string): Promise<unknown> | unknown;
  /** Total login budget, capped at ten minutes. */
  timeoutMs?: number;
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkBuddyAuthError("response");
  return value as ObjectValue;
}
function valueString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 32768 ? value.trim() : undefined;
}
function firstString(value: ObjectValue, keys: string[]): string | undefined {
  for (const key of keys) {
    const result = valueString(value[key]);
    if (result) return result;
  }
  return undefined;
}
function unpack(payload: unknown, pending = false): ObjectValue | null {
  const envelope = object(payload);
  if (pending && envelope.code === 11217) return null;
  if (envelope.code !== 0 && envelope.code !== 200) throw new WorkBuddyAuthError("response");
  return object(envelope.data);
}

function credentialFrom(value: ObjectValue, previous?: WorkBuddyCredential): WorkBuddyCredential {
  const access = firstString(value, ["accessToken", "access_token", "access"]);
  const refresh = firstString(value, ["refreshToken", "refresh_token", "refresh"]) ?? previous?.refresh;
  const seconds = Number(value.expiresIn ?? value.expires_in);
  if (!access || !refresh || !Number.isFinite(seconds) || seconds <= 0 || seconds > 365 * 86400) {
    throw new WorkBuddyAuthError("response");
  }
  const result: WorkBuddyCredential = { access, refresh, expires: Date.now() + seconds * 1000 };
  for (const [key, aliases] of [
    ["domain", ["domain"]], ["userId", ["userId", "uid"]],
    ["enterpriseId", ["enterpriseId"]], ["accountId", ["accountId", "userId", "uid"]],
    ["label", ["label", "nickname", "email"]],
  ] as const) {
    const item = firstString(value, [...aliases]) ?? previous?.[key];
    if (item) result[key] = item;
  }
  return result;
}

function commonHeaders(): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    origin: WORKBUDDY_ENDPOINTS.origin,
    referer: `${WORKBUDDY_ENDPOINTS.origin}/`,
    "x-product": "SaaS",
  };
}

/** Keep the returned headers inside the trusted host process. */
export function workBuddyHeaders(credential: WorkBuddyCredential): Record<string, string> {
  if (!valueString(credential.access) || !valueString(credential.refresh)) throw new WorkBuddyAuthError("response");
  const headers = {
    ...commonHeaders(),
    authorization: `Bearer ${credential.access}`,
    "x-refresh-token": credential.refresh,
    ...(credential.domain ? { "x-domain": credential.domain } : {}),
    ...(credential.userId ? { "x-user-id": credential.userId } : {}),
    ...(credential.enterpriseId ? { "x-enterprise-id": credential.enterpriseId } : {}),
  };
  try { new Headers(headers); } catch { throw new WorkBuddyAuthError("response"); }
  return headers;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkBuddyAuthError("cancelled");
}

async function request(
  path: string, init: RequestInit, options: WorkBuddyRequestOptions,
  jar?: CookieJar, pending = false,
): Promise<ObjectValue | null> {
  checkAbort(options.signal);
  const url = `${WORKBUDDY_ENDPOINTS.apiBase}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const headers = new Headers(init.headers ?? commonHeaders());
    if (jar) {
      const cookie = await jar.getCookieString(url);
      if (cookie) headers.set("cookie", cookie);
    }
    const response = await (options.fetchImpl ?? fetch)(url, { ...init, headers, signal, redirect: "error" });
    if (response.redirected) throw new WorkBuddyAuthError("response");
    if (!response.ok) throw new WorkBuddyAuthError("http", response.status);
    if (jar) {
      for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url);
    }
    return unpack(await response.json(), pending);
  } catch (error) {
    if (options.signal?.aborted) throw new WorkBuddyAuthError("cancelled");
    if (controller.signal.aborted) throw new WorkBuddyAuthError("timeout");
    if (error instanceof WorkBuddyAuthError) throw error;
    throw new WorkBuddyAuthError("transport");
  } finally {
    clearTimeout(timer);
  }
}

function pause(signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, 1500);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new WorkBuddyAuthError("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function openBrowser(open: () => Promise<unknown> | unknown, signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  let abort: () => void = () => {};
  try {
    await Promise.race([
      Promise.resolve().then(open),
      new Promise<never>((_, reject) => {
        abort = () => reject(new WorkBuddyAuthError("cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } catch {
    checkAbort(signal);
    throw new WorkBuddyAuthError("browser");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function loginAddress(start: ObjectValue): { state: string; url: string } {
  const state = firstString(start, ["state"]);
  const address = firstString(start, ["authUrl", "auth_url", "url"]);
  if (!state || state.length > 1024 || !address) throw new WorkBuddyAuthError("response");
  let url: URL;
  try { url = new URL(address); } catch { throw new WorkBuddyAuthError("response"); }
  if (url.origin !== "https://copilot.tencent.com" || url.pathname !== "/login" || url.username || url.password
    || url.hash || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state
    || url.searchParams.getAll("platform").length !== 1 || url.searchParams.get("platform") !== "workbuddy"
    || [...url.searchParams.keys()].some(key => key !== "state" && key !== "platform")) {
    throw new WorkBuddyAuthError("response");
  }
  return { state, url: url.href };
}

export async function authorizeWorkBuddy(options: WorkBuddyAuthorizationOptions): Promise<WorkBuddyCredential> {
  checkAbort(options.signal);
  if (typeof options.openExternal !== "function") throw new WorkBuddyAuthError("browser");
  const budget = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(budget) || budget <= 0) throw new WorkBuddyAuthError("response");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(budget, 600_000));
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const io: WorkBuddyRequestOptions = { ...options, signal };
  const jar = new CookieJar();
  try {
    const start = await request("/auth/state?platform=workbuddy", { method: "POST", body: "{}" }, io, jar);
    const { state, url } = loginAddress(object(start));
    await openBrowser(() => options.openExternal(url), signal);
    for (;;) {
      checkAbort(signal);
      const data = await request(`/auth/token?state=${encodeURIComponent(state)}`, {}, io, jar, true);
      if (!data) { await pause(signal); continue; }
      const credential = credentialFrom(data);
      try {
        const account = await request(`/login/account?state=${encodeURIComponent(state)}`, { headers: workBuddyHeaders(credential) }, io, jar);
        if (account) {
          const userId = firstString(account, ["uid", "userId", "user_id"]);
          const label = firstString(account, ["nickname", "displayName", "email"]);
          const enterpriseId = firstString(account, ["enterpriseId"]);
          if (userId) { credential.userId = userId; credential.accountId = userId; }
          if (label) credential.label = label;
          if (enterpriseId) credential.enterpriseId = enterpriseId;
        }
      } catch {
        checkAbort(signal);
      }
      return credential;
    }
  } catch (error) {
    if (options.signal?.aborted) throw new WorkBuddyAuthError("cancelled");
    if (controller.signal.aborted) throw new WorkBuddyAuthError("timeout");
    if (error instanceof WorkBuddyAuthError) throw error;
    throw new WorkBuddyAuthError("transport");
  } finally {
    clearTimeout(timer);
    await jar.removeAllCookies();
  }
}

export async function refreshWorkBuddy(
  credential: WorkBuddyCredential, options: WorkBuddyRequestOptions = {},
): Promise<WorkBuddyCredential> {
  const headers = { ...workBuddyHeaders(credential), "x-auth-refresh-source": "workbuddy" };
  const value = await request("/auth/token/refresh", { method: "POST", headers, body: "{}" }, options);
  return credentialFrom(object(value), credential);
}
