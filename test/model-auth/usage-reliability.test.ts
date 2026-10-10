// @vitest-environment node

vi.mock("../../model-auth/packages/providers/src/client-versions.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../model-auth/packages/providers/src/client-versions.js")>();
  return { ...actual, latestClientVersion: async (client: keyof typeof actual.CLIENT_VERSION_FLOORS) => actual.CLIENT_VERSION_FLOORS[client] };
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnthropicProfileCache, parseAnthropicUsage, parseCodexUsage, queryAnthropicUsage, queryCodexUsage, usageErrorSnapshot, usageSnapshot,
  usageWindowKind, UsageRequestError,
} from "../../model-auth/packages/providers/src/usage.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const byId = <T extends { id: string }>(items: readonly T[]) => Object.fromEntries(items.map(item => [item.id, item]));
const credential = { access: "synthetic-access" };

beforeEach(() => clearAnthropicProfileCache());

describe("window kinds and labels", () => {
  it("derives kinds from durations", () => {
    expect(usageWindowKind(18000)).toBe("session");
    expect(usageWindowKind(86400)).toBe("daily");
    expect(usageWindowKind(604800)).toBe("weekly");
    expect(usageWindowKind(30 * 86400)).toBe("monthly");
    expect(usageWindowKind(1234)).toBeNull();
    expect(usageWindowKind(undefined)).toBeNull();
  });

  it("labels Codex windows from their duration", () => {
    const parsed = parseCodexUsage({ rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
    } });
    expect(parsed.windows.map(w => [w.id, w.label, w.kind])).toEqual([["primary", "5h", "session"], ["secondary", "7d", "weekly"]]);
  });

  it("uses a neutral label and null kind when the duration is missing", () => {
    const parsed = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 10 }, secondary_window: { used_percent: 20 } } });
    expect(parsed.windows.map(w => w.kind)).toEqual([null, null]);
    for (const window of parsed.windows) expect(window.label).not.toMatch(/7|day|Primary|Secondary/i);
  });
});

describe("exhaustion", () => {
  it("does not treat a full window as exhausted without a server flag", () => {
    const parsed = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 18000 } } });
    expect(parsed.windows[0]?.status).toBe("known");
  });

  it("marks only the fullest Codex window when the server reports the limit", () => {
    const rate = { primary_window: { used_percent: 100, limit_window_seconds: 18000 }, secondary_window: { used_percent: 60, limit_window_seconds: 604800 } };
    for (const root of [{ rate_limit: { ...rate, limit_reached: true } }, { rate_limit: rate, rate_limit_reached_type: "primary" }, { rate_limit: rate, spend_control: { reached: true } }]) {
      expect(parseCodexUsage(root).windows.map(w => w.status)).toEqual(["exhausted", "known"]);
    }
    expect(parseCodexUsage({ rate_limit: { ...rate, limit_reached: false }, rate_limit_reached_type: null }).windows.map(w => w.status)).toEqual(["known", "known"]);
  });

  it("applies Anthropic severity and lock rules", () => {
    const parsed = parseAnthropicUsage({ limits: [
      { kind: "five_hour", percent: 90, severity: "warning" },
      { kind: "seven_day", percent: 100, severity: "critical" },
      { kind: "seven_day_opus", percent: 10, locked_reason: "capacity" },
      { kind: "daily", percent: 99, severity: "normal" },
    ] });
    expect(parsed.windows.map(w => w.status)).toEqual(["known", "exhausted", "exhausted", "known"]);
  });
});

describe("Anthropic limits list", () => {
  it("prefers limits[] and builds model-family windows", () => {
    const parsed = parseAnthropicUsage({
      limits: [
        { kind: "five_hour", percent: 30, resets_at: "2030-02-03T04:05:06Z" },
        { kind: "seven_day", percent: 45, scope: { model: { display_name: "Alpha Model" } } },
      ],
      five_hour: { utilization: 99 },
    });
    const windows = byId(parsed.windows);
    expect(windows.five_hour).toMatchObject({ scope: "account", kind: "session", usedPercent: 30, label: "5h", resetAt: Date.parse("2030-02-03T04:05:06Z") });
    expect(windows["seven_day:alpha-model"]).toMatchObject({ scope: "model-family", modelFamilies: ["alpha-model"], kind: "weekly", label: "7d · Alpha Model" });
    expect(parsed.windows).toHaveLength(2);
  });

  it("falls back to the legacy fields", () => {
    const parsed = parseAnthropicUsage({ five_hour: { utilization: 30 }, seven_day: { utilization: 50 } });
    expect(parsed.windows.map(w => [w.id, w.kind])).toEqual([["five_hour", "session"], ["seven_day", "weekly"]]);
  });
});

describe("plan multipliers", () => {
  it("maps prolite to Pro 5x and passes other plans through", () => {
    expect(parseCodexUsage({ plan_type: "prolite" })).toMatchObject({ plan: "pro", planMultiplier: 5 });
    expect(parseCodexUsage({ plan_type: "plus" })).toMatchObject({ plan: "plus", planMultiplier: null });
  });

  it("maps every ChatGPT plan alias to its tier", () => {
    const table: Array<[string, string, number | null]> = [
      ["prolite", "pro", 5], ["pro_lite", "pro", 5], ["pro-lite", "pro", 5], ["Pro Lite", "pro", 5],
      ["pro", "pro", null], ["pro_10x", "pro", 10],
      ["team", "business", null], ["teams", "business", null], ["business", "business", null], ["self_serve_business_usage_based", "business", null],
      ["enterprise", "enterprise", null], ["enterprise_cbp_usage_based", "enterprise", null],
      ["free", "free", null], ["go", "go", null], ["plus", "plus", null], ["edu", "edu", null],
    ];
    for (const [raw, plan, multiplier] of table) {
      expect(parseCodexUsage({ plan_type: raw }), raw).toMatchObject({ plan, planTier: plan, planMultiplier: multiplier });
    }
  });

  it("lets an explicit multiplier win and never surfaces an email as a plan", () => {
    expect(parseCodexUsage({ plan_type: "pro", plan_multiplier: 5 })).toMatchObject({ plan: "pro", planMultiplier: 5 });
    expect(parseCodexUsage({ plan_type: "owner@example.test" })).toMatchObject({ plan: null, planTier: null, planMultiplier: null });
    expect(parseCodexUsage({}, { plan: "prolite" })).toMatchObject({ plan: "pro", planMultiplier: 5 });
  });

  it("reads the Anthropic tier from the profile and keeps unknown tiers", async () => {
    const run = async (tier: string) => {
      clearAnthropicProfileCache();
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith("/usage")) return json({ five_hour: { utilization: 1 } });
        if (url.endsWith("/profile")) return json({ organization: { uuid: "org-1", organization_type: "claude_max", rate_limit_tier: tier } });
        return json({});
      });
      return queryAnthropicUsage(credential, { fetchImpl: fetchImpl as unknown as typeof fetch, credentialId: "cred" });
    };
    expect(await run("default_claude_max_5x")).toMatchObject({ plan: "max", planMultiplier: 5, planTier: "default_claude_max_5x", identity: "org-1" });
    expect(await run("custom_tier")).toMatchObject({ planMultiplier: null, planTier: "custom_tier" });
  });
});

describe("profile cache", () => {
  it("caches profile results, failures included, and does not block usage", async () => {
    let profileCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/usage")) return json({ five_hour: { utilization: 1 } });
      if (url.endsWith("/profile")) { profileCalls++; return json({}, 500); }
      return json({});
    }) as unknown as typeof fetch;
    const first = await queryAnthropicUsage(credential, { fetchImpl, credentialId: "cred" });
    const second = await queryAnthropicUsage(credential, { fetchImpl, credentialId: "cred" });
    expect(profileCalls).toBe(1);
    expect(first.windows).toHaveLength(1);
    expect(second.metadataError).toBe(first.metadataError);
    await queryAnthropicUsage(credential, { fetchImpl, credentialId: "other" });
    expect(profileCalls).toBe(2);
  });

  it("expires after six hours", async () => {
    vi.useFakeTimers();
    try {
      let profileCalls = 0;
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith("/profile")) { profileCalls++; return json({}); }
        return json({ five_hour: { utilization: 1 } });
      }) as unknown as typeof fetch;
      await queryAnthropicUsage(credential, { fetchImpl, credentialId: "cred" });
      vi.setSystemTime(Date.now() + 5 * 3600_000);
      await queryAnthropicUsage(credential, { fetchImpl, credentialId: "cred" });
      expect(profileCalls).toBe(1);
      vi.setSystemTime(Date.now() + 2 * 3600_000);
      await queryAnthropicUsage(credential, { fetchImpl, credentialId: "cred" });
      expect(profileCalls).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});

describe("request policy", () => {
  const options = { retryDelayMs: 0 };

  it("retries transient network errors at most twice", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; if (calls < 3) throw new TypeError("network"); return json({ rate_limit: {} }); }) as unknown as typeof fetch;
    await expect(queryCodexUsage(credential, { ...options, fetchImpl })).resolves.toMatchObject({ windows: [] });
    expect(calls).toBe(3);
    calls = 0;
    const failing = (async () => { calls++; throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(queryCodexUsage(credential, { ...options, fetchImpl: failing })).rejects.toMatchObject({ code: "unreachable" });
    expect(calls).toBe(3);
  });

  it("does not retry rate limits or server errors", async () => {
    for (const [status, code] of [[429, "rate-limited"], [503, "server-error"]] as const) {
      const fetchImpl = vi.fn(async () => json({ error: { message: "slow down" } }, status));
      await expect(queryCodexUsage(credential, { ...options, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ code });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("stops immediately when aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => { controller.abort(); throw new TypeError("network"); });
    await expect(queryCodexUsage(credential, { retryDelayMs: 50, fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal })).rejects.toBeInstanceOf(UsageRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes once after a rejection and retries with the new token", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).authorization!;
      seen.push(authorization);
      return authorization === "Bearer renewed" ? json({ rate_limit: {} }) : json({}, 401);
    }) as unknown as typeof fetch;
    const refresh = vi.fn(async () => "renewed");
    await queryCodexUsage(credential, { ...options, fetchImpl, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer synthetic-access", "Bearer renewed"]);
    const stillRejected = (async () => json({}, 401)) as unknown as typeof fetch;
    const again = vi.fn(async () => "renewed");
    await expect(queryCodexUsage(credential, { ...options, fetchImpl: stillRejected, refresh: again })).rejects.toMatchObject({ code: "signed-out" });
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("does not follow redirects and treats them as a rejected credential", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: string, request: RequestInit) => { init = request; return new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test" } }); }) as unknown as typeof fetch;
    await expect(queryCodexUsage(credential, { ...options, fetchImpl })).rejects.toMatchObject({ code: "signed-out" });
    expect(init?.redirect).toBe("manual");
  });

  it("reports unreadable bodies", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    await expect(queryCodexUsage(credential, { ...options, fetchImpl })).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("snapshots", () => {
  it("builds error snapshots with a code", () => {
    expect(usageErrorSnapshot("p", "c", new UsageRequestError("signed-out", "401"))).toMatchObject({ status: "error", errorCode: "signed-out", error: "401" });
    expect(usageErrorSnapshot("p", "c", new Error("x"))).toMatchObject({ errorCode: "unreachable" });
  });

  it("flags readings without limits", () => {
    expect(usageSnapshot("p", "c", { plan: null, windows: [], balance: null })).toMatchObject({ status: "unknown", errorCode: "no-limits" });
    expect(usageSnapshot("p", "c", { plan: null, windows: [], balance: { amount: 1, unit: "credits" } }).errorCode).toBeNull();
  });
});
