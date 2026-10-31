import { describe, expect, it, vi } from "vitest";
import { createAnthropicTelemetry } from "../../model-auth/packages/providers/src/anthropic.js";

const url = "https://api.anthropic.com/v1/messages?beta=true";
const init = (model: string, session = "s", device = "d"): RequestInit => ({ method: "POST", headers: { "x-claude-code-session-id": session }, body: JSON.stringify({ model, messages: [{ role: "user", content: "private" }], metadata: { user_id: JSON.stringify({ session_id: session, device_id: device }) } }) });
const eventsOf = (init?: RequestInit) => JSON.parse(String(init?.body)).events.map((row: { event_data: { additional_metadata: string } }) => ({ ...row.event_data, metadata: JSON.parse(Buffer.from(row.event_data.additional_metadata, "base64").toString()) }));

describe("Anthropic request telemetry", () => {
  it("passes the request and response unchanged and observes concurrent streams independently", async () => {
    const batches: unknown[][] = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", model: "old" }, fetchImpl: async (_url, request) => { batches.push(eventsOf(request)); return new Response(null, { status: 204 }); } });
    const responseA = new Response("stream-a", { headers: { "request-id": "req-a" } });
    const responseB = new Response("stream-b", { headers: { "request-id": "req-b" } });
    const transportA = vi.fn(async () => responseA), transportB = vi.fn(async () => responseB);
    const a = sender.request(transportA), b = sender.request(transportB);
    const inputA = init("model-a"), inputB = init("model-b");
    expect(await a.fetch(url, inputA)).toBe(responseA);
    expect(await b.fetch(url, inputB)).toBe(responseB);
    expect(transportA).toHaveBeenCalledWith(url, inputA);
    a.onStreamEvent({ type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1, cache_creation_input_tokens: 5 } } });
    b.onStreamEvent({ type: "message_start", message: { usage: { input_tokens: 20 } } });
    a.onStreamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } });
    b.onStreamEvent({ type: "message_delta", usage: { output_tokens: 3 } });
    b.onStreamEvent({ type: "message_stop" }); a.onStreamEvent({ type: "message_stop" });
    await sender.close();
    const rows = batches.flat() as Array<{ event_name: string; model: string; metadata: Record<string, unknown> }>;
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_query", "tengu_api_success", "tengu_api_success"]);
    expect(rows[2]).toMatchObject({ model: "model-b", metadata: { model: "model-b", inputTokens: 20, outputTokens: 3, requestId: "req-b" } });
    expect(rows[3]).toMatchObject({ model: "model-a", metadata: { model: "model-a", inputTokens: 12, outputTokens: 8, uncachedInputTokens: 5, stop_reason: "end_turn", requestId: "req-a", ttftMs: expect.any(Number) } });
    expect(JSON.stringify(rows)).not.toContain("private");
  });

  it("observes a real non-streaming message once without inventing first-token timing", async () => {
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    let attempts = 0;
    const observer = sender.request(async () => ++attempts === 1 ? new Response(null, { status: 503 }) : new Response("ok", { headers: { "request-id": "second" } }));
    await observer.fetch(url, init("m")); await observer.fetch(url, init("m"));
    observer.onResponseMessage({ type: "message", role: "assistant", id: "msg", model: "m", content: [], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 1, ephemeral_1h_input_tokens: 3 } } });
    observer.onResponseMessage({ type: "message", role: "assistant", id: "msg", model: "m", content: [], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 7 } });
    observer.onStreamEvent({ type: "message_stop" }); observer.onError();
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_success"]);
    expect(rows[1].metadata).toMatchObject({ attempt: 2, requestId: "second", inputTokens: 12, outputTokens: 7, cachedInputTokens: 3, uncachedInputTokens: 4, cache_creation_5m_input_tokens: 1, cache_creation_1h_input_tokens: 3, stop_reason: "end_turn" });
    expect(rows[1].metadata).not.toHaveProperty("ttftMs");
  });

  it("ignores malformed messages and non-success HTTP responses", async () => {
    let rows: Array<{ event_name: string }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const observer = sender.request(async () => new Response(null, { status: 400 }));
    await observer.fetch(url, init("m"));
    observer.onResponseMessage({ type: "message", role: "assistant", id: "msg", model: "m", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    observer.onError();
    const invalid = sender.request(async () => new Response("ok"));
    await invalid.fetch(url, init("m")); invalid.onResponseMessage({ type: "message", usage: { input_tokens: 1, output_tokens: 1 } }); invalid.onError();
    createAnthropicTelemetry().request(fetch).onResponseMessage({});
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_error", "tengu_api_query", "tengu_api_error"]);
  });

  it("does not report success for incomplete streams, and observes actual failures", async () => {
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const incomplete = sender.request(async () => new Response("incomplete"));
    await incomplete.fetch(url, init("m"));
    const http = sender.request(async () => new Response(null, { status: 429 }));
    await http.fetch(url, init("m")); http.onError();
    const failure = new Error("private error");
    const thrown = sender.request(async () => { throw failure; });
    await expect(thrown.fetch(url, init("m"))).rejects.toBe(failure);
    thrown.onError();
    const stream = sender.request(async () => new Response("stream"));
    await stream.fetch(url, init("m")); stream.onStreamEvent({ type: "error", error: { message: "private error" } }); stream.onError(); stream.onStreamEvent({ type: "message_stop" });
    await sender.close();
    expect(rows.filter(row => row.event_name === "tengu_api_success")).toHaveLength(0);
    expect(rows.filter(row => row.event_name === "tengu_api_error")).toHaveLength(3);
    expect(rows.find(row => row.metadata.status === "429")).toBeDefined();
    expect(rows.filter(row => row.event_name === "tengu_api_error" && row.metadata.status === "200")).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain("private error");
  });

  it("records a single query and success after an HTTP retry", async () => {
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    let attempts = 0;
    const observer = sender.request(async () => ++attempts === 1 ? new Response(null, { status: 503 }) : new Response("stream", { headers: { "request-id": "second" } }));
    await observer.fetch(url, init("m"));
    await observer.fetch(url, init("m"));
    observer.onStreamEvent({ type: "message_stop" }); observer.onError();
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_success"]);
    expect(rows[1]?.metadata).toMatchObject({ attempt: 2, requestId: "second" });
  });

  it("reports a final failure once after retries", async () => {
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const observer = sender.request(async () => new Response(null, { status: 503 }));
    await observer.fetch(url, init("m")); await observer.fetch(url, init("m"));
    observer.onError(); observer.onError(); observer.onStreamEvent({ type: "message_stop" });
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_error"]);
    expect(rows[1]?.metadata).toMatchObject({ attempt: 2, status: "503" });
  });

  it("distinguishes confirmed cancellation from a timeout failure", async () => {
    let rows: Array<{ event_name: string }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const cancel = sender.request(async () => new Response("stream"));
    await cancel.fetch(url, init("m")); cancel.onError({ cancelled: true }); cancel.onError();
    const timeout = sender.request(async () => { throw new Error("timeout"); });
    await expect(timeout.fetch(url, init("m"))).rejects.toThrow("timeout"); timeout.onError();
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_query", "tengu_api_error"]);
  });

  it("does not attribute another account's request to the sender", async () => {
    const telemetry = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d", accountUuid: "account_a" }, fetchImpl: telemetry });
    const request = init("m");
    request.body = JSON.stringify({ model: "m", metadata: { user_id: JSON.stringify({ session_id: "s", device_id: "d", account_uuid: "account_b" }) } });
    const observer = sender.request(async () => new Response("ok"));
    await observer.fetch(url, request); observer.onStreamEvent({ type: "message_stop" }); observer.onError();
    await sender.close();
    expect(telemetry).not.toHaveBeenCalled();
  });

  it("skips mismatched identities and disabled observers without changing transport", async () => {
    const telemetry = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: telemetry });
    const transport = vi.fn(async () => new Response("ok"));
    for (const [target, request] of [[url, init("m", "other", "d")], [url, init("m", "s", "other")], ["https://example.com/v1/messages", init("m")]] as const) {
      const observer = sender.request(transport);
      await observer.fetch(target, request);
      observer.onStreamEvent({ type: "message_stop" });
    }
    await sender.close();
    expect(telemetry).not.toHaveBeenCalled();
    const disabled = createAnthropicTelemetry();
    expect(disabled.request(transport).fetch).toBe(transport);
  });

  it("ignores an unrelated in-flight request without consuming the observer", async () => {
    let release!: (response: Response) => void;
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const observer = sender.request(async target => String(target).endsWith("count_tokens") ? new Promise<Response>(resolve => { release = resolve; }) : new Response("ok", { headers: { "request-id": "right" } }));
    const unrelated = observer.fetch("https://api.anthropic.com/v1/messages/count_tokens", init("m"));
    await observer.fetch(url, init("m"));
    release(new Response(null, { status: 429, headers: { "request-id": "wrong" } }));
    await unrelated;
    observer.onStreamEvent({ type: "message_stop" });
    await sender.close();
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_success"]);
    expect(rows[1]?.metadata.requestId).toBe("right");
  });
});
