import { describe, expect, it } from "vitest";
import { createGrokAdapter, createCredentialMetadata } from "../../model-auth/packages/core/src/index.js";
import { parseGrokBilling } from "../../model-auth/packages/providers/src/grok.js";
import { normalizeModelFamilyId, parseAnthropicUsage, parseCodexUsage, usageSnapshot, usageWindow } from "../../model-auth/packages/providers/src/usage.js";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("structured usage windows", () => {
  it("derives status and ratio from the used percentage", () => {
    expect(usageWindow({ id: "a", label: "A", usedPercent: 25, resetAt: null })).toMatchObject({ scope: "account", modelFamilies: [], status: "known", usedRatio: 0.25, reliability: "high" });
    expect(usageWindow({ id: "a", label: "A", usedPercent: 100, resetAt: 1 })).toMatchObject({ status: "known", usedRatio: 1 });
    expect(usageWindow({ id: "a", label: "A", usedPercent: 100, resetAt: 1, exhausted: true })).toMatchObject({ status: "exhausted" });
    expect(usageWindow({ id: "a", label: "A", usedPercent: null, resetAt: null })).toMatchObject({ status: "unknown", usedRatio: null });
  });

  it("normalizes model family ids", () => {
    expect(normalizeModelFamilyId(" Alpha-5.3 Fast_Spark ")).toBe("alpha-5.3-fast-spark");
  });

  it("marks Anthropic windows by scope and family and keeps absent usage explicit", () => {
    const parsed = parseAnthropicUsage({
      five_hour: { utilization: 30, resets_at: "2030-02-03T04:05:06Z" },
      seven_day: { utilization: 100, locked_reason: "limit" },
      seven_day_opus: { utilization: 55 },
      seven_day_sonnet: {},
      seven_day_oauth_apps: null,
    });
    const byId = Object.fromEntries(parsed.windows.map(window => [window.id, window]));
    expect(byId.five_hour).toMatchObject({ scope: "account", modelFamilies: [], status: "known", usedRatio: 0.3 });
    expect(byId.seven_day).toMatchObject({ scope: "account", status: "exhausted", usedRatio: 1 });
    expect(byId.seven_day_opus).toMatchObject({ scope: "model-family", modelFamilies: ["opus"], status: "known", usedRatio: 0.55 });
    expect(byId.seven_day_sonnet).toMatchObject({ scope: "model-family", modelFamilies: ["sonnet"], status: "unknown", usedRatio: null, usedPercent: null });
    expect(byId.seven_day_oauth_apps).toBeUndefined();
  });

  it("marks Codex account windows and per-model additional limits", () => {
    const parsed = parseCodexUsage({
      rate_limit: { limit_reached: true, primary_window: { used_percent: 10, reset_at: 2_000_000_000, limit_window_seconds: 18000 }, secondary_window: { used_percent: 100, limit_window_seconds: 604800 } },
      additional_rate_limits: [{ limit_name: "Alpha-5.3-Fast-Spark", metered_feature: "codex_bengalfish", rate_limit: { primary_window: { used_percent: 40 }, secondary_window: {} } }],
    });
    const byId = Object.fromEntries(parsed.windows.map(window => [window.id, window]));
    expect(byId.primary).toMatchObject({ scope: "account", status: "known", usedRatio: 0.1, resetAt: 2_000_000_000_000 });
    expect(byId.secondary).toMatchObject({ scope: "account", status: "exhausted" });
    expect(byId["codex_bengalfish:primary"]).toMatchObject({ scope: "model", modelFamilies: ["alpha-5.3-fast-spark"], status: "known", usedRatio: 0.4 });
    expect(byId["codex_bengalfish:secondary"]).toMatchObject({ scope: "model", status: "unknown", usedRatio: null });
  });

  it("marks Grok windows as account scope", () => {
    const parsed = parseGrokBilling({ config: {
      currentPeriod: { start: daysFromNow(-10), end: daysFromNow(20) },
      monthlyLimit: { val: 100 }, usage: { includedUsed: { val: 100 } },
    } });
    expect(parsed.windows[0]).toMatchObject({ scope: "account", modelFamilies: [], status: "exhausted", usedRatio: 1, reliability: "high" });
  });

  it("carries structured fields through snapshots and the core adapter validation", async () => {
    const window = usageWindow({ id: "w", label: "W", usedPercent: 50, resetAt: null, scope: "model-family", modelFamilies: ["opus"] });
    const snapshot = usageSnapshot("grok", "credential", { plan: null, windows: [window], balance: null });
    expect(snapshot.windows[0]).toMatchObject({ scope: "model-family", modelFamilies: ["opus"], status: "known", usedRatio: 0.5 });
    const metadata = createCredentialMetadata({ id: "credential", providerId: "grok", authMethod: "oauth", modelIds: ["grok-build"] });
    const adapter = (value: unknown) => createGrokAdapter({
      async authorize() { return metadata; },
      async remove() {},
      async request() { return { output: "", modelId: "grok-build", finishReason: "stop" }; },
      async queryUsage() { return value as never; },
    });
    await expect(adapter(snapshot).host.queryUsage?.("credential")).resolves.toMatchObject({ windows: [{ scope: "model-family", modelFamilies: ["opus"], status: "known", usedRatio: 0.5, reliability: "high" }] });
    const bad = { ...snapshot, windows: [{ ...snapshot.windows[0], status: "unknown" }] };
    await expect(adapter(bad).host.queryUsage?.("credential")).rejects.toThrow("invalid usage window");
    const missing = { ...snapshot, windows: [{ id: "w", label: "W", usedPercent: 50, resetAt: null }] };
    await expect(adapter(missing).host.queryUsage?.("credential")).rejects.toThrow("invalid usage window");
  });
});
