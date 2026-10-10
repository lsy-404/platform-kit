import { describe, expect, it } from "vitest";
import { usageErrorSnapshot, UsageRequestError } from "../../model-auth/packages/providers/src/usage.js";
import { mergeUsageReading, type ProviderUsageSnapshot, type ProviderUsageWindow } from "../../model-auth/packages/core/src/index.js";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const HOUR = 3600_000;
const observedAt = new Date(NOW - 2 * 24 * HOUR).toISOString();

const window = (over: Partial<ProviderUsageWindow> = {}): ProviderUsageWindow => ({
  id: "five_hour", label: "5h", scope: "account", modelFamilies: [], status: "known", usedRatio: 0.4, reliability: "high",
  kind: "session", usedPercent: 40, resetAt: NOW + HOUR, windowSeconds: 5 * 3600, ...over,
});
const reading = (over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => ({
  providerId: "anthropic", credentialId: "c1", status: "ok", plan: "max", planMultiplier: 5, planTier: "default_claude_max_5x",
  windows: [window()], balance: { amount: 12, unit: "USD", funded: true },
  extraUsage: { enabled: true, used: 3, limit: 50, usedPercent: 6, currency: "USD" },
  identity: "org-1", fetchedAtUtc: observedAt, observedAtUtc: observedAt, error: null, ...over,
});
const failure = (over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => ({
  providerId: "anthropic", credentialId: "c1", status: "error", plan: null, windows: [], balance: null,
  fetchedAtUtc: new Date(NOW).toISOString(), error: "429 Too Many Requests", errorCode: "rate-limited", ...over,
});

describe("mergeUsageReading keeps the last valid reading", () => {
  it("keeps plan, multiplier, extra usage and balance on a later error, stale and with the original observation time", () => {
    const merged = mergeUsageReading(reading(), failure(), NOW);
    expect(merged).toMatchObject({
      stale: true, plan: "max", planMultiplier: 5, planTier: "default_claude_max_5x",
      extraUsage: { enabled: true, used: 3, limit: 50 }, balance: { amount: 12, unit: "USD", funded: true },
      observedAtUtc: observedAt, error: "429 Too Many Requests", errorCode: "rate-limited",
    });
  });

  it("falls back to the fetch time when the held reading carries no observation time", () => {
    const { observedAtUtc: _omitted, ...held } = reading();
    expect(mergeUsageReading(held, failure(), NOW).observedAtUtc).toBe(observedAt);
  });

  it("marks a carried window set accurate when nothing had to be rolled", () => {
    const merged = mergeUsageReading(reading({ fetchedAtUtc: new Date(NOW - HOUR).toISOString(), observedAtUtc: new Date(NOW - HOUR).toISOString() }), failure(), NOW);
    expect(merged.basis).toBe("accurate");
    expect(merged.windows[0]).toMatchObject({ status: "known", usedRatio: 0.4, reliability: "high" });
  });

  it("rolls an exhausted window past its reset into an estimate instead of keeping it blocking", () => {
    const exhausted = window({ status: "exhausted", usedRatio: 1, usedPercent: 100, resetAt: NOW - HOUR });
    const merged = mergeUsageReading(reading({ windows: [exhausted] }), failure(), NOW);
    expect(merged.basis).toBe("estimated");
    expect(merged.windows[0]).toMatchObject({ status: "unknown", usedRatio: null, usedPercent: 0, reliability: "low", id: "five_hour" });
  });

  it("moves a rolled reset into the future within one window length", () => {
    const stale = window({ resetAt: NOW - 2 * 24 * HOUR + HOUR });
    const merged = mergeUsageReading(reading({ windows: [stale] }), failure(), NOW);
    const next = merged.windows[0]!.resetAt!;
    const span = 5 * HOUR;
    expect(next).toBeGreaterThan(NOW);
    expect(next - NOW).toBeLessThanOrEqual(span);
    expect((next - stale.resetAt!) % span).toBe(0);
  });

  it("drops a window past its reset when its length is unknown", () => {
    const unknownLength = window({ id: "odd", resetAt: NOW - 1, windowSeconds: undefined });
    const merged = mergeUsageReading(reading({ windows: [unknownLength, window()] }), failure(), NOW);
    expect(merged.windows.map((entry) => entry.id)).toEqual(["five_hour"]);
  });

  it("does not merge across different identities", () => {
    const merged = mergeUsageReading(reading(), failure({ identity: "org-2" }), NOW);
    expect(merged.stale).toBeUndefined();
    expect(merged.plan).toBeNull();
    expect(merged.windows).toEqual([]);
  });

  it("returns a successful reading as is", () => {
    const next = reading({ fetchedAtUtc: new Date(NOW).toISOString() });
    expect(mergeUsageReading(reading(), next, NOW)).toBe(next);
  });
});

describe("mergeUsageReading with failures built by the providers package", () => {
  it("carries Retry-After from the failure onto the merged reading", () => {
    const failed = usageErrorSnapshot("anthropic", "c1", new UsageRequestError("rate-limited", "429", 429, 600_000));
    expect(mergeUsageReading(reading(), failed, NOW)).toMatchObject({ stale: true, retryAfterMs: 600_000 });
  });

  it("does not merge across identities when the failure is given the expected one", () => {
    expect(mergeUsageReading(reading(), usageErrorSnapshot("anthropic", "c1", new UsageRequestError("rate-limited", "429"), "org-2"), NOW).stale).toBeUndefined();
    expect(mergeUsageReading(reading(), usageErrorSnapshot("anthropic", "c1", new UsageRequestError("rate-limited", "429"), "org-1"), NOW).stale).toBe(true);
  });
});
