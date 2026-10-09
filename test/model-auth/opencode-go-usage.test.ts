import { describe, expect, it } from "vitest";
import { OPENCODE_GO_USAGE_URL, parseOpencodeGoUsage, queryOpencodeGoKeyUsage } from "../../model-auth/packages/providers/src/opencode.js";

// Verbatim 200 body of https://opencode.ai/zen/go/v1/usage, taken from the token-monitor reference tests.
const LIVE_PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-08-13T15:11:49.412Z" },
    weekly: { status: "ok", percent: 57, resetsAt: "2026-08-17T00:00:00.412Z" },
    monthly: { status: "ok", percent: 30, resetsAt: "2026-09-04T11:42:50.412Z" },
  },
};

const ENTITLEMENT_ERROR = {
  type: "error",
  error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
};

describe("OpenCode Go usage parsing", () => {
  it("maps rolling, weekly and monthly onto session, weekly and monthly windows", () => {
    const data = parseOpencodeGoUsage(LIVE_PAYLOAD);
    expect(data.plan).toBe("Go");
    expect(data.balance).toBeNull();
    expect(data.windows).toMatchObject([
      { id: "rolling", kind: "session", usedPercent: 0, remainingPercent: 100, resetAt: Date.parse("2026-08-13T15:11:49.412Z") },
      { id: "weekly", kind: "weekly", usedPercent: 57, remainingPercent: 43, resetAt: Date.parse("2026-08-17T00:00:00.412Z") },
      { id: "monthly", kind: "monthly", usedPercent: 30, remainingPercent: 70, resetAt: Date.parse("2026-09-04T11:42:50.412Z") },
    ]);
    expect(data.windows.map(window => window.windowSeconds)).toEqual([300 * 60, 10080 * 60, 43200 * 60]);
  });

  it("treats a rate-limited window without a percentage as fully used", () => {
    const data = parseOpencodeGoUsage({ usage: {
      rolling: { status: "rate-limited", resetsAt: "2026-08-13T15:11:49.412Z" },
      weekly: { status: "ok", percent: 4, resetsAt: "2026-08-17T00:00:00.412Z" },
    } });
    expect(data.windows[0]).toMatchObject({ id: "rolling", usedPercent: 100, status: "exhausted" });
  });

  it("clamps percentages and keeps an unparseable reset time unknown", () => {
    const data = parseOpencodeGoUsage({ usage: { rolling: { percent: 140, resetsAt: "soon" }, weekly: { percent: -3 } } });
    expect(data.windows).toMatchObject([{ usedPercent: 100, resetAt: null }, { usedPercent: 0, resetAt: null }]);
  });

  it("rejects payloads that do not carry both the session and weekly windows", () => {
    for (const payload of [
      {},
      { usage: {} },
      { usage: { monthly: { status: "ok", percent: 3 } } },
      { usage: { rolling: { status: "ok", percent: 3 } } },
      { usage: { weekly: { status: "ok", percent: 3 }, monthly: { status: "ok", percent: 3 } } },
      { rollingUsage: { usagePercent: 12 } },
      null,
    ]) expect(() => parseOpencodeGoUsage(payload)).toThrow();
  });
});

describe("OpenCode Go usage request", () => {
  it("sends only a bearer token to the official endpoint", async () => {
    const calls: Array<{ url: string; headers: Headers; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined }> = [];
    const snapshot = await queryOpencodeGoKeyUsage("go-key-123", { credentialId: "key-1", fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect, signal: init?.signal });
      return Response.json(LIVE_PAYLOAD);
    } });
    expect(OPENCODE_GO_USAGE_URL).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(OPENCODE_GO_USAGE_URL);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer go-key-123");
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
    expect(calls[0]!.headers.get("cookie")).toBeNull();
    expect(calls[0]!.redirect).toBe("manual");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(snapshot).toMatchObject({ providerId: "opencode-go", credentialId: "key-1", status: "ok", plan: "Go", error: null });
    expect(snapshot.windows).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain("go-key-123");
  });

  it("reports the entitlement error as an account without a Go plan, not as a failure", async () => {
    const snapshot = await queryOpencodeGoKeyUsage("go-key-123", { fetchImpl: async () => Response.json(ENTITLEMENT_ERROR, { status: 403 }) });
    expect(snapshot).toMatchObject({ status: "unknown", errorCode: "no-limits", error: null, windows: [] });
  });

  it("does not read any other 403 as a missing subscription", async () => {
    for (const body of [JSON.stringify({ type: "error" }), JSON.stringify({ error: { type: "AuthError" } }), "{}", "null", "<html>blocked</html>"]) {
      const snapshot = await queryOpencodeGoKeyUsage("go-key-123", { fetchImpl: async () => new Response(body, { status: 403 }) });
      expect(snapshot, body).toMatchObject({ status: "error", errorCode: "server-error", windows: [] });
    }
  });

  it.each([[401, "signed-out"], [429, "rate-limited"], [500, "server-error"], [503, "server-error"], [302, "server-error"]])("classifies HTTP %s without reflecting the response body", async (status, code) => {
    const snapshot = await queryOpencodeGoKeyUsage("private-test-key", { fetchImpl: async () => new Response("private-test-key", { status: status as number }) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: code, windows: [] });
    expect(JSON.stringify(snapshot)).not.toContain("private-test-key");
  });

  it("reports unusable 200 bodies as unreadable and network failures as unreachable", async () => {
    for (const body of ["not json", "{}", JSON.stringify({ usage: { monthly: { percent: 3 } } })]) {
      const snapshot = await queryOpencodeGoKeyUsage("go-key-123", { fetchImpl: async () => new Response(body) });
      expect(snapshot, body).toMatchObject({ status: "error", errorCode: "unreadable" });
    }
    const failed = await queryOpencodeGoKeyUsage("go-key-123", { fetchImpl: async () => { throw new TypeError("network down"); } });
    expect(failed).toMatchObject({ status: "error", errorCode: "unreachable" });
  });

  it("does not send an empty key and rethrows cancellation instead of publishing a status", async () => {
    let calls = 0;
    const controller = new AbortController();
    const fetchImpl = async () => { calls += 1; controller.abort(); return Response.json(LIVE_PAYLOAD); };
    expect((await queryOpencodeGoKeyUsage("  ", { fetchImpl })).errorCode).toBe("signed-out");
    expect(calls).toBe(0);
    await expect(queryOpencodeGoKeyUsage("go-key-123", { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(queryOpencodeGoKeyUsage("go-key-123", { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
    const failing = new AbortController();
    await expect(queryOpencodeGoKeyUsage("go-key-123", { signal: failing.signal, fetchImpl: async () => { failing.abort(new Error("superseded")); throw new Error("superseded"); } })).rejects.toThrow("superseded");
  });
});
