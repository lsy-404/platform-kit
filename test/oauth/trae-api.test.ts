// @vitest-environment node
import { createDecipheriv } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { completeTrae, listTraeModels, streamTrae } from "../../oauth/packages/providers/src/trae-api";
import type { TraeCredential } from "../../oauth/packages/providers/src/trae";

const credential = { access: "test-token", expires: Date.now() + 3_600_000, host: "https://grow-normal.trae.ai", storeCountry: "CA", device: { deviceId: "device-id", machineId: "machine-id", cpu: "cpu label", model: "model label", os: "system", osVersion: "1.0" } } as unknown as TraeCredential;
const message = { role: "user" as const, content: "你好\nhello" };
const options = { model: "server-model", messages: [message] };
const frame = (event: string, data: unknown) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
function sse(content: string, oneByte = false): Response {
  const bytes = new TextEncoder().encode(content);
  return new Response(new ReadableStream({ start(controller) {
    if (oneByte) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
const asFetch = (value: (...args: Parameters<typeof fetch>) => Promise<Response>) => value as typeof fetch;

describe("Trae source-derived model and text transport", () => {
  it("retrieves account model metadata without inventing or filtering names", async () => {
    const models = [{ name: "from-server", display_name: "Server display", prompt_max_tokens: 100, is_enabled: false }];
    const fetchImpl = vi.fn(async () => Response.json({ model_configs: models }));
    expect(await listTraeModels(credential, { fetchImpl })).toEqual(models);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as Parameters<typeof fetch>;
    expect(url).toBe("https://coresg-normal.trae.ai/api/ide/v1/model_list?type=llm_raw_chat");
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Cloud-IDE-JWT test-token", "get-svc": "1", "x-ide-version-code": "20260212", "X-Device-Id": "device-id", "X-Machine-Id": "machine-id", "X-Device-Cpu": "cpu%20label", "X-Device-Brand": "model%20label", "X-App-Id": "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8" } });
  });
  it("retains an empty authenticated model list", async () => {
    expect(await listTraeModels(credential, { fetchImpl: async () => Response.json({ model_configs: [] }) })).toEqual([]);
  });
  it.each([{}, { code: 12000 }, { model_configs: [{}] }, { model_configs: [{ name: "" }] }])("rejects invalid model response %j", async body => {
    await expect(listTraeModels(credential, { fetchImpl: async () => Response.json(body) })).rejects.toMatchObject({ code: "response" });
  });
  it("sends the encrypted official multipart text body with bound timestamp", async () => {
    const fetchImpl = asFetch(async (url, init) => {
      expect(url).toBe("https://coresg-normal.trae.ai/api/ide/v1/llm_raw_chat");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(Object.keys(body).sort()).toEqual(["message", "model_name"]);
      expect(body.model_name).toBe("server-model");
      const headers = new Headers(init?.headers), pin = Buffer.from(headers.get("X-Request-Pin")!, "hex");
      expect(pin.length).toBe(8);
      const bytes = Buffer.from(body.message, "base64"), key = Buffer.from("6195f24ca4d430f8a4833de7db8dac37d148a084e7464a351ffa68585c16b955", "hex");
      for (let i = 0; i < 8; i++) key[i] = key[i]! ^ pin[i]!;
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(headers.get("X-Requested-At")!));
      decipher.setAuthTag(bytes.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
      expect(JSON.parse(plaintext)).toEqual([{ role: "user", content: [{ type: "text", text: message.content }] }]);
      return sse(frame("done", { finish_reason: "stop" }));
    });
    expect(await completeTrae(credential, { ...options, fetchImpl })).toEqual({ text: "", reasoning: "", finishReason: "stop" });
  });
  it("parses byte-fragmented CRLF, UTF8, reasoning, usage and completion", async () => {
    const content = ":heartbeat\r\n\r\n" + frame("metadata", { model: "actual-model" }) + frame("progress_notice", { position: 1 }) + frame("message", { response: "你", reasoning_content: "想" }) + frame("message", { response: "好" }) + frame("token_usage", { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) + frame("done", { finish_reason: "stop" });
    expect(await completeTrae(credential, { ...options, fetchImpl: async () => sse(content, true) })).toEqual({ text: "你好", reasoning: "想", finishReason: "stop", usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } });
  });
  it("keeps trailing usage after the server done event", async () => {
    const content = frame("done", { finish_reason: "stop" }) + frame("token_usage", { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect((await completeTrae(credential, { ...options, fetchImpl: async () => sse(content) })).usage?.totalTokens).toBe(3);
  });
  it("rejects unexpected tool calls rather than silently dropping them", async () => {
    await expect(completeTrae(credential, { ...options, fetchImpl: async () => sse(frame("message", { tool_calls: [] })) })).rejects.toMatchObject({ code: "response" });
  });
  it.each(["US", "AS", "GU", "MP", "PR", "UM", "VI"])("uses authenticated StoreCountry %s for US deployment", async country => {
    await listTraeModels({ ...credential, storeCountry: country } as TraeCredential, { fetchImpl: asFetch(async url => { expect(new URL(String(url)).host).toBe("core-normal.traeapi.us"); return Response.json({ model_configs: [] }); }) });
  });
  it("handles multiline data and CR-only lines", async () => {
    const content = 'event: message\rdata: {\rdata: "response":"hello"}\r\r' + frame("done", { finish_reason: "length" });
    expect((await completeTrae(credential, { ...options, fetchImpl: async () => sse(content) })).text).toBe("hello");
  });
  it.each([401, 403, 429, 500])("propagates HTTP %i without a retry", async status => {
    const fetchImpl = vi.fn(async () => new Response("private body", { status }));
    await expect(completeTrae(credential, { ...options, fetchImpl })).rejects.toMatchObject({ code: [401, 403].includes(status) ? "authentication" : "response" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("propagates stream errors without returning partial success or echoing content", async () => {
    const fetchImpl = async () => sse(frame("message", { response: "partial" }) + frame("error", { code: 12002, message: "private server text" }));
    await expect(completeTrae(credential, { ...options, fetchImpl })).rejects.toMatchObject({ code: "response", message: "Trae service reported an error (12002)." });
  });
  it.each([frame("message", { response: "partial" }), 'event: message\ndata: {"response":"partial"}', 'event: message\ndata: not-json\n\n'])("rejects incomplete or malformed stream", async content => {
    await expect(completeTrae(credential, { ...options, fetchImpl: async () => sse(content) })).rejects.toThrow();
  });
  it("cancels a waiting reader when aborted", async () => {
    const controller = new AbortController(), cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const result = completeTrae(credential, { ...options, signal: controller.signal, fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("cancels upstream when the stream consumer stops", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(frame("message", { response: "first" }))); }, cancel });
    for await (const event of streamTrae(credential, { ...options, fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) })) { expect(event.type).toBe("text"); break; }
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("fails before transmission for expired credential, unsupported tools, or ambiguous region", async () => {
    const fetchImpl = vi.fn();
    await expect(listTraeModels({ ...credential, expires: 0 }, { fetchImpl })).rejects.toMatchObject({ code: "authentication" });
    await expect(listTraeModels({ ...credential, storeCountry: undefined } as TraeCredential, { fetchImpl })).rejects.toMatchObject({ code: "response" });
    await expect(completeTrae(credential, { ...options, fetchImpl, tools: [] } as typeof options & { fetchImpl: typeof fetch; tools: unknown[] })).rejects.toMatchObject({ code: "response" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([["SG", "coresg-normal.trae.ai"], ["US", "coreva-normal.trae.ai"], ["USTTP", "core-normal.traeapi.us"]] as const)("routes explicitly selected %s region", async (region, host) => {
    await listTraeModels(credential, { region, fetchImpl: asFetch(async url => { expect(new URL(String(url)).host).toBe(host); return Response.json({ model_configs: [] }); }) });
  });
});
