import { describe, expect, it } from "vitest";
import {
  CredentialRouter, createCredentialMetadata, type ProviderUsageSnapshot, type ProviderUsageWindow,
} from "../../model-auth/packages/core/src/index.js";

const NOW = Date.parse("2030-01-01T12:00:00Z");
const credential = (id: string, over: { providerId?: string; authMethod?: "oauth" | "api-key"; models?: string[] } = {}) => createCredentialMetadata({
  id, providerId: over.providerId ?? "p", authMethod: over.authMethod ?? "api-key", modelIds: over.models ?? ["m1", "m2"],
});
const usageWindow = (over: Partial<ProviderUsageWindow> = {}): ProviderUsageWindow => ({
  id: "account", label: "Account", scope: "account", modelFamilies: [], status: "known", usedRatio: 0.25,
  reliability: "high", kind: null, usedPercent: 25, resetAt: NOW + 60_000, ...over,
});
const usage = (id: string, windows: ProviderUsageWindow[], over: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot => ({
  providerId: "p", credentialId: id, status: "ok", plan: "pro", windows, balance: null,
  fetchedAtUtc: new Date(NOW).toISOString(), error: null, ...over,
});

describe("credential router usage quotas", () => {
  it("isolates account, explicit family, and exact model windows", () => {
    const router = new CredentialRouter([credential("a")], { now: () => NOW });
    router.setUsage("a", usage("a", [
      usageWindow({ id: "account" }),
      usageWindow({ id: "family", scope: "model-family", modelFamilies: ["family-a"], status: "exhausted", usedRatio: 1, usedPercent: 100 }),
      usageWindow({ id: "model", scope: "model", modelFamilies: ["m2"], status: "exhausted", usedRatio: 1, usedPercent: 100 }),
    ]));
    expect(router.candidates({ providerId: "p", modelId: "m1" })).toHaveLength(1);
    expect(router.candidates({ providerId: "p", modelId: "m1", modelFamily: "family-a" })).toHaveLength(0);
    expect(router.candidates({ providerId: "p", modelId: "m2" })).toHaveLength(0);
    expect(router.candidates({ providerId: "p", modelId: "m1", modelFamily: "family-b" })).toHaveLength(1);
  });

  it("rejects mismatched identity and clones snapshots on input and output", () => {
    const router = new CredentialRouter([credential("a")], { now: () => NOW });
    const reading = usage("a", [usageWindow()]);
    expect(() => router.setUsage("a", { ...reading, providerId: "other" })).toThrow(/identity/);
    expect(() => router.setUsage("a", { ...reading, credentialId: "other" })).toThrow(/identity/);
    expect(() => router.setUsage("missing", reading)).toThrow(/unknown credential/);
    router.setUsage("a", reading);
    (reading.windows as ProviderUsageWindow[])[0]!.status = "exhausted";
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a").status).toBe("available");
  });

  it("does not exclude unknown, stale, estimated, low reliability, or expired readings", () => {
    const router = new CredentialRouter([credential("a")], { now: () => NOW, usageMaxAgeMs: 1000 });
    const exhausted = usageWindow({ status: "exhausted", usedRatio: 1, usedPercent: 100 });
    for (const reading of [
      usage("a", [usageWindow({ status: "unknown", usedRatio: null, usedPercent: null })]),
      usage("a", [exhausted], { stale: true }),
      usage("a", [exhausted], { basis: "estimated" }),
      usage("a", [usageWindow({ ...exhausted, reliability: "low" })]),
      usage("a", [usageWindow({ ...exhausted, resetAt: NOW })]),
      usage("a", [exhausted], { fetchedAtUtc: new Date(NOW - 1001).toISOString() }),
    ]) {
      router.setUsage("a", reading);
      expect(router.candidates({ providerId: "p", modelId: "m1" })).toHaveLength(1);
    }
  });

  it("recovers exhausted credentials at reset and reports the decision", () => {
    let now = NOW;
    const router = new CredentialRouter([credential("a")], { now: () => now });
    router.setUsage("a", usage("a", [usageWindow({ status: "exhausted", usedRatio: 1, usedPercent: 100, resetAt: NOW + 100 })]));
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a")).toMatchObject({ status: "exhausted", reason: "confirmed-exhaustion" });
    now += 100;
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a").status).toBe("unknown");
    expect(router.candidates({ providerId: "p", modelId: "m1" })).toHaveLength(1);
  });

  it("sorts by the tightest remaining high-confidence window and rotates ties", () => {
    const router = new CredentialRouter([credential("a"), credential("b"), credential("c")], { now: () => NOW });
    router.setUsage("a", usage("a", [usageWindow({ usedRatio: 0.8, usedPercent: 80 })]));
    router.setUsage("b", usage("b", [usageWindow({ usedRatio: 0.2, usedPercent: 20 })]));
    router.setUsage("c", usage("c", [usageWindow({ usedRatio: 0.2, usedPercent: 20 }), usageWindow({ id: "tight", usedRatio: 0.2, usedPercent: 20 })]));
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("retains ordinary round-robin behavior when usage is missing or mixed with unknown", () => {
    const router = new CredentialRouter([credential("a"), credential("b")], { now: () => NOW });
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["a", "b"]);
    router.setUsage("a", usage("a", [usageWindow()]));
    router.setUsage("b", usage("b", [usageWindow({ status: "unknown", usedRatio: null, usedPercent: null })]));
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["b", "a"]);
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps OAuth, health, failover, and no-usage behavior, while cleaning up on changes", () => {
    const router = new CredentialRouter([credential("oauth", { authMethod: "oauth" }), credential("key")], { strategy: "failover", now: () => NOW });
    router.setUsage("oauth", usage("oauth", [usageWindow({ status: "exhausted", usedRatio: 1, usedPercent: 100 })]));
    router.setProviderOAuthEnabled("p", false);
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["key"]);
    router.setProviderOAuthEnabled("p", true);
    router.setUsage("oauth", null);
    router.reportError("key", { kind: "http", status: 401 });
    expect(router.candidates({ providerId: "p", modelId: "m1" }).map((item) => item.id)).toEqual(["oauth"]);
    router.upsert(credential("oauth", { providerId: "new-provider", authMethod: "oauth" }));
    expect(router.usageDecision({ providerId: "new-provider", modelId: "m1" }, "oauth").reason).toBe("missing-usage");
    router.setUsage("key", usage("key", [usageWindow()]));
    router.remove("key");
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "key").reason).toBe("missing-usage");
  });

  it("ignores older snapshots without replacing the latest reading and supports explicit clearing", () => {
    const router = new CredentialRouter([credential("a")], { now: () => NOW });
    router.setUsage("a", usage("a", [usageWindow({ status: "exhausted", usedRatio: 1, usedPercent: 100 })]));
    router.setUsage("a", usage("a", [usageWindow()], { fetchedAtUtc: new Date(NOW - 100).toISOString() }));
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a").status).toBe("exhausted");
    router.setUsage("a", null);
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a").reason).toBe("missing-usage");
  });

  it("rejects future readings without poisoning timestamp ordering", () => {
    const router = new CredentialRouter([credential("a")], { now: () => NOW });
    expect(() => router.setUsage("a", usage("a", [usageWindow()], { fetchedAtUtc: new Date(NOW + 1).toISOString() }))).toThrow(/future/);
    router.setUsage("a", usage("a", [usageWindow({ status: "exhausted", usedRatio: 1, usedPercent: 100 })]));
    expect(router.usageDecision({ providerId: "p", modelId: "m1" }, "a").status).toBe("exhausted");
  });
});
