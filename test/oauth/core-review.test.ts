import { describe, expect, it } from "vitest";
import {
  CatalogCache,
  CredentialRouter,
  createCredentialMetadata,
  createWorkBuddyAdapter,
  parseModelsDevPayload,
  type CredentialMetadata,
} from "../../oauth/packages/core/src/index.js";

const credential = (id: string, authMethod: "oauth" | "api-key" = "api-key", weight = 1): CredentialMetadata => createCredentialMetadata({
  id,
  providerId: "provider-a",
  authMethod,
  modelIds: ["shared"],
  weight,
});

const catalogPayload = (providerId = "provider") => ({ providers: {
  [providerId]: { models: { model: { tool_call: true, modalities: { output: ["text"] } } } },
} });

describe("core review fixes", () => {
  it("strictly projects credentials and validates routing fields", () => {
    const metadata = createCredentialMetadata({
      id: "credential",
      providerId: "provider-a",
      authMethod: "api-key",
      modelIds: ["shared"],
      extraSecret: "never exported",
    } as never);
    const router = new CredentialRouter([metadata]);
    router.upsert({ ...metadata, injectedToken: "never exported" } as never);

    expect(router.snapshot()[0]).toEqual(metadata);
    expect(router.snapshot()[0]).not.toHaveProperty("injectedToken");
    expect(() => createCredentialMetadata({ id: "bad", providerId: "provider-a", authMethod: "api-key", modelIds: ["shared"], weight: 1.5 })).toThrow(/weight/);
    expect(() => router.upsert({ ...metadata, health: "cooling-down", cooldownUntilUtc: "not-a-date" } as never)).toThrow(/cooldown/);
  });

  it("never lets a late transient error revive a permanent failure", () => {
    const router = new CredentialRouter([credential("key")]);
    router.reportError("key", { kind: "http", status: 401 });
    router.reportError("key", { kind: "transport" });

    expect(router.health("key")).toEqual({ health: "permanently-failed", cooldownUntilUtc: null });
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toEqual([]);
    router.resetHealth("key");
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toHaveLength(1);
  });

  it("changes global and provider strategy independently of OAuth provider policy", () => {
    const router = new CredentialRouter([credential("oauth", "oauth"), credential("key")]);
    const request = { providerId: "provider-a", modelId: "shared" };

    router.setProviderOAuthEnabled("provider-a", false);
    expect(router.candidates(request).map((item) => item.id)).toEqual(["key"]);
    expect(router.health("oauth")?.health).toBe("healthy");
    router.setProviderOAuthEnabled("provider-a", true);
    router.setStrategy("failover");
    expect(router.candidates(request).map((item) => item.id)).toEqual(["oauth", "key"]);
    router.setStrategy("weighted-round-robin", "provider-a");
    expect(router.candidates(request).map((item) => item.id)).toEqual(["key", "oauth"]);
  });

  it("single-flights refreshes, keeps the prior catalog on invalid results, and isolates snapshots", async () => {
    const cache = new CatalogCache(catalogPayload("cached"));
    let calls = 0;
    let resolveLoader: ((payload: unknown) => void) | undefined;
    const loader = () => {
      calls += 1;
      return new Promise<unknown>((resolve) => { resolveLoader = resolve; });
    };
    const first = cache.refresh(loader);
    const second = cache.refresh(loader);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveLoader?.(catalogPayload("live"));
    await expect(first).resolves.toMatchObject({ status: "live", sourceStatus: "live" });
    await expect(second).resolves.toMatchObject({ status: "live" });

    const mutable = cache.snapshot();
    (mutable.catalog?.providers as { id: string }[])[0]!.id = "mutated";
    expect(cache.snapshot().catalog?.providers[0]?.id).toBe("live");
    await expect(cache.refresh(async () => ({ providers: { invalid: { models: {} } } }))).resolves.toMatchObject({
      status: "error",
      sourceStatus: "live",
    });
    expect(cache.snapshot().catalog?.providers[0]?.id).toBe("live");
  });

  it("releases the refresh lock after a synchronous loader error", async () => {
    const cache = new CatalogCache(catalogPayload("cached"));
    await expect(cache.refresh(() => { throw new Error("sync failure"); })).resolves.toMatchObject({ status: "error", sourceStatus: "cached" });
    await expect(cache.refresh(async () => catalogPayload("recovered"))).resolves.toMatchObject({ status: "live", sourceStatus: "live" });
    expect(cache.snapshot().catalog?.providers[0]?.id).toBe("recovered");
  });

  it("deduplicates duplicate model ids and accepts host-provided WorkBuddy models", () => {
    const catalog = parseModelsDevPayload({ providers: { provider: { models: {
      older: { id: "same", release_date: "2025-01-01", tool_call: true, modalities: { output: ["text"] } },
      newer: { id: "same", release_date: "2026-01-01", tool_call: true, modalities: { output: ["text"] } },
    } } } });
    expect(catalog.providers[0]?.models).toEqual([{ id: "same", name: "same", releaseDate: "2026-01-01" }]);

    const adapter = createWorkBuddyAdapter({
      async authorize() { return credential("workbuddy", "oauth"); },
      async remove() {},
      capability: { models: ["host-model"], defaultModelId: "host-model" },
    });
    expect(adapter.capability).toMatchObject({ defaultModelId: "host-model", models: ["host-model"] });
  });
});
