import { describe, expect, it } from "vitest";
import { parseModelsDevPayload, providerBinding } from "../../model-auth/packages/core/src/index.js";
import { OLLAMA_LOCAL_ENDPOINTS, discoverAndMergeLocalOllamaModels, discoverLocalOllamaModels } from "../../model-auth/packages/providers/src/ollama.js";

const catalog = () => parseModelsDevPayload({ providers: {
  ollama: {
    name: "Ollama Catalog",
    models: {
      "llama3.2:latest": { name: "Catalog llama", tool_call: true, modalities: { output: ["text"] } },
    },
  },
  other: {
    models: {
      "other-model": { tool_call: true, modalities: { output: ["text"] } },
    },
  },
} });

describe("local Ollama discovery", () => {
  it("is enabled by default and appends installed models without replacing catalog metadata", async () => {
    const requested: string[] = [];
    const result = await discoverAndMergeLocalOllamaModels(catalog(), {
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(JSON.stringify({ models: [
          { name: "llama3.2:latest" },
          { name: "qwen3-coder:30b" },
          { name: "qwen3-coder:30b" },
        ] }));
      },
    });

    expect(requested).toEqual([OLLAMA_LOCAL_ENDPOINTS.tags]);
    expect(result).toMatchObject({ enabled: true, status: "available" });
    expect(result.models.map((model) => model.id)).toEqual(["llama3.2:latest", "qwen3-coder:30b"]);
    expect(providerBinding(result.catalog, "ollama")?.name).toBe("Ollama Catalog");
    expect(providerBinding(result.catalog, "ollama")?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "llama3.2:latest", name: "Catalog llama" }),
      expect.objectContaining({ id: "qwen3-coder:30b", name: "qwen3-coder:30b" }),
    ]));
  });

  it("does not contact Ollama when discovery is explicitly disabled", async () => {
    let calls = 0;
    const input = catalog();
    const result = await discoverAndMergeLocalOllamaModels(input, {
      enabled: false,
      fetchImpl: async () => { calls += 1; return new Response(); },
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ enabled: false, status: "disabled", models: [] });
    expect(result.catalog).toEqual(input);
  });

  it("creates an Ollama provider when the source catalog has no Ollama entry", async () => {
    const input = parseModelsDevPayload({ providers: {
      other: { models: { "other-model": { tool_call: true, modalities: { output: ["text"] } } } },
    } });
    const result = await discoverAndMergeLocalOllamaModels(input, {
      fetchImpl: async () => new Response(JSON.stringify({ models: [{ name: "gemma3:latest" }] })),
    });

    expect(providerBinding(result.catalog, "ollama")).toMatchObject({
      name: "Ollama",
      api: OLLAMA_LOCAL_ENDPOINTS.apiBase,
      models: [{ id: "gemma3:latest", name: "gemma3:latest" }],
    });
  });

  it("keeps existing models when the local service is unavailable or returns an invalid payload", async () => {
    const input = catalog();
    await expect(discoverAndMergeLocalOllamaModels(input, {
      fetchImpl: async () => { throw new TypeError("connection refused"); },
    })).resolves.toMatchObject({ status: "unavailable", catalog: input });
    await expect(discoverLocalOllamaModels({
      fetchImpl: async () => new Response(JSON.stringify({ models: [{ name: "not allowed?" }] })),
    })).resolves.toMatchObject({ status: "invalid-response", models: [] });
  });
});
