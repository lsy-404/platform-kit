import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicTelemetryPrivacyAllowed, createAnthropicTelemetry } from "../../model-auth/packages/providers/src/anthropic-telemetry.js";
import { createAnthropicClientSession } from "../../model-auth/packages/providers/src/anthropic-client-session.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("first-party telemetry policy", () => {
  it("matches the three native privacy variable parsers", () => {
    for (const value of ["0", "false", "yes", " "]) {
      expect(anthropicTelemetryPrivacyAllowed({ DISABLE_TELEMETRY: value })).toBe(false);
      expect(anthropicTelemetryPrivacyAllowed({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: value })).toBe(false);
    }
    for (const value of [" 1 ", "TRUE", "yes", "On"]) expect(anthropicTelemetryPrivacyAllowed({ DO_NOT_TRACK: value })).toBe(false);
    for (const value of ["", "0", "false", "other"]) expect(anthropicTelemetryPrivacyAllowed({ DO_NOT_TRACK: value })).toBe(true);
    const independent = { DO_NOT_TRACK: "", CLAUDE_CODE_ENABLE_TELEMETRY: "0", DISABLE_ERROR_REPORTING: "1" };
    expect(anthropicTelemetryPrivacyAllowed(independent)).toBe(true);
  });

  it("uses process privacy values when no host object is supplied", async () => {
    vi.stubEnv("DISABLE_TELEMETRY", "0");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", fetchImpl });
    expect(sender.record("tengu_api_query")).toBe(false);
    expect(await sender.close()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks record and queued timer until host allows a flush", async () => {
    vi.useFakeTimers();
    const env: { DISABLE_TELEMETRY?: string } = {};
    let eligible = true;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", fetchImpl, privacyEnv: env, eligible: () => eligible });
    expect(sender.record("tengu_api_query")).toBe(true);
    env.DISABLE_TELEMETRY = "false";
    expect(sender.record("tengu_api_query")).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await sender.flush()).toBe(false);
    delete env.DISABLE_TELEMETRY;
    eligible = false;
    expect(await sender.flush()).toBe(false);
    eligible = true;
    expect(await sender.flush()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await sender.close()).toBe(true);
  });

  it("keeps restored data untouched while blocked and resumes after explicit flush", async () => {
    vi.useFakeTimers();
    const env = { DO_NOT_TRACK: "yes" };
    const row = { event_type: "ClaudeCodeInternalEvent" as const, event_data: { session_id: "s", device_id: "d", auth: { account_uuid: "a" } } };
    const storage = { load: vi.fn(async () => [{ attempts: 1, events: [row] }]), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "a" }, privacyEnv: env, storage, fetchImpl });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(storage.load).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    expect(await sender.flush()).toBe(false);
    expect(storage.remove).not.toHaveBeenCalled();
    env.DO_NOT_TRACK = "false";
    expect(await sender.flush()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(storage.remove).toHaveBeenCalledOnce();
    expect(await sender.close()).toBe(true);
  });

  it("does not retry while denied and never reports unsent close as successful", async () => {
    vi.useFakeTimers();
    let allow = true;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", fetchImpl, privacyEnv: {}, eligible: () => allow });
    sender.record("tengu_api_query");
    expect(await sender.flush()).toBe(false);
    allow = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await sender.close()).toBe(false);
    const throws = createAnthropicTelemetry({ enabled: true, sessionId: "s", fetchImpl, privacyEnv: {}, eligible: () => { throw new Error("private"); } });
    expect(throws.record("tengu_api_query")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await throws.close();
  });

  it("persists queued events on blocked close for later recovery", async () => {
    let saved: any[] = [];
    const storage = { load: vi.fn(async () => structuredClone(saved)), save: vi.fn(async (_key: string, batches: any[]) => { saved = structuredClone(batches); }), remove: vi.fn(async () => { saved = []; }) };
    const env = { DO_NOT_TRACK: "" };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const options = { enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "a" }, privacyEnv: env, storage, fetchImpl } as const;
    const sender = createAnthropicTelemetry(options);
    await vi.waitFor(() => expect(storage.load).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(sender.record("tengu_api_query")).toBe(true);
    env.DO_NOT_TRACK = "1";
    expect(await sender.close()).toBe(false);
    expect(saved[0].events).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    env.DO_NOT_TRACK = "";
    const restored = createAnthropicTelemetry(options);
    expect(await restored.flush()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await restored.close()).toBe(true);
  });

  it("waits for blocked persistence before concurrent close returns", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const storage = { load: vi.fn(async () => []), save: vi.fn(async () => { await wait; }), remove: vi.fn(async () => {}) };
    const env = { DO_NOT_TRACK: "" };
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "a" }, privacyEnv: env, storage, fetchImpl: vi.fn() });
    await vi.waitFor(() => expect(storage.load).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(sender.record("tengu_api_query")).toBe(true);
    env.DO_NOT_TRACK = "1";
    const flushing = sender.flush();
    let finished = false;
    const closing = sender.close().then(result => { finished = true; return result; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    expect(await flushing).toBe(false);
    expect(await closing).toBe(false);
  });

  it("uses profile session context for verified core fields", async () => {
    let rows: any[] = [];
    const session = createAnthropicClientSession({ enabled: true, sessionId: "s", parentSessionId: "parent", deviceId: "d", accountUuid: "a", clientVersion: "2.1.316", sdkVersion: "0.3.316", telemetry: { enabled: true, privacyEnv: {}, fetchImpl: async (_url, init) => { rows = JSON.parse(String(init?.body)).events; return new Response(null, { status: 204 }); } } });
    const request = session.request({ fetchImpl: async () => new Response("ok"), agentId: "worker", agentType: "reviewer" });
    await request.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) });
    request.onStreamEvent({ type: "message_stop" });
    expect(await session.close()).toBe(true);
    expect(rows[0].event_data).toMatchObject({ agent_sdk_version: "0.3.316", parent_session_id: "parent", agent_id: "worker", agent_type: "reviewer", env: { version: "2.1.316" } });
  });
});
