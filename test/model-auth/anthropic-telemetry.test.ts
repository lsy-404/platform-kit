import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicTelemetry } from "../../model-auth/packages/providers/src/anthropic.js";

afterEach(() => { vi.useRealTimers(); });

describe("Anthropic telemetry", () => {
  it("is inert without explicit opt-in", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sender = createAnthropicTelemetry();
    expect(sender.record("tengu_request", { input_tokens: 1 })).toBe(false);
    expect(await sender.flush()).toBe(true);
    expect(await sender.close()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("uses the fixed official endpoint and only the permitted event fields", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const context = { deviceId: "device_a", accountUuid: "account_a", model: "model_a", environment: { platform: "linux", isClaudeAiAuth: true } };
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "session_a", context, fetchImpl: async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) }); return new Response(null, { status: 204 });
    } });
    context.accountUuid = "account_b";
    context.environment.platform = "other";
    expect(sender.record("tengu_plugin_survey_answered", { input_tokens: 3, duration_ms: 24, success: true })).toBe(true);
    expect(await sender.flush()).toBe(true);
    expect(String(calls[0]?.input)).toBe("https://api.anthropic.com/api/event_logging/v2/batch");
    expect(calls[0]?.init?.redirect).toBe("error");
    const data = JSON.parse(String(calls[0]?.init?.body)).events[0];
    expect(data.event_type).toBe("ClaudeCodeInternalEvent");
    expect(data.event_data).toMatchObject({ event_name: "tengu_plugin_survey_answered", session_id: "session_a" });
    expect(data.event_data).toMatchObject({ device_id: "device_a", auth: { account_uuid: "account_a" }, model: "model_a", env: { platform: "linux", is_claude_ai_auth: true } });
    expect(JSON.parse(Buffer.from(data.event_data.additional_metadata, "base64").toString())).toEqual({ input_tokens: 3, duration_ms: 24, success: true });
    expect(await sender.close()).toBe(true);
  });

  it("reports failed responses and isolates credentials and sessions", async () => {
    const a = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { expect(JSON.parse(String(init?.body)).events[0].event_data.session_id).toBe("a"); return new Response(null, { status: 503 }); });
    const b = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { expect(JSON.parse(String(init?.body)).events[0].event_data.session_id).toBe("b"); return new Response(null, { status: 204 }); });
    const first = createAnthropicTelemetry({ enabled: true, sessionId: "a", fetchImpl: a });
    const second = createAnthropicTelemetry({ enabled: true, sessionId: "b", fetchImpl: b });
    first.record("tengu_plugin_survey_answered"); second.record("tengu_plugin_survey_answered");
    expect(await first.flush()).toBe(false);
    expect(await second.flush()).toBe(true);
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce();
    await first.close(); await second.close();
  });

  it("bounds a batch and stops accepting events while closing", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const sizes: number[] = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "batch", fetchImpl: async (_input, init) => {
      sizes.push(JSON.parse(String(init?.body)).events.length); await waiting; return new Response(null, { status: 204 });
    } });
    for (let i = 0; i < 200; i++) expect(sender.record("tengu_plugin_survey_answered")).toBe(true);
    expect(sender.record("tengu_plugin_survey_answered")).toBe(true);
    const closing = sender.close();
    expect(sender.record("tengu_plugin_survey_answered")).toBe(false);
    finish();
    expect(await closing).toBe(true);
    expect(sizes).toEqual([200, 1]);
  });

  it("cancels scheduled work and isolates fetch errors", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "abort", fetchImpl, signal: controller.signal });
    sender.record("tengu_plugin_survey_answered");
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(await sender.close()).toBe(false);
    const other = createAnthropicTelemetry({ enabled: true, sessionId: "error", fetchImpl });
    other.record("tengu_plugin_survey_answered");
    expect(await other.flush()).toBe(false);
    expect(await other.close()).toBe(false);
  });

  it("times out a stalled transport and clears its timer", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "timeout", fetchImpl: async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    } });
    sender.record("tengu_plugin_survey_answered");
    const result = sender.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(false);
    expect(requestSignal?.aborted).toBe(true);
    const closing = sender.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await closing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start transport if cancelled before its microtask", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "cancel", fetchImpl, signal: controller.signal });
    sender.record("tengu_plugin_survey_answered");
    const result = sender.flush();
    controller.abort();
    expect(await result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await sender.close()).toBe(false);
  });

  it("waits for both batches on concurrent flush and close", async () => {
    const completions: Array<(response: Response) => void> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "concurrent", fetchImpl: async () => new Promise<Response>(resolve => completions.push(resolve)) });
    sender.record("tengu_plugin_survey_answered");
    const first = sender.flush();
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    sender.record("tengu_plugin_survey_answered");
    let finished = 0;
    const flushing = sender.flush().then(value => { finished++; return value; });
    const closeOne = sender.close().then(value => { finished++; return value; });
    const closeTwo = sender.close().then(value => { finished++; return value; });
    completions[0]!(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    expect(finished).toBe(0);
    completions[1]!(new Response(null, { status: 503 }));
    expect(await first).toBe(true);
    expect(await Promise.all([flushing, closeOne, closeTwo])).toEqual([false, false, false]);
  });
  it("schedules after ten seconds and preserves a failed batch for its session", async () => {
    vi.useFakeTimers();
    const memory = new Map<string, any>();
    const storage = { load: vi.fn(async (key: string) => memory.get(key) ?? []), save: vi.fn(async (key: string, batches: any) => { memory.set(key, structuredClone(batches)); }), remove: vi.fn(async (key: string) => { memory.delete(key); }) };
    const context = { deviceId: "d", accountUuid: "a" };
    const bad = vi.fn(async () => new Response(null, { status: 503 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context, storage, fetchImpl: bad });
    await vi.advanceTimersByTimeAsync(0);
    sender.record("tengu_api_query");
    await vi.advanceTimersByTimeAsync(9999); expect(bad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(bad).toHaveBeenCalledTimes(1);
    const saved = [...memory.values()][0];
    expect(saved[0].attempts).toBe(1);
    const id = saved[0].events[0].event_data.event_id;
    const good = vi.fn(async () => new Response(null, { status: 204 }));
    const restored = createAnthropicTelemetry({ enabled: true, sessionId: "s", context, storage, fetchImpl: good });
    await vi.advanceTimersByTimeAsync(0);
    expect(await restored.flush()).toBe(true);
    expect(JSON.parse(String(good.mock.calls[0]?.[1]?.body)).events[0].event_data.event_id).toBe(id);
    expect(memory.size).toBe(0);
    await restored.close();
    await sender.close();
  });

  it("retries failures with increasing quadratic delays", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "retry", fetchImpl });
    sender.record("tengu_api_query");
    expect(await sender.flush()).toBe(false);
    await vi.advanceTimersByTimeAsync(499); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(fetchImpl).toHaveBeenCalledTimes(3);
    await sender.close();
  });

  it("bounds pending events at 8192", async () => {
    const controller = new AbortController();
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "bound", signal: controller.signal, fetchImpl: async () => new Promise<Response>(() => {}) });
    for (let i = 0; i < 8192; i++) expect(sender.record("tengu_api_query")).toBe(true);
    expect(sender.record("tengu_api_query")).toBe(false);
    controller.abort();
    expect(await sender.close()).toBe(false);
  });

  it("drops the batch after eight failed attempts", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "limit", fetchImpl });
    sender.record("tengu_api_query");
    expect(await sender.flush()).toBe(false);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(await sender.close()).toBe(false);
  });

  it("paces separate batches and rejects mismatched restored identities", async () => {
    vi.useFakeTimers();
    const calls = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "pace", fetchImpl: calls });
    for (let i = 0; i < 201; i++) sender.record("tengu_api_query");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99); expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(calls).toHaveBeenCalledTimes(2);
    expect(await sender.close()).toBe(true);
    const save = vi.fn(async () => {});
    const storage = { load: async () => [{ attempts: 1, events: [{ event_type: "ClaudeCodeInternalEvent" as const, event_data: { session_id: "other" } }] }], save, remove: vi.fn(async () => {}) };
    const isolated = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "a" }, storage, fetchImpl: calls });
    isolated.record("tengu_api_query");
    expect(await isolated.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(await isolated.close()).toBe(false);
  });

  it("waits for the second successful batch for every concurrent waiter", async () => {
    const releases: Array<(response: Response) => void> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "two", fetchImpl: async () => new Promise<Response>(resolve => releases.push(resolve)) });
    sender.record("tengu_api_query");
    const first = sender.flush();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    sender.record("tengu_api_query");
    let done = 0;
    const a = sender.flush().then(value => { done++; return value; });
    const b = sender.close().then(value => { done++; return value; });
    releases[0]!(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(done).toBe(0);
    releases[1]!(new Response(null, { status: 204 }));
    await first;
    expect(await Promise.all([a, b])).toEqual([true, true]);
  });

  it("does not let new events accelerate a retry", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "paced-retry", fetchImpl });
    sender.record("tengu_api_query");
    expect(await sender.flush()).toBe(false);
    for (let i = 0; i < 200; i++) sender.record("tengu_api_query");
    await vi.advanceTimersByTimeAsync(499); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await sender.close();
  });

  it("does not accept events before recovery or schedule after pre-abort", async () => {
    let finish!: (batches: any[]) => void;
    const storage = { load: () => new Promise<any[]>(resolve => { finish = resolve; }), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const controller = new AbortController(); controller.abort();
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { accountUuid: "a", deviceId: "d" }, storage, signal: controller.signal, fetchImpl });
    expect(sender.record("tengu_api_query")).toBe(false);
    finish([]); await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(await sender.close()).toBe(true);
  });

  it("refuses an oversized restored queue without overwriting it", async () => {
    const row = { event_type: "ClaudeCodeInternalEvent" as const, event_data: { session_id: "s", device_id: "d", auth: { account_uuid: "a" } } };
    const storage = { load: async () => Array.from({ length: 41 }, () => ({ attempts: 1, events: Array(200).fill(row) })), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "a" }, storage, fetchImpl: vi.fn() });
    expect(sender.record("tengu_api_query")).toBe(false);
    expect(await sender.flush()).toBe(false);
    expect(storage.save).not.toHaveBeenCalled();
    expect(await sender.close()).toBe(false);
  });

  it("restores against the organization captured when the sender was created", async () => {
    let resolveLoad!: (value: any[]) => void;
    const storage = { load: () => new Promise<any[]>(resolve => { resolveLoad = resolve; }), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const context = { deviceId: "d", accountUuid: "a", organizationUuid: "org_a" };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context, storage, privacyEnv: {}, fetchImpl });
    context.organizationUuid = "org_b";
    resolveLoad([{ attempts: 1, events: [{ event_type: "ClaudeCodeInternalEvent", event_data: { event_id: "old", session_id: "s", device_id: "d", auth: { account_uuid: "a", organization_uuid: "org_a" } } }] }]);
    expect(await sender.flush()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await sender.close()).toBe(true);
  });

});
