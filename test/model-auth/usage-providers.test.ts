import { describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import {
  GROK_ENDPOINTS,
  GROK_OAUTH_CLIENT_ID,
  authorizeGrok,
  grokHeaders,
  parseGrokBilling,
  queryGrokUsage,
  type GrokOAuthCredential,
} from "../../model-auth/packages/providers/src/grok.js";
import { authorizeOllamaWeb, parseOllamaSettings, queryOllamaUsage } from "../../model-auth/packages/providers/src/ollama.js";
import { parseAnthropicUsage, parseCodexUsage, queryAnthropicUsage, queryCodexUsage, queryProviderUsage } from "../../model-auth/packages/providers/src/usage.js";

const grokCredential: GrokOAuthCredential = {
  type: "oauth", access: "oauth-access", refresh: "oauth-refresh", expires: Date.now() + 60_000, accountId: "account-1",
};

describe("provider usage adapters", () => {
  it("completes Grok browser OAuth through a correlated loopback callback", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const access = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: "grok-account" })).toString("base64url")}.signature`;
    const credential = await authorizeGrok({
      openExternal: async url => {
        const address = new URL(url);
        expect(address.origin).toBe("https://auth.x.ai");
        expect(address.searchParams.get("client_id")).toBe(GROK_OAUTH_CLIENT_ID);
        expect(address.searchParams.get("scope")).toContain("grok-cli:access");
        const callback = `http://127.0.0.1:${address.searchParams.get("redirect_uri")?.match(/:(\d+)\//)?.[1]}/callback?code=auth-code&state=${encodeURIComponent(address.searchParams.get("state") ?? "")}`;
        await new Promise<void>((resolve, reject) => {
          const request = httpRequest(callback, response => { response.resume(); response.on("end", resolve); });
          request.on("error", reject);
          request.end();
        });
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ access_token: access, refresh_token: "rotated-refresh", expires_in: 3_600 }));
      },
    });
    expect(credential).toMatchObject({ accountId: "grok-account", refresh: "rotated-refresh", type: "oauth" });
    expect(calls[0]?.url).toBe(GROK_ENDPOINTS.token);
    expect(calls[0]?.body).toContain("code_verifier=");
  });

  it("parses the IRIS Codex and Anthropic quota shapes into shared non-secret data", () => {
    const codex = parseCodexUsage({ plan_type: "pro", plan_multiplier: 5, rate_limit: {
      primary_window: { used_percent: 42, reset_at: 2_000_000_000 },
      secondary_window: { used_percent: 10, window_seconds: 604_800 },
    }, credits: { balance: 12.5 } });
    expect(codex.plan).toBe("pro");
    expect(codex.planMultiplier).toBe(5);
    expect(codex.windows.map(window => window.usedPercent)).toEqual([42, 10]);
    expect(codex.windows.map(window => window.remainingPercent)).toEqual([58, 90]);
    expect(codex.balance).toEqual({ amount: 12.5, unit: "credits" });

    const anthropic = parseAnthropicUsage({ subscription_type: "max", five_hour: { utilization: 120, resets_at: "2030-02-03T04:05:06Z" } });
    expect(anthropic.plan).toBe("max");
    expect(anthropic.windows[0]).toMatchObject({ id: "five_hour", usedPercent: 100, remainingPercent: 0, resetAt: Date.parse("2030-02-03T04:05:06Z") });
    expect(JSON.stringify(anthropic)).not.toMatch(/access|refresh|token|secret/i);
  });

  it("provides the IRIS Codex and Anthropic OAuth remaining-query calls", async () => {
    const codex = await queryCodexUsage({ access: "codex-access", accountId: "provider-account" }, {
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer codex-access");
        expect(new Headers(init?.headers).get(`Chat${String.fromCharCode(71, 80, 84)}-Account-Id`)).toBe("provider-account");
        return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 9 } } }));
      },
    });
    expect(codex.windows[0]).toMatchObject({ id: "primary", usedPercent: 9 });

    const anthropic = await queryAnthropicUsage({ access: "anthropic-access", accountId: "org-query" }, {
      fetchImpl: async (url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer anthropic-access");
        if (String(url).endsWith("/usage")) return new Response(JSON.stringify({ five_hour: { utilization: 13 } }));
        if (String(url).endsWith("/profile")) return new Response(JSON.stringify({ organization_id: "org-query", organization_type: "anthropic_max" }));
        return new Response(JSON.stringify({ subscription: { interval: "monthly", current_period_end: "2030-10-01T00:00:00Z" } }));
      },
    });
    expect(anthropic).toMatchObject({ plan: "max", billingInterval: "month", subscriptionRenewsAt: Date.parse("2030-10-01T00:00:00Z") });
    expect(anthropic.metadataError).toBeNull();

    const shared = await queryProviderUsage("openai-codex", { access: "codex-access", accountId: "provider-account" }, {
      credentialId: "host-credential", fetchImpl: async () => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1 } } })),
    });
    expect(shared).toMatchObject({ providerId: "openai-codex", credentialId: "host-credential", status: "ok" });
    expect(shared.windows[0]).toMatchObject({ usedPercent: 1, remainingPercent: 99 });
  });

  it("preserves host token estimates and exact remaining percentages", async () => {
    const ratio = 0.8765432109876543;
    const estimate = {
      provider: "grok", account: "default", windowHours: 5, unit: "tokens" as const,
      windowTokens: 1234, windowRequests: 12, windowUsage: 1234, limitEstimate: 10000,
      remainingRatio: ratio, remainingPercent: ratio * 100, confidence: "learned" as const,
      lowConfidence: false, observations: 3, nextResetAt: null,
    };
    const snapshot = (await import("../../model-auth/packages/providers/src/usage.js")).usageSnapshot("grok", "credential", {
      plan: null,
      windows: [{ id: "window", label: "Window", usedPercent: 12.3456789012345, resetAt: null }],
      balance: null,
      estimate,
    });
    expect(snapshot.windows[0]?.remainingPercent).toBe(100 - 12.3456789012345);
    expect(snapshot.estimate).toEqual(estimate);
  });

  it("parses Grok weekly and monthly billing without treating missing usage as zero", () => {
    const weekly = parseGrokBilling({ config: {
      subscriptionTierDisplay: "SuperGrok Heavy",
      creditUsagePercent: 37.5,
      currentPeriod: { start: "2026-09-07T00:00:00Z", end: "2026-09-14T00:00:00Z" },
      prepaidBalance: { val: 4 },
    } });
    expect(weekly).toMatchObject({ plan: "SuperGrok Heavy", status: "ok", balance: { amount: 4, unit: "credits" } });
    expect(weekly.windows[0]).toMatchObject({ label: "Weekly credits", usedPercent: 37.5, remainingPercent: 62.5 });

    const monthly = parseGrokBilling({ config: {
      currentPeriod: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
      monthlyLimit: { val: 100 }, usage: { includedUsed: { val: 12 } },
    } });
    expect(monthly.windows[0]).toMatchObject({ id: "included", usedPercent: 12, remainingPercent: 88, remaining: 88 });

    const unknown = parseGrokBilling({ config: { currentPeriod: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" } } });
    expect(unknown.status).toBe("unknown");
    expect(unknown.windows).toEqual([]);
  });

  it("queries Grok billing with OAuth-only headers and falls back to the monthly shape", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const usage = await queryGrokUsage(grokCredential, {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        if (String(url) === GROK_ENDPOINTS.billing) return new Response(JSON.stringify({ config: { currentPeriod: { start: "2026-09-01", end: "2026-10-01" } } }));
        return new Response(JSON.stringify({ config: { monthlyLimit: { val: 100 }, usage: { includedUsed: { val: 25 } }, currentPeriod: { start: "2026-09-01", end: "2026-10-01" } } }));
      },
    });
    expect(usage).toMatchObject({ providerId: "grok", credentialId: "account-1", status: "ok" });
    expect(usage.windows[0]).toMatchObject({ usedPercent: 25, remainingPercent: 75, remaining: 75 });
    expect(calls.map(call => call.url)).toEqual([GROK_ENDPOINTS.billing, GROK_ENDPOINTS.billingDefault]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer oauth-access");
    expect(calls[0]!.headers.get("x-xai-token-auth")).toBe("xai-grok-cli");
    expect(grokHeaders(grokCredential)).not.toHaveProperty("refresh");
    expect(GROK_OAUTH_CLIENT_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("parses Ollama monthly and legacy web limit fields", () => {
    const html = `<section><h2>Plan &amp; Billing</h2><h3>Included usage</h3><span> $7.50 of $60 used </span><span data-time="2030-10-01T00:00:00Z">Resets in 20 days</span><h3>Session</h3><span>12.5% used</span><h3>Weekly</h3><span>40% used</span><span data-time="2030-09-14T00:00:00Z">Resets</span><strong>Pro</strong></section>`;
    const parsed = parseOllamaSettings(html);
    expect(parsed).toMatchObject({ plan: "Pro", status: "ok" });
    expect(parsed.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "included", usedPercent: 12.5, remainingPercent: 87.5, limit: 60, remaining: 52.5, unit: "USD" }),
      expect.objectContaining({ id: "session", usedPercent: 12.5 }),
      expect.objectContaining({ id: "weekly", usedPercent: 40 }),
    ]));
    expect(parseOllamaSettings("<h2>Cloud Usage</h2><p>Plan: Pro</p>").status).toBe("unknown");
  });

  it("uses a host browser session callback for Ollama login without exposing the cookie in usage", async () => {
    let reads = 0;
    const result = await authorizeOllamaWeb({
      openExternal: async url => { expect(url).toBe("https://ollama.com/signin"); },
      readCookieHeader: async () => { reads += 1; return reads === 1 ? "wos-session=opaque" : "wos-session=opaque"; },
      pollMs: 250,
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get("cookie")).toBe("wos-session=opaque");
        return new Response("<h2>Cloud Usage</h2><h3>Weekly</h3><span>20% used</span>");
      },
    });
    expect(result.session.cookie).toBe("wos-session=opaque");
    expect(result.usage.windows[0]).toMatchObject({ id: "weekly", usedPercent: 20 });
    expect(JSON.stringify(result.usage)).not.toContain("wos-session");
  });

  it("returns a safe error when Ollama has no browser session", async () => {
    const result = await queryOllamaUsage();
    expect(result).toMatchObject({ providerId: "ollama-cloud", status: "error", error: "Ollama web session is not available." });
  });
});
