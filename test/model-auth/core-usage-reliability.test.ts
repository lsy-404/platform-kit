import { describe, expect, it } from "vitest";
import {
  OAUTH_TOMBSTONE, acceptsRenewal, classifyUsageHttp, createRefreshGate, describeOAuthCredential, mergeUsageReading,
  planMultiplierFromTier, usageRemedy, type ProviderUsageSnapshot, type ProviderUsageWindow,
} from "../../model-auth/packages/core/src/index.js";

const NOW = Date.parse("2030-01-01T12:00:00Z");
const window = (id: string, resetAt: number | null): ProviderUsageWindow => ({
  id, label: id, scope: "account", modelFamilies: [], status: "known", usedRatio: 0.4, reliability: "high", kind: null, usedPercent: 40, resetAt,
});
const snapshot = (over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => ({
  providerId: "p", credentialId: "c1", status: "ok", plan: "pro", windows: [], balance: null,
  fetchedAtUtc: new Date(NOW - 3600_000).toISOString(), error: null, ...over,
});
const failure = (over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => snapshot({
  status: "error", fetchedAtUtc: new Date(NOW).toISOString(), error: "503", errorCode: "server-error", ...over,
});

describe("usage error classification", () => {
  it("separates rejected credentials from server failures", () => {
    for (const status of [302, 401, 403]) expect(classifyUsageHttp(status)).toBe("signed-out");
    expect(classifyUsageHttp(200)).toBe("ok");
    expect(classifyUsageHttp(429)).toBe("rate-limited");
    for (const status of [404, 500, 503]) expect(classifyUsageHttp(status)).toBe("server-error");
  });

  it("maps codes to remedies", () => {
    expect(usageRemedy("signed-out")).toBe("reauth");
    for (const code of ["rate-limited", "server-error", "unreadable", "unreachable"] as const) expect(usageRemedy(code)).toBe("retry");
    expect(usageRemedy("no-limits")).toBeNull();
    expect(usageRemedy(null)).toBeNull();
  });

  it("reads multipliers from tier names", () => {
    expect(planMultiplierFromTier("default_claude_max_5x")).toBe(5);
    expect(planMultiplierFromTier("max_20x")).toBe(20);
    expect(planMultiplierFromTier("default_claude_pro")).toBeNull();
    expect(planMultiplierFromTier(undefined)).toBeNull();
  });
});

describe("mergeUsageReading", () => {
  it("returns a successful reading unchanged", () => {
    const next = snapshot({ windows: [window("a", NOW + 1000)] });
    expect(mergeUsageReading(snapshot(), next, NOW)).toBe(next);
  });

  it("serves the last good reading as stale and drops expired windows", () => {
    const previous = snapshot({ windows: [window("live", NOW + 60_000), window("reset", NOW - 1)] });
    const merged = mergeUsageReading(previous, failure(), NOW);
    expect(merged).toMatchObject({ stale: true, error: "503", errorCode: "server-error", fetchedAtUtc: previous.fetchedAtUtc });
    expect(merged.windows.map(entry => entry.id)).toEqual(["live"]);
  });

  it("keeps windows without a reset for at most 24 hours", () => {
    const fresh = snapshot({ windows: [window("open", null)] });
    expect(mergeUsageReading(fresh, failure(), NOW).windows).toHaveLength(1);
    const old = snapshot({ windows: [window("open", null)], fetchedAtUtc: new Date(NOW - 25 * 3600_000).toISOString() });
    expect(mergeUsageReading(old, failure(), NOW).windows).toHaveLength(0);
  });

  it("does not borrow across credentials or identities", () => {
    const previous = snapshot({ windows: [window("a", NOW + 1000)], identity: "org-1" });
    expect(mergeUsageReading(previous, failure({ credentialId: "c2" }), NOW).stale).toBeUndefined();
    expect(mergeUsageReading(previous, failure({ identity: "org-2" }), NOW).stale).toBeUndefined();
    expect(mergeUsageReading(previous, failure({ identity: "org-1" }), NOW).stale).toBe(true);
    expect(mergeUsageReading(null, failure(), NOW).stale).toBeUndefined();
    expect(mergeUsageReading(failure(), failure(), NOW).stale).toBeUndefined();
  });
});

describe("OAuth renewal", () => {
  const existing = { expires: 100, accountId: "acct" };

  it("accepts only a newer renewal for the same account", () => {
    expect(acceptsRenewal(existing, { expires: 200, accountId: "acct" })).toBe(true);
    expect(acceptsRenewal(existing, { expires: 100, accountId: "acct" })).toBe(false);
    expect(acceptsRenewal(existing, { expires: 50, accountId: "acct" })).toBe(false);
    expect(acceptsRenewal(existing, { expires: 200, accountId: "other" })).toBe(false);
    expect(acceptsRenewal(existing, { expires: 200 })).toBe(false);
  });

  it("never writes into an empty slot or a tombstone", () => {
    expect(acceptsRenewal(null, { expires: 200 })).toBe(false);
    expect(acceptsRenewal(undefined, { expires: 200 })).toBe(false);
    expect(acceptsRenewal(OAUTH_TOMBSTONE, { expires: 200 })).toBe(false);
  });

  it("runs one refresh per credential at a time", async () => {
    const gate = createRefreshGate();
    let runs = 0;
    let release!: (value: string) => void;
    const task = () => { runs++; return new Promise<string>(resolve => { release = resolve; }); };
    const first = gate.run("c1", task), second = gate.run("c1", task), other = gate.run("c2", async () => "other");
    release("done");
    expect(await Promise.all([first, second])).toEqual(["done", "done"]);
    expect(await other).toBe("other");
    expect(runs).toBe(1);
    expect(await gate.run("c1", async () => "again")).toBe("again");
  });

  it("releases the gate after a failure", async () => {
    const gate = createRefreshGate();
    await expect(gate.run("c1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await gate.run("c1", async () => "ok")).toBe("ok");
  });
});

describe("describeOAuthCredential", () => {
  const claims = Buffer.from(JSON.stringify({
    "https://api.openai.com/profile": { email: "person@example.test" },
    "https://api.openai.com/auth": { chatgpt_plan_type: "prolite", chatgpt_account_id: "acct-1" },
  })).toString("base64url");
  const access = `eyJhbGciOiJub25lIn0.${claims}.signature-value`;

  it("maps Codex credentials from token claims without exposing tokens", () => {
    const view = describeOAuthCredential("openai-codex", { type: "oauth", access, refresh: "refresh-secret-value", expires: NOW + 3600_000, accountId: "acct-1", extra: "ignored" }, NOW);
    expect(view).toEqual({ account: "person@example.test", plan: "pro", planMultiplier: 5, tokenExpiresAt: NOW + 3600_000, status: "active" });
    const text = JSON.stringify(view);
    for (const secret of [access, "refresh-secret-value", "signature-value", "ignored"]) expect(text).not.toContain(secret);
  });

  it("maps Anthropic fields, scopes and refresh timing", () => {
    const view = describeOAuthCredential("anthropic", {
      access: "a-secret", refresh: "r-secret", expires: NOW - 1000, email: "user@example.test", organizationId: "org-9",
      subscriptionType: "max", rateLimitTier: "default_claude_max_20x", scope: "user:profile user:inference", lastRefreshAt: "2030-01-01T11:00:00Z", unknownField: "x",
    }, NOW);
    expect(view).toEqual({
      account: "user@example.test", organization: "org-9", plan: "max", planMultiplier: 20, tokenExpiresAt: NOW - 1000,
      scopes: ["user:profile", "user:inference"], lastRefreshAt: Date.parse("2030-01-01T11:00:00Z"), status: "refresh-needed",
    });
  });

  it("never falls back to an internal account id for the display account", () => {
    expect(describeOAuthCredential("anthropic", { access: "a", accountId: "5f0c3d2e-0000-4000-8000-000000000000", account_id: "internal" }, NOW).account).toBeUndefined();
    const access = `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })).toString("base64url")}.s`;
    expect(describeOAuthCredential("openai-codex", { access, accountId: "acct-1" }, NOW).account).toBeUndefined();
  });

  it("reports reauth when the refresh token has expired and unknown when nothing is known", () => {
    expect(describeOAuthCredential("anthropic", { expires: NOW + 1000, refreshExpiresAt: NOW - 1 }, NOW).status).toBe("reauth");
    expect(describeOAuthCredential("anthropic", null, NOW)).toEqual({ status: "unknown" });
  });

  it("drops values that look like tokens", () => {
    const view = describeOAuthCredential("anthropic", { access: "tok-1", refresh: "tok-2", email: "tok-1", organizationName: "eyJhbGciOiJub25lIn0.payload.sig", scopes: ["tok-2", "ok:scope"] }, NOW);
    expect(view).toEqual({ scopes: ["ok:scope"], status: "unknown" });
  });
});
