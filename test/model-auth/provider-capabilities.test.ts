import { describe, expect, it } from "vitest";
import { MODEL_AUTH_PROVIDER_CAPABILITIES, modelAuthProviderCapability } from "../../model-auth/packages/providers/src/capabilities.js";

describe("model-auth provider capabilities", () => {
  it("declares every shipped provider exactly once", () => {
    expect(MODEL_AUTH_PROVIDER_CAPABILITIES.map((item) => item.id)).toEqual([
      "anthropic", "openai-codex", "workbuddy", "traecode", "grok", "ollama-cloud",
      "github-copilot", "kimi-coding", "openrouter", "xai", "meta", "radius",
    ]);
    expect(new Set(MODEL_AUTH_PROVIDER_CAPABILITIES.map((item) => item.id)).size).toBe(MODEL_AUTH_PROVIDER_CAPABILITIES.length);
  });

  it("distinguishes renewable OAuth from an Ollama API key", () => {
    expect(modelAuthProviderCapability("workbuddy")?.access.usage).toBe(false);
    expect(modelAuthProviderCapability("grok")).toMatchObject({
      authorization: { kind: "browser-oauth", renewable: true, multiAccount: true },
      access: { inference: true, modelCatalog: true, usage: true },
      catalogProviderId: "xai",
    });
    expect(modelAuthProviderCapability("ollama-cloud")).toMatchObject({
      authorization: { kind: "api-key", renewable: false, multiAccount: false },
      access: { inference: false, modelCatalog: false, usage: true },
    });
    expect(modelAuthProviderCapability("missing")).toBeNull();
    expect(modelAuthProviderCapability("kimi-coding")?.catalogProviderId).toBe("kimi-code-plan-cn");
    expect(modelAuthProviderCapability("openrouter")?.authorization.renewable).toBe(false);
    expect(modelAuthProviderCapability("meta")?.catalogProviderId).toBe("meta");
    expect(modelAuthProviderCapability("radius")?.catalogProviderId).toBeNull();
  });
});
