import { describe, expect, it } from "vitest";
import {
  CatalogCache,
  CredentialRouter,
  createCredentialMetadata,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createTraeAdapter,
  createGrokAdapter,
  createWorkBuddyAdapter,
  normalizeModelId,
  normalizeProviderId,
  parseModelsDevPayload,
  filterProviderModels,
  filterCatalogModels,
  agentModelCatalog,
  bindRuntimeProviders,
  providerBinding,
  supportsTextToolCalls,
  serializeCredentialMetadata,
  type CredentialMetadata,
  type ProviderAuthInteraction,
  type ProviderRequest,
  type ProviderUsageEstimate,
} from "../../model-auth/packages/core/src/index.js";

const oauth = (id: string, models = ["shared"]): CredentialMetadata => createCredentialMetadata({
  id,
  providerId: "provider-a",
  authMethod: "oauth",
  modelIds: models,
});

const apiKey = (id: string, models = ["shared"], weight = 1, enabled = true): CredentialMetadata => createCredentialMetadata({
  id,
  providerId: "provider-a",
  authMethod: "api-key",
  modelIds: models,
  weight,
  enabled,
});

describe("model-auth core", () => {
  it("parses and normalizes a complete models.dev provider catalog", () => {
    const catalog = parseModelsDevPayload({ providers: {
      "Provider A": { id: "Provider_A", name: "Provider A", npm: "@ai-sdk/provider-a", models: {
        "model-a": { name: "Model A", tool_call: true, release_date: "2025-01-01", modalities: { output: ["text"] } },
        "model-b": { id: "model-b", name: "Model B", tool_call: true, release_date: "2026-01-01", modalities: { output: ["text"] } },
        "deprecated": { tool_call: true, deprecated: true, status: "active", modalities: { output: ["text"] } },
        "status-deprecated": { tool_call: true, status: "deprecated", modalities: { output: ["text"] } },
        "no-tools": { tool_call: false, modalities: { output: ["text"] } },
        "no-text": { tool_call: true, modalities: { output: ["image"] } },
      } },
    } });
    expect(normalizeProviderId(" Provider_A ")).toBe("provider-a");
    expect(normalizeModelId("model-a")).toBe("model-a");
    expect(catalog.providers[0]?.id).toBe("provider-a");
    expect(catalog.providers[0]?.models.map((model) => model.id)).toEqual(["model-b", "model-a", "deprecated", "no-text", "no-tools", "status-deprecated"]);
    expect(catalog.providers[0]?.packageName).toBe("@ai-sdk/provider-a");
    expect(providerBinding(catalog, "PROVIDER_A")?.id).toBe("provider-a");
    expect(filterProviderModels(catalog, "provider-a", ["model-b"]).map((model) => model.id)).toEqual(["model-b"]);
    expect(agentModelCatalog(catalog).providers[0]?.models.map((model) => model.id)).toEqual(["model-b", "model-a"]);
    expect(filterCatalogModels(catalog, supportsTextToolCalls).providers[0]?.models.map((model) => model.id)).toEqual(["model-b", "model-a", "deprecated", "status-deprecated"]);
    expect(bindRuntimeProviders(catalog, [{ runtimeProviderId: "openai-codex", catalogProviderId: "provider-a", includeModel: (model) => model.id.startsWith("model-") }])[0]?.models.map((model) => model.id)).toEqual(["model-b", "model-a"]);
    expect(parseModelsDevPayload({ providers: { broken: { models: [] } } }).providers).toEqual([]);
    expect(parseModelsDevPayload({ providers: {
      invalidPackage: { npm: {}, models: { model: { tool_call: true, modalities: { output: ["text"] } } } },
    } }).providers[0]?.packageName).toBeNull();
    expect(() => parseModelsDevPayload([])).toThrow();
  });

  it("preserves valid Atlas metadata while dropping invalid optional values", () => {
    const catalog = parseModelsDevPayload({ providers: {
      atlas: {
        api: " https://api.example.test/v1 ",
        env: ["ATLAS_API_KEY", "", 4, "ATLAS_API_KEY"],
        npm: " @ai-sdk/openai-compatible ",
        models: {
          full: {
            description: " Atlas model ",
            knowledge_cutoff: "2025-06",
            knowledge: "ignored",
            reasoning: true,
            reasoning_options: [{ values: ["low", "high"] }, { options: ["high", "max"] }, { efforts: ["minimal"] }, { values: [4] }],
            attachment: true,
            tool_call: true,
            status: " active ",
            modalities: { input: ["text", "image", "text", 4], output: ["text", "image"] },
            limit: { context: 1000000, input: 900000, output: 100000, ignored: -1 },
            cost: { input: 1.5, output: 6, cache_read: 0.15, cache_write: 0.3, ignored: Number.NaN },
            release_date: "2026-01-01",
          },
          sparse: {
            description: "",
            knowledge: 2,
            reasoning: "yes",
            attachment: null,
            tool_call: false,
            status: [],
            modalities: { input: [], output: [4] },
            limit: { context: -1, input: Number.POSITIVE_INFINITY },
            cost: { input: -1, output: Number.NaN },
            release_date: 3,
          },
        },
      },
    } });

    expect(catalog.providers[0]).toMatchObject({ id: "atlas", api: "https://api.example.test/v1", env: ["ATLAS_API_KEY"], packageName: "@ai-sdk/openai-compatible" });
    expect(catalog.providers[0]?.models.find((model) => model.id === "full")).toEqual({
      id: "full", name: "full", description: "Atlas model", knowledgeCutoff: "2025-06", reasoning: true,
      reasoningEfforts: ["low", "high", "max", "minimal"], attachment: true, toolCall: true, status: "active",
      modalities: { input: ["text", "image"], output: ["text", "image"] }, limits: { context: 1000000, input: 900000, output: 100000 },
      cost: { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 0.3 }, releaseDate: "2026-01-01",
    });
    expect(catalog.providers[0]?.models.find((model) => model.id === "sparse")).toEqual({ id: "sparse", name: "sparse", toolCall: false });
  });

  it.each([
    ["openai-codex", createOpenAIAdapter],
    ["anthropic", createAnthropicAdapter],
  ] as const)("validates %s host credentials before exposing metadata", async (providerId, createAdapter) => {
    const credential = createCredentialMetadata({ id: "account", providerId, authMethod: "oauth", modelIds: ["model"] });
    const adapter = createAdapter({
      authorize: async () => ({ ...credential, access: "private-value" }),
      remove: async () => {},
      refresh: async () => ({ ...credential, providerId: "wrong-provider" }),
    });
    expect(adapter.capability.providerId).toBe(providerId);
    expect(await adapter.host.authorize()).toEqual(credential);
    await expect(adapter.host.refresh!("account")).rejects.toThrow("incompatible credential");
  });

  it("keeps the previous cache catalog when a refresh payload fails", () => {
    const cache = new CatalogCache({
      providers: {
        provider: { models: { model: { tool_call: true, modalities: { output: ["text"] } } } },
      },
    });
    const previous = cache.snapshot().catalog;
    expect(cache.snapshot().status).toBe("cached");
    expect(cache.snapshot().sourceStatus).toBe("cached");
    const failed = cache.fail(new Error("refresh failed"));
    expect(failed.catalog).toEqual(previous);
    expect(failed.catalog).not.toBe(previous);
    (failed.catalog?.providers as { id: string }[])[0]!.id = "mutated";
    expect(cache.snapshot().catalog?.providers[0]?.id).toBe("provider");
    expect(cache.snapshot().status).toBe("error");
    expect(cache.snapshot().sourceStatus).toBe("cached");
    expect(cache.accept({
      providers: {
        fallback: { models: { model: { tool_call: true, modalities: { output: ["text"] } } } },
      },
    }, "fallback").status).toBe("fallback");
  });

  it("routes round-robin candidates only within provider, model, and enabled credentials", () => {
    const router = new CredentialRouter([
      oauth("oauth"),
      apiKey("api"),
      apiKey("disabled", ["shared"], 1, false),
      createCredentialMetadata({ id: "other-provider", providerId: "provider-b", authMethod: "api-key", modelIds: ["shared"] }),
      oauth("other-model", ["other"]),
    ]);
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" }).map((item) => item.id)).toEqual(["api", "oauth"]);
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" }).map((item) => item.id)).toEqual(["oauth", "api"]);
  });

  it("supports weighted and failover strategies", () => {
    const weighted = new CredentialRouter([apiKey("a", ["m"], 3), apiKey("b", ["m"], 1)], { strategy: "weighted-round-robin" });
    expect(weighted.candidates({ providerId: "provider-a", modelId: "m" }).map((item) => item.id)).toEqual(["a", "b"]);
    expect(weighted.candidates({ providerId: "provider-a", modelId: "m" }).map((item) => item.id)).toEqual(["a", "b"]);
    expect(weighted.candidates({ providerId: "provider-a", modelId: "m" }).map((item) => item.id)).toEqual(["a", "b"]);
    expect(weighted.candidates({ providerId: "provider-a", modelId: "m" }).map((item) => item.id)).toEqual(["b", "a"]);
    const failover = new CredentialRouter([apiKey("b", ["m"]), apiKey("a", ["m"])], { strategy: "failover" });
    expect(failover.candidates({ providerId: "provider-a", modelId: "m" }).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("applies transient cooling, permanent isolation, and successful recovery", () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const router = new CredentialRouter([apiKey("key")], { now: () => now, transientCooldownMs: 100, rateLimitCooldownMs: 500 });
    router.reportError("key", { kind: "http", status: 429 });
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toEqual([]);
    expect(router.health("key")?.cooldownUntilUtc).toBe("2026-01-01T00:00:00.500Z");
    now += 500;
    expect(router.health("key")).toEqual({ health: "healthy", cooldownUntilUtc: null });
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toHaveLength(1);
    expect(router.snapshot().find((credential) => credential.id === "key")?.health).toBe("healthy");
    router.reportError("key", { kind: "http", status: 401 });
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toEqual([]);
    router.reportSuccess("key");
    expect(router.candidates({ providerId: "provider-a", modelId: "shared" })).toEqual([]);
    router.remove("key");
    expect(router.health("key")).toBeNull();
  });

  it("synchronizes credentials without clearing health, then supports explicit reset", () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const initial = apiKey("key");
    const router = new CredentialRouter([initial], { now: () => now, transientCooldownMs: 100 });
    router.reportError("key", { kind: "http", status: 503 });
    router.upsert({ ...initial, enabled: false, weight: 7 });
    expect(router.health("key")?.health).toBe("cooling-down");
    router.setEnabled("key", true);
    router.setWeight("key", 9);
    now += 100;
    router.resetHealth("key");
    expect(router.health("key")).toEqual({ health: "healthy", cooldownUntilUtc: null });
  });

  it("keeps adapter factories metadata-only and omits sensitive fields", async () => {
    const metadata = createCredentialMetadata({ id: "credential", providerId: "workbuddy", authMethod: "oauth", modelIds: ["glm-5.2"] });
    const host = {
      async authorize() { return metadata; },
      async remove() {},
    };
    const workbuddy = createWorkBuddyAdapter(host);
    const trae = createTraeAdapter(host);
    expect(workbuddy.capability.authMethods).toEqual(["oauth"]);
    expect(workbuddy.capability.displayName).toBe("WorkBuddy");
    expect(trae.capability.defaultModelId).toBe("");
    expect(trae.capability.models).toEqual([]);
    expect(await workbuddy.host.authorize()).toEqual(metadata);
    expect(serializeCredentialMetadata(metadata)).not.toMatch(/apiKey|token|secret|password|endpoint/i);
  });

  it("keeps authentication interaction, requests and usage on the trusted host boundary", async () => {
    const metadata = createCredentialMetadata({ id: "credential", providerId: "grok", authMethod: "oauth", modelIds: ["grok-build"], extend: { region: "us" } });
    const request: ProviderRequest = { modelId: "grok-build", input: { messages: [] } };
    const estimate: ProviderUsageEstimate = {
      provider: "grok", account: "default", windowHours: 5, unit: "tokens", windowTokens: 1234,
      windowRequests: 12, windowUsage: 1234, limitEstimate: 10000, remainingRatio: 0.8766,
      remainingPercent: 87.66, confidence: "learned", lowConfidence: false, observations: 3, nextResetAt: null,
    };
    let received: ProviderAuthInteraction | undefined;
    let called: { credentialId: string; request: ProviderRequest } | undefined;
    const adapter = createGrokAdapter({
      async authorize(interaction) { received = interaction; return metadata; },
      async remove() {},
      async request(credentialId, value) { called = { credentialId, request: value }; return { output: "ok", modelId: value.modelId, finishReason: "stop" }; },
      async queryUsage(credentialId) { return { providerId: "grok", credentialId, status: "unknown", plan: null, windows: [], balance: null, estimate, fetchedAtUtc: new Date().toISOString(), error: null }; },
    });
    const interaction: ProviderAuthInteraction = {
      providerId: "grok", authType: "oauth", loginId: "login-1", notify() {}, prompt: async () => "value",
    };
    expect(await adapter.host.authorize(interaction)).toEqual(metadata);
    expect(received).toBe(interaction);
    await expect(adapter.host.request?.("credential", request, {})).resolves.toEqual({ output: "ok", modelId: "grok-build", finishReason: "stop" });
    expect(called).toEqual({ credentialId: "credential", request });
    await expect(adapter.host.queryUsage?.("credential")).resolves.toMatchObject({ providerId: "grok", status: "unknown", estimate });
    await expect(createGrokAdapter({
      async authorize() { return metadata; },
      async remove() {},
      async queryUsage(credentialId) { return { providerId: "grok", credentialId, status: "unknown", plan: null, windows: [], balance: null, estimate: { ...estimate, remainingPercent: 87.6 }, fetchedAtUtc: new Date().toISOString(), error: null }; },
    }).host.queryUsage?.("credential")).rejects.toThrow("invalid usage estimate");
  });

  it("validates and serializes only non-sensitive scalar extend fields", () => {
    const credential = createCredentialMetadata({ id: "credential", providerId: "grok", authMethod: "oauth", modelIds: ["grok-build"], extend: { region: "us", priority: 2, enabledByPolicy: true, note: null } });
    expect(credential.extend).toEqual({ region: "us", priority: 2, enabledByPolicy: true, note: null });
    expect(JSON.parse(serializeCredentialMetadata(credential)).extend).toEqual(credential.extend);
    const router = new CredentialRouter([credential]);
    router.setExtend("credential", { region: "eu" });
    expect(router.snapshot()[0]?.extend).toEqual({ region: "eu" });
    expect(() => createCredentialMetadata({ ...credential, extend: { access_token: "never" } } as never)).toThrow(/field name/);
    expect(() => createCredentialMetadata({ ...credential, extend: { nested: { value: true } } } as never)).toThrow(/scalar/);
  });
});
