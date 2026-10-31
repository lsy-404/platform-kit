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
    a.onStreamEvent({ type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } });
    b.onStreamEvent({ type: "message_start", message: { usage: { input_tokens: 20 } } });
    a.onStreamEvent({ type: "message_delta", usage: { output_tokens: 8 } });
    b.onStreamEvent({ type: "message_delta", usage: { output_tokens: 3 } });
    b.onStreamEvent({ type: "message_stop" }); a.onStreamEvent({ type: "message_stop" });
    await sender.close();
    const rows = batches.flat() as Array<{ event_name: string; model: string; metadata: Record<string, unknown> }>;
    expect(rows.map(row => row.event_name)).toEqual(["tengu_api_query", "tengu_api_query", "tengu_api_success", "tengu_api_success"]);
    expect(rows[2]).toMatchObject({ model: "model-b", metadata: { model: "model-b", inputTokens: 20, outputTokens: 3, requestId: "req-b" } });
    expect(rows[3]).toMatchObject({ model: "model-a", metadata: { model: "model-a", inputTokens: 12, outputTokens: 8, requestId: "req-a" } });
    expect(JSON.stringify(rows)).not.toContain("private");
  });

  it("does not report success for incomplete streams, and observes actual failures", async () => {
    let rows: Array<{ event_name: string; metadata: Record<string, unknown> }> = [];
    const sender = createAnthropicTelemetry({ enabled: true, sessionId: "s", context: { deviceId: "d" }, fetchImpl: async (_url, request) => { rows = eventsOf(request); return new Response(null, { status: 204 }); } });
    const incomplete = sender.request(async () => new Response("incomplete"));
    await incomplete.fetch(url, init("m"));
    const http = sender.request(async () => new Response(null, { status: 429 }));
    await http.fetch(url, init("m"));
    const failure = new Error("private error");
    const thrown = sender.request(async () => { throw failure; });
    await expect(thrown.fetch(url, init("m"))).rejects.toBe(failure);
    const stream = sender.request(async () => new Response("stream"));
    await stream.fetch(url, init("m")); stream.onStreamEvent({ type: "error", error: { message: "private error" } }); stream.onStreamEvent({ type: "message_stop" });
    await sender.close();
    expect(rows.filter(row => row.event_name === "tengu_api_success")).toHaveLength(0);
    expect(rows.filter(row => row.event_name === "tengu_api_error")).toHaveLength(3);
    expect(rows.find(row => row.metadata.status === "429")).toBeDefined();
    expect(JSON.stringify(rows)).not.toContain("private error");
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
