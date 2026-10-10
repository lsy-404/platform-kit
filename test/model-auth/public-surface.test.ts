import { describe, expect, it } from "vitest";
import { MODEL_AUTH_VERSION } from "../../model-auth/packages/core/src/index.js";
import * as providers from "../../model-auth/packages/providers/src/index.js";
import * as ollama from "../../model-auth/packages/providers/src/ollama.js";
import * as opencode from "../../model-auth/packages/providers/src/opencode.js";
import * as usage from "../../model-auth/packages/providers/src/usage.js";
import { credentialReady, credentialRemaining, fill, lowestRemaining, windowRemaining } from "../../model-auth/packages/vue/src/usage";
import { defaultMessages } from "../../model-auth/packages/vue/src/messages";

describe("public package surface", () => {
  it("exposes a semantic package version", () => {
    expect(MODEL_AUTH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exports the Ollama account usage API from the root and subpath", () => {
    expect(providers.queryOllamaAccountUsage).toBe(ollama.queryOllamaAccountUsage);
    expect(typeof providers.authorizeOllamaWeb).toBe("function");
    expect(typeof providers.queryOllamaUsage).toBe("function");
  });

  it("exports the Claude prepaid credits query from the root and the usage subpath", () => {
    expect(typeof usage.queryClaudePrepaidCredits).toBe("function");
    expect(providers.queryClaudePrepaidCredits).toBe(usage.queryClaudePrepaidCredits);
  });

  it("exports the OpenCode Go usage API from the root and subpath, and no longer the Ollama key endpoint", () => {
    expect(providers.queryOpencodeGoKeyUsage).toBe(opencode.queryOpencodeGoKeyUsage);
    expect(providers.parseOpencodeGoUsage).toBe(opencode.parseOpencodeGoUsage);
    expect(providers.OPENCODE_GO_USAGE_URL).toBe("https://opencode.ai/zen/go/v1/usage");
    for (const removed of ["queryOllamaKeyUsage", "parseOllamaKeyUsage", "OLLAMA_USAGE_URL"]) expect(providers).not.toHaveProperty(removed);
  });

  it("derives remaining percentages and readiness", () => {
    expect(windowRemaining({ id: "a", label: "A", usedPercent: 60, resetAt: null })).toBe(40);
    expect(windowRemaining({ id: "a", label: "A", usedPercent: 130, resetAt: null })).toBe(0);
    expect(windowRemaining({ id: "a", label: "A", usedPercent: 60, remainingPercent: 25, resetAt: null })).toBe(25);
    expect(windowRemaining({ id: "a", label: "A", usedPercent: null, resetAt: null })).toBeNull();
    const base = { id: "c", label: "C", enabled: true, healthy: true };
    expect(credentialRemaining(base)).toBeNull();
    expect(lowestRemaining([base])).toBeNull();
    expect(credentialReady(base)).toBe(true);
    expect(credentialReady({ ...base, cooldownUntilUtc: "2030-01-01T00:00:00Z" })).toBe(false);
    expect(fill("{a}-{b}-{c}", { a: 1, b: "x" })).toBe("1-x-{c}");
  });

  it("ships the new default messages", () => {
    for (const key of ["connectionSummary", "lowestRemaining", "showDetails", "hideDetails", "credentialSettings", "saveLabel", "accountLogin", "accountLoginHint", "username", "password", "passwordSaved", "saveLogin", "clearLogin", "usageRemaining"]) {
      expect(defaultMessages).toHaveProperty(key);
    }
  });
});
