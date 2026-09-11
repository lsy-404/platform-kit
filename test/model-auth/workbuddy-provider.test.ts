// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeWorkBuddy, refreshWorkBuddy, workBuddyHeaders } from "../../model-auth/packages/providers/src/workbuddy";

const start = (state = "test-state") => ({ state, authUrl: `https://copilot.tencent.com/login?platform=workbuddy&state=${state}` });
const tokens = { accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 3600, domain: "account-domain" };
const reply = (data: unknown, headers?: HeadersInit) => new Response(JSON.stringify({ code: 0, data }), { ...(headers ? { headers } : {}) });
const fetchFrom = (handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(input), init ?? {}))) as typeof fetch;

afterEach(() => { vi.useRealTimers(); });

describe("WorkBuddy authorization", () => {
  it("opens the real state-bound URL, retains cookies, and returns renewable host credentials", async () => {
    const openExternal = vi.fn();
    const seen: string[] = [];
    const fetchImpl = fetchFrom((url, init) => {
      seen.push(url);
      expect(init.redirect).toBe("error");
      if (url.includes("/auth/state")) return reply(start(), { "set-cookie": "session=one; Path=/v2/plugin; Secure; HttpOnly" });
      expect(new Headers(init.headers).get("cookie")).toBe("session=one");
      if (url.includes("/auth/token?")) return reply(tokens);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer access-secret");
      return reply({ uid: "account-one", nickname: "Work account", enterpriseId: "enterprise-one" });
    });
    const before = Date.now();
    const result = await authorizeWorkBuddy({ openExternal, fetchImpl });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(start().authUrl);
    expect(seen).toHaveLength(3);
    expect(result).toMatchObject({ access: "access-secret", refresh: "refresh-secret", accountId: "account-one", userId: "account-one", label: "Work account", enterpriseId: "enterprise-one" });
    expect(result.expires).toBeGreaterThanOrEqual(before + 3600_000);
    expect(result.expires).toBeLessThanOrEqual(Date.now() + 3600_000);
    expect(workBuddyHeaders(result)["x-enterprise-id"]).toBe("enterprise-one");
  });

  it("keeps simultaneous browser accounts in separate cookie jars", async () => {
    let sequence = 0;
    const fetchImpl = fetchFrom((url, init) => {
      if (url.includes("/auth/state")) {
        const id = ++sequence;
        return reply(start(`state-${id}`), { "set-cookie": `session=${id}; Path=/; Secure` });
      }
      const id = new URL(url).searchParams.get("state")?.split("-")[1];
      expect(new Headers(init.headers).get("cookie")).toBe(`session=${id}`);
      return url.includes("/auth/token?") ? reply({ ...tokens, accessToken: `access-${id}` }) : reply({ uid: `account-${id}` });
    });
    const accounts = await Promise.all([1, 2].map(() => authorizeWorkBuddy({ openExternal: vi.fn(), fetchImpl })));
    expect(accounts.map(value => value.accountId).sort()).toEqual(["account-1", "account-2"]);
  });

  it("honors cookie paths, expiry, and multiple Set-Cookie headers", async () => {
    const fetchImpl = fetchFrom((url, init) => {
      if (url.includes("/auth/state")) {
        const headers = new Headers();
        headers.append("set-cookie", "session=valid; Path=/v2/plugin; Secure");
        headers.append("set-cookie", "private=hidden; Path=/private; Secure");
        headers.append("set-cookie", "old=expired; Max-Age=0; Path=/; Secure");
        return reply(start(), headers);
      }
      expect(new Headers(init.headers).get("cookie")).toBe("session=valid");
      return url.includes("/auth/token?") ? reply(tokens) : reply({});
    });
    await authorizeWorkBuddy({ openExternal: vi.fn(), fetchImpl });
  });

  it("polls only the explicit pending status", async () => {
    vi.useFakeTimers();
    let count = 0;
    const fetchImpl = fetchFrom(url => {
      if (url.includes("/auth/state")) return reply(start());
      if (url.includes("/auth/token?") && ++count === 1) return new Response('{"code":11217,"msg":"pending"}');
      return url.includes("/auth/token?") ? reply(tokens) : reply({});
    });
    const pending = authorizeWorkBuddy({ fetchImpl, openExternal: vi.fn() });
    await vi.advanceTimersByTimeAsync(1499);
    expect(count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ access: "access-secret" });
    expect(count).toBe(2);
  });

  it.each([
    { ...start(), authUrl: "file:///sensitive" },
    { ...start(), authUrl: "https://attacker.invalid/login?state=test-state" },
    { ...start(), authUrl: "https://copilot.tencent.com/login?state=wrong" },
    { ...start(), authUrl: "https://copilot.tencent.com/login?state=test-state&state=other" },
    { ...start(), authUrl: "https://username@copilot.tencent.com/login?state=test-state" },
    { ...start(), authUrl: "https://copilot.tencent.com/login?platform=other&state=test-state" },
    { ...start(), authUrl: "https://copilot.tencent.com/login?platform=workbuddy&state=test-state&redirect=https://attacker.invalid" },
  ])("rejects untrusted or mismatched login URLs before opening", async payload => {
    const openExternal = vi.fn();
    await expect(authorizeWorkBuddy({ openExternal, fetchImpl: fetchFrom(() => reply(payload)) })).rejects.toMatchObject({ code: "response" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("aborts before any network request if cancelled", async () => {
    const fetchImpl = fetchFrom(() => reply(start()));
    await expect(authorizeWorkBuddy({ fetchImpl, openExternal: vi.fn(), signal: AbortSignal.abort("secret-reason") })).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels in-flight polling and clears its timers", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = fetchFrom(url => url.includes("/auth/state") ? reply(start()) : new Response('{"code":11217}'));
    const pending = authorizeWorkBuddy({ fetchImpl, openExternal: vi.fn(), signal: controller.signal });
    const asserted = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort("secret");
    await asserted;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces a total login deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchFrom(url => url.includes("/auth/state") ? reply(start()) : new Response('{"code":11217}'));
    const pending = authorizeWorkBuddy({ fetchImpl, openExternal: vi.fn(), timeoutMs: 2000 });
    const asserted = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(2000);
    await asserted;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an unresponsive browser opener by the same deadline", async () => {
    vi.useFakeTimers();
    const pending = authorizeWorkBuddy({
      fetchImpl: fetchFrom(() => reply(start())), openExternal: () => new Promise(() => {}), timeoutMs: 1000,
    });
    const asserted = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);
    await asserted;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leak upstream bodies, browser errors, or secrets", async () => {
    for (const response of [new Response("access-secret", { status: 401 }), new Response('{"code":123,"msg":"refresh-secret"}')]) {
      try { await authorizeWorkBuddy({ openExternal: vi.fn(), fetchImpl: fetchFrom(() => response) }); }
      catch (error) {
        expect(String(error)).not.toContain("secret");
        expect((error as Error).cause).toBeUndefined();
      }
    }
    await expect(authorizeWorkBuddy({ fetchImpl: fetchFrom(() => reply(start())), openExternal: () => { throw new Error("secret-url"); } })).rejects.toThrow("WorkBuddy authorization browser.");
  });

  it("requires renewable credentials and does not turn denied authorization into pending", async () => {
    const incomplete = fetchFrom(url => reply(url.includes("/auth/state") ? start() : { accessToken: "access-secret", expiresIn: 3600 }));
    await expect(authorizeWorkBuddy({ openExternal: vi.fn(), fetchImpl: incomplete })).rejects.toMatchObject({ code: "response" });
    expect(incomplete).toHaveBeenCalledTimes(2);
  });

  it.each([false, null, "", "0", [], {}])("rejects non-numeric business status values", async code => {
    await expect(authorizeWorkBuddy({
      openExternal: vi.fn(), fetchImpl: fetchFrom(() => new Response(JSON.stringify({ code, data: start() }))),
    })).rejects.toMatchObject({ code: "response" });
  });

  it("keeps a valid token if optional profile lookup is unavailable", async () => {
    const fetchImpl = fetchFrom(url => url.includes("/auth/state") ? reply(start()) : url.includes("/auth/token?") ? reply(tokens) : new Response("no profile", { status: 503 }));
    await expect(authorizeWorkBuddy({ fetchImpl, openExternal: vi.fn() })).resolves.toMatchObject({ access: "access-secret" });
  });
});

describe("WorkBuddy renewal", () => {
  const original = { access: "old-access", refresh: "old-refresh", expires: 1, accountId: "one", enterpriseId: "enterprise", domain: "domain", label: "Account" };
  it("rotates tokens and preserves identity and tenant routing", async () => {
    const fetchImpl = fetchFrom((url, init) => {
      expect(url).toBe("https://copilot.tencent.com/v2/plugin/auth/token/refresh");
      expect(new Headers(init.headers).get("x-refresh-token")).toBe("old-refresh");
      expect(new Headers(init.headers).get("x-enterprise-id")).toBe("enterprise");
      expect(init.redirect).toBe("error");
      return reply({ ...tokens, domain: undefined, injected: "ignore" });
    });
    const result = await refreshWorkBuddy(original, { fetchImpl });
    expect(result).toMatchObject({ access: "access-secret", refresh: "refresh-secret", accountId: "one", domain: "domain", enterpriseId: "enterprise", label: "Account" });
    expect(result).not.toHaveProperty("injected");
    expect(original.access).toBe("old-access");
  });
  it("retains an unrotated refresh token but rejects invalid expiry", async () => {
    await expect(refreshWorkBuddy(original, { fetchImpl: fetchFrom(() => reply({ accessToken: "new", expiresIn: 3600 })) })).resolves.toMatchObject({ refresh: "old-refresh" });
    await expect(refreshWorkBuddy(original, { fetchImpl: fetchFrom(() => reply({ ...tokens, expiresIn: -1 })) })).rejects.toMatchObject({ code: "response" });
  });
  it("does not follow redirects with credentials", async () => {
    await expect(refreshWorkBuddy(original, { fetchImpl: fetchFrom(() => new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } })) })).rejects.toMatchObject({ code: "http", status: 302 });
  });
});
