// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createCredentialMetadata, createGrokAdapter } from "../../model-auth/packages/core/src/index.js";
import { parseAnthropicUsage, queryClaudePrepaidCredits, usageSnapshot } from "../../model-auth/packages/providers/src/usage.js";

// Payloads copied from the upstream token-monitor Claude limit collector fixtures.
const CREDITS_OFF = {
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null },
  spend: { enabled: false, used: { amount_minor: 0, currency: "USD", exponent: 2 }, limit: null, percent: 0 },
};
const WITH_LIMIT = {
  extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 235, utilization: 11.75, currency: "USD", decimal_places: 2 },
  spend: {
    enabled: true,
    used: { amount_minor: 235, currency: "USD", exponent: 2 },
    limit: { amount_minor: 2000, currency: "USD", exponent: 2 },
    percent: 12,
  },
};
const UNLIMITED = {
  extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 235, utilization: null, currency: "USD", decimal_places: 2 },
  spend: { enabled: true, used: { amount_minor: 235, currency: "USD", exponent: 2 }, limit: null, percent: 0 },
};
const LEGACY_ONLY = { extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 235, currency: "USD", decimal_places: 2 } };
const JPY = { extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 235, currency: "JPY", decimal_places: 0 } };

describe("Claude extra usage", () => {
  it("reports credits off without a cap or percentage", () => {
    expect(parseAnthropicUsage(CREDITS_OFF).extraUsage).toMatchObject({ enabled: false, limit: null, usedPercent: null });
  });

  it("reads a capped balance in major units and prefers the utilization over the spend percent", () => {
    expect(parseAnthropicUsage(WITH_LIMIT).extraUsage).toEqual({ enabled: true, used: 2.35, limit: 20, usedPercent: 11.75, currency: "USD" });
  });

  it("keeps an uncapped balance without a percentage", () => {
    const extra = parseAnthropicUsage(UNLIMITED).extraUsage;
    expect(extra).toEqual({ enabled: true, used: 2.35, limit: null, usedPercent: null, currency: "USD" });
  });

  it("derives the percentage from the amounts when utilization is absent", () => {
    expect(parseAnthropicUsage(LEGACY_ONLY).extraUsage).toEqual({ enabled: true, used: 2.35, limit: 20, usedPercent: 11.75, currency: "USD" });
  });

  it("honours a non-cent decimal_places", () => {
    expect(parseAnthropicUsage(JPY).extraUsage).toEqual({ enabled: true, used: 235, limit: 2000, usedPercent: 11.75, currency: "JPY" });
  });

  it("is null when the response has neither block, and no longer invents a credits balance", () => {
    const parsed = parseAnthropicUsage({ subscription_type: "max", five_hour: { utilization: 10 }, credits: { balance: 9 }, credit_balance: 9 });
    expect(parsed.extraUsage).toBeNull();
    expect(parsed.balance).toBeNull();
  });

  it("reaches the snapshot and passes core validation, which rejects malformed values", async () => {
    const snapshot = usageSnapshot("anthropic", "credential", parseAnthropicUsage(WITH_LIMIT));
    expect(snapshot.extraUsage).toEqual({ enabled: true, used: 2.35, limit: 20, usedPercent: 11.75, currency: "USD" });
    expect(usageSnapshot("anthropic", "credential", parseAnthropicUsage({ five_hour: { utilization: 1 } })).extraUsage).toBeNull();
    const metadata = createCredentialMetadata({ id: "credential", providerId: "grok", authMethod: "oauth", modelIds: ["grok-build"] });
    const adapter = (value: unknown) => createGrokAdapter({
      async authorize() { return metadata; },
      async remove() {},
      async request() { return { output: "", modelId: "grok-build", finishReason: "stop" }; },
      async queryUsage() { return value as never; },
    });
    await expect(adapter({ ...snapshot, providerId: "grok" }).host.queryUsage?.("credential")).resolves.toMatchObject({ extraUsage: snapshot.extraUsage });
    await expect(adapter({ ...snapshot, providerId: "grok", extraUsage: { ...snapshot.extraUsage, used: "2.35" } }).host.queryUsage?.("credential"))
      .rejects.toThrow("invalid extra usage");
    for (const bad of [{ usedPercent: 150 }, { usedPercent: -5 }, { used: -1 }, { limit: -20 }]) {
      await expect(adapter({ ...snapshot, providerId: "grok", extraUsage: { ...snapshot.extraUsage, ...bad } }).host.queryUsage?.("credential"))
        .rejects.toThrow("invalid extra usage");
    }
  });

  it("clamps an overspent cap to 100 percent so the snapshot stays valid", () => {
    const over = parseAnthropicUsage({ extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 2500, currency: "USD", decimal_places: 2 } });
    expect(over.extraUsage).toMatchObject({ used: 25, limit: 20, usedPercent: 100 });
  });
});

// Prepaid pool payloads copied from the upstream fixtures; the amount is in minor units.
const PREPAID_CREDITS = {
  amount: 11344,
  currency: "USD",
  tranches: [],
  promo_tranches: [
    { remaining_amount_minor_units: 1343, granted_amount_minor_units: 2000, currency: "USD", expires_at: "2026-08-09T00:00:00Z" },
    { remaining_amount_minor_units: 10000, granted_amount_minor_units: 10000, currency: "USD", expires_at: "2026-09-19T00:00:00Z" },
  ],
  next_expires_at: "2026-08-09T00:00:00Z",
};
const UNFUNDED = { amount: 0, currency: "USD", tranches: [], promo_tranches: [] };
const FREE_ORG = { uuid: "organization-free", name: "Personal", capabilities: ["chat"] };
const TEAM_ORG = { uuid: "organization-team", name: "Team Workspace", capabilities: ["chat", "raven"], raven_type: "team" };

function sessionFetch(routes: Record<string, unknown | { status: number; body?: unknown }>, seen: string[] = [], inits: RequestInit[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    seen.push(path);
    inits.push(init ?? {});
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected endpoint: ${path}`);
    if (route && typeof route === "object" && "status" in route) return new Response(JSON.stringify((route as { body?: unknown }).body ?? {}), { status: (route as { status: number }).status });
    return new Response(JSON.stringify(route), { status: 200 });
  }) as typeof fetch;
}

describe("Claude prepaid credits through a web session", () => {
  it("reads the pool of the only chat organization in dollars", async () => {
    const seen: string[] = [];
    const snapshot = await queryClaudePrepaidCredits({
      fetchImpl: sessionFetch({ "/api/organizations": [{ uuid: "org-1", name: "Example" }], "/api/organizations/org-1/prepaid/credits": PREPAID_CREDITS }, seen),
    });
    expect(snapshot).toMatchObject({ providerId: "anthropic", status: "ok", balance: { amount: 113.44, unit: "USD" }, error: null });
    expect(seen).toEqual(["/api/organizations", "/api/organizations/org-1/prepaid/credits"]);
  });

  it("marks a funded pool and a never-funded pool apart, keeping a drained funded pool at zero", async () => {
    const read = async (credits: unknown) => (await queryClaudePrepaidCredits({
      fetchImpl: sessionFetch({ "/api/organizations": [{ uuid: "org-1" }], "/api/organizations/org-1/prepaid/credits": credits }),
    })).balance;
    expect(await read(PREPAID_CREDITS)).toEqual({ amount: 113.44, unit: "USD", funded: true });
    expect(await read(UNFUNDED)).toEqual({ amount: 0, unit: "USD", funded: false });
    expect(await read({ ...UNFUNDED, tranches: [{ remaining_amount_minor_units: 0, granted_amount_minor_units: 500, currency: "USD", expires_at: "2026-08-09T00:00:00Z" }] }))
      .toEqual({ amount: 0, unit: "USD", funded: true });
  });

  it("sends neither cookies nor credentials of its own and never follows a redirect", async () => {
    const inits: RequestInit[] = [];
    await queryClaudePrepaidCredits({
      fetchImpl: sessionFetch({ "/api/organizations": [{ uuid: "org-1" }], "/api/organizations/org-1/prepaid/credits": PREPAID_CREDITS }, [], inits),
    });
    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init.redirect).toBe("manual");
      const names = Object.keys((init.headers ?? {}) as Record<string, string>).map(name => name.toLowerCase());
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
      expect(init.credentials).toBeUndefined();
    }
  });

  it("reports a login redirect as signed out", async () => {
    const snapshot = await queryClaudePrepaidCredits({ fetchImpl: sessionFetch({ "/api/organizations": { status: 302 } }) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "signed-out", balance: null });
  });

  it("reports a cancelled request as unreachable without a balance", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("[]");
    }) as typeof fetch;
    const snapshot = await queryClaudePrepaidCredits({ fetchImpl, signal: controller.signal });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "unreachable", balance: null });
  });

  it("reads the selected organization regardless of list order", async () => {
    for (const organizations of [[FREE_ORG, TEAM_ORG], [TEAM_ORG, FREE_ORG]]) {
      const seen: string[] = [];
      const snapshot = await queryClaudePrepaidCredits({
        organizationId: TEAM_ORG.uuid,
        fetchImpl: sessionFetch({ "/api/organizations": organizations, "/api/organizations/organization-team/prepaid/credits": { amount: 1234, currency: "USD" } }, seen),
      });
      expect(snapshot.balance).toMatchObject({ amount: 12.34, unit: "USD" });
      expect(seen).toEqual(["/api/organizations", "/api/organizations/organization-team/prepaid/credits"]);
    }
  });

  it("asks for a choice instead of guessing between several chat organizations", async () => {
    const seen: string[] = [];
    const snapshot = await queryClaudePrepaidCredits({ fetchImpl: sessionFetch({ "/api/organizations": [FREE_ORG, TEAM_ORG] }, seen) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "unreadable", balance: null });
    expect(seen).toEqual(["/api/organizations"]);
  });

  it("classifies a rejected, throttled or failing session like the other usage queries", async () => {
    const run = (status: number) => queryClaudePrepaidCredits({ fetchImpl: sessionFetch({ "/api/organizations": { status } }) });
    expect((await run(403)).errorCode).toBe("signed-out");
    expect((await run(429)).errorCode).toBe("rate-limited");
    expect((await run(500)).errorCode).toBe("server-error");
    const unreadable = await queryClaudePrepaidCredits({
      fetchImpl: sessionFetch({ "/api/organizations": [{ uuid: "org-1" }], "/api/organizations/org-1/prepaid/credits": { currency: "USD" } }),
    });
    expect(unreadable).toMatchObject({ status: "error", errorCode: "unreadable" });
    const offline = await queryClaudePrepaidCredits({ fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch });
    expect(offline.errorCode).toBe("unreachable");
  });
});
