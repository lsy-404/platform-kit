import { describe, expect, it } from "vitest";
import { listOpenAICodexModels, parseOpenAICodexModels } from "../../model-auth/packages/providers/src/openai.js";

describe("OpenAI Codex account model catalog", () => {
  it("requests the authenticated catalog with host identity and preserves newly listed IDs", async () => {
    let request: { url: URL; init: RequestInit } | undefined;
    const models = await listOpenAICodexModels({ access: "access-token", accountId: "account-1" }, {
      clientVersion: "2.4.1",
      originator: "ModelAuth Host",
      fetchImpl: async (url, init) => {
        request = { url: new URL(String(url)), init: init ?? {} };
        return new Response(JSON.stringify({ models: [{
          slug: "gpt-6-sol",
          display_name: "GPT-6 Sol",
          description: "Current account catalog entry",
          visibility: "list",
          supported_in_api: false,
          default_reasoning_level: "high",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          context_window: 272_000,
        }] }));
      },
    });

    expect(request?.url.href).toBe("https://chatgpt.com/backend-api/codex/models?client_version=2.4.1");
    const headers = new Headers(request?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("chatgpt-account-id")).toBe("account-1");
    expect(headers.get("originator")).toBe("ModelAuth Host");
    expect(models).toEqual([{
      id: "gpt-6-sol",
      name: "GPT-6 Sol",
      description: "Current account catalog entry",
      reasoning: true,
      reasoningEfforts: ["low", "high"],
      limits: { context: 272_000 },
      defaultReasoningEffort: "high",
    }]);
  });

  it("uses only visible server entries and returns an empty result without fallback models", () => {
    expect(parseOpenAICodexModels({ models: [
      { slug: "visible-model", visibility: "list" },
      { slug: "hidden-model", visibility: "hide" },
      { slug: "unavailable-model", visibility: "none" },
      { slug: "explicitly-hidden", hidden: true },
    ] }).map((model) => model.id)).toEqual(["visible-model"]);
    expect(parseOpenAICodexModels({ models: [] })).toEqual([]);
  });

  it("rejects malformed catalogs and reports HTTP failures without response contents", async () => {
    expect(() => parseOpenAICodexModels({ data: [{ id: "model" }] })).toThrow("response is invalid");
    await expect(listOpenAICodexModels({ access: "access-token" }, {
      clientVersion: "1.0.0",
      originator: "ModelAuth Host",
      fetchImpl: async () => new Response("secret response content", { status: 403 }),
    })).rejects.toThrow("request failed (403)");
    await expect(listOpenAICodexModels({ access: "access-token" }, {
      clientVersion: "1.0.0",
      originator: "ModelAuth Host",
      fetchImpl: async () => new Response("secret response content", { status: 403 }),
    })).rejects.not.toThrow("secret response content");
  });

  it("bounds the default client version lookup by the request timeout", async () => {
    const started = Date.now();
    await expect(listOpenAICodexModels({ access: "access-token" }, {
      timeoutMs: 50,
      fetchImpl: (url, init) => String(url).startsWith("https://registry.npmjs.org/")
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }))
        : init?.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(new Response(JSON.stringify({ models: [] }))),
    })).rejects.toThrow("timed out");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
