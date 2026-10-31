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
    expect(sender.record("tengu_plugin_survey_answered")).toBe(false);
    const closing = sender.close();
    expect(sender.record("tengu_plugin_survey_answered")).toBe(false);
    finish();
    expect(await closing).toBe(true);
    expect(sizes).toEqual([100, 100]);
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
    expect(await sender.close()).toBe(false);
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
    await Promise.resolve();
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
});
