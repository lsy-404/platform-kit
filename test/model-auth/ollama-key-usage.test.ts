import { describe, expect, it } from "vitest";
import { OLLAMA_USAGE_URL, parseOllamaKeyUsage, queryOllamaKeyUsage } from "../../model-auth/packages/providers/src/ollama.js";

describe("Ollama API key usage", () => {
  it("queries the fixed first-party endpoint with only the API key", async () => {
    const snapshot = await queryOllamaKeyUsage("test-key", { credentialId: "key-1", fetchImpl: async (url, init) => {
      expect(url).toBe(OLLAMA_USAGE_URL);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ limits: { session: { usage: 0.25 }, weekly: { usage: 0.8 } }, activity: { cost: "12" } });
    } });
    expect(snapshot).toMatchObject({ providerId: "ollama-cloud", credentialId: "key-1", status: "ok", plan: null, balance: null });
    expect(snapshot.windows).toMatchObject([{ id: "session", kind: "session", usedPercent: 25, remainingPercent: 75, resetAt: null }, { id: "weekly", kind: "weekly", usedPercent: 80, remainingPercent: 20 }]);
    expect(JSON.stringify(snapshot)).not.toContain("test-key");
    expect(snapshot.windows.every(w => w.scope === "account" && w.modelFamilies.length === 0)).toBe(true);
  });

  it("shows only reported windows and does not invent a reset date or period length", () => {
    const data = parseOllamaKeyUsage({ limits: { monthly: { usage: 0 }, session: {}, weekly: { usage: "0.4" } } });
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0]).toMatchObject({ id: "monthly", kind: "monthly", usedPercent: 0, remainingPercent: 100, resetAt: null });
    expect(data.windows[0]).not.toHaveProperty("windowSeconds");
    expect(parseOllamaKeyUsage({ limits: {} }).windows).toEqual([]);
  });

  it("rejects missing shapes and ignores invalid ratios without reporting fake quota", () => {
    for (const value of [null, [], {}, { limits: [] }]) expect(() => parseOllamaKeyUsage(value)).toThrow();
    expect(parseOllamaKeyUsage({ limits: { session: { usage: -1 }, weekly: { usage: Infinity }, monthly: { usage: 1.2 } } }).windows).toMatchObject([{ id: "monthly", usedPercent: 100, remainingPercent: 0, status: "exhausted" }]);
  });

  it.each([[401, "signed-out"], [403, "signed-out"], [404, "server-error"], [429, "rate-limited"], [503, "server-error"]])("classifies HTTP %s without reflecting a response body", async (status, code) => {
    const snapshot = await queryOllamaKeyUsage("private-test-key", { fetchImpl: async () => new Response("private-test-key", { status: status as number }) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: code, windows: [] });
    expect(JSON.stringify(snapshot)).not.toContain("private-test-key");
  });

  it("refuses redirects and unreadable responses", async () => {
    const redirect = await queryOllamaKeyUsage("test-key", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.test" } }) });
    expect(redirect.status).toBe("error");
    const invalid = await queryOllamaKeyUsage("test-key", { fetchImpl: async () => new Response("<html>signin</html>") });
    expect(invalid.errorCode).toBe("unreadable");
    const missing = await queryOllamaKeyUsage("test-key", { fetchImpl: async () => Response.json({}) });
    expect(missing.errorCode).toBe("unreadable");
  });

  it("does not send an empty key and propagates cancellation before and after a response", async () => {
    const controller = new AbortController(); let calls = 0;
    const fetchImpl = async () => { calls++; controller.abort(); return Response.json({ limits: { monthly: { usage: 0.5 } } }); };
    expect((await queryOllamaKeyUsage("", { fetchImpl })).status).toBe("error");
    expect(calls).toBe(0);
    await expect(queryOllamaKeyUsage("test-key", { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(queryOllamaKeyUsage("test-key", { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
