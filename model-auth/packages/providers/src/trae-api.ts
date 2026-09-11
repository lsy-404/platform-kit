import { createCipheriv, randomBytes } from "node:crypto";
import { TraeProviderError, type TraeCredential } from "./trae.js";

export type TraeInferenceRegion = "normal" | "SG" | "US" | "USTTP";
export interface TraeApiOptions { readonly region?: TraeInferenceRegion; readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; }
export interface TraeModel { readonly name: string; readonly display_name?: string; readonly prompt_max_tokens?: number; readonly [key: string]: unknown; }
export interface TraeTextMessage { readonly role: "system" | "user" | "assistant"; readonly content: string; }
export interface TraeCompletionOptions extends TraeApiOptions { readonly model: string; readonly messages: readonly TraeTextMessage[]; }
export interface TraeUsage { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number; }
export type TraeStreamEvent =
  | { readonly type: "text" | "reasoning"; readonly text: string }
  | { readonly type: "usage"; readonly usage: TraeUsage }
  | { readonly type: "done"; readonly finishReason: string }
  | { readonly type: "metadata" | "progress"; readonly data: Readonly<Record<string, unknown>> };
export interface TraeCompletion { readonly text: string; readonly reasoning: string; readonly finishReason: string; readonly usage?: TraeUsage; }
const HOSTS: Record<TraeInferenceRegion, string> = {
  normal: "https://core-normal.trae.ai", SG: "https://coresg-normal.trae.ai",
  US: "https://coreva-normal.trae.ai", USTTP: "https://core-normal.traeapi.us",
};
const APP_ID = "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8";
const WIRE_KEY = "6195f24ca4d430f8a4833de7db8dac37d148a084e7464a351ffa68585c16b955";

export async function listTraeModels(credential: TraeCredential, options: TraeApiOptions = {}): Promise<readonly TraeModel[]> {
  const response = await request(credential, "/api/ide/v1/model_list?type=llm_raw_chat", options);
  const body = await json(response);
  if (body.code !== undefined && body.code !== 0) throw new TraeProviderError("response", errorMessage(body));
  if (!Array.isArray(body.model_configs) || body.model_configs.some(value => !record(value) || typeof value.name !== "string" || !value.name.trim())) throw new TraeProviderError("response", "Trae returned an invalid model list.");
  return body.model_configs as TraeModel[];
}

export async function* streamTrae(credential: TraeCredential, options: TraeCompletionOptions): AsyncGenerator<TraeStreamEvent> {
  if ("tools" in options) throw new TraeProviderError("response", "This Trae text endpoint does not expose a verified tool definition contract.");
  if (typeof options.model !== "string" || !options.model.trim() || !Array.isArray(options.messages) || !options.messages.length) throw new TraeProviderError("response", "Trae requires a model and at least one message.");
  for (const message of options.messages) {
    if (!record(message) || typeof message.role !== "string" || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || "tool_calls" in message || "tool_call_id" in message) throw new TraeProviderError("response", "Trae text messages require a supported role and string content.");
  }
  const pin = randomBytes(8), iv = randomBytes(12), key = Buffer.from(WIRE_KEY, "hex"), timestamp = String(Math.floor(Date.now() / 1000));
  for (let i = 0; i < pin.length; i++) key[i] = key[i]! ^ pin[i]!;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(timestamp));
  const messages = options.messages.map(({ role, content }) => ({ role, content: [{ type: "text", text: content }] }));
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(messages), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const response = await request(credential, "/api/ide/v1/llm_raw_chat", options, {
    headers: { "X-Request-Pin": pin.toString("hex"), "X-Requested-At": timestamp },
    body: JSON.stringify({ model_name: options.model, message: encrypted }),
  });
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    const body = await json(response);
    throw new TraeProviderError("response", body.code ? errorMessage(body) : "Trae returned a non-streaming response.");
  }
  if (!response.body) throw new TraeProviderError("response", "Trae returned an empty stream.");
  let finishReason: string | undefined;
  for await (const event of readEvents(response.body, options.signal)) {
    const data = parseJson(event.data);
    if (data.tool_calls !== undefined || data.function_call !== undefined || data.finish_reason === "tool_calls") throw new TraeProviderError("response", "Trae returned a tool call unsupported by this text endpoint adapter.");
    if (event.name === "error") throw new TraeProviderError("response", errorMessage(data));
    if (event.name === "token_usage") {
      const values = [data.prompt_tokens, data.completion_tokens, data.total_tokens];
      if (values.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new TraeProviderError("response", "Trae returned invalid token usage.");
      yield { type: "usage", usage: { promptTokens: values[0] as number, completionTokens: values[1] as number, totalTokens: values[2] as number } };
    } else if (event.name === "metadata" || event.name === "progress_notice") {
      yield { type: event.name === "metadata" ? "metadata" : "progress", data };
    }
    for (const [field, type] of [["response", "text"], ["reasoning_content", "reasoning"]] as const) {
      if (data[field] !== undefined) {
        if (typeof data[field] !== "string") throw new TraeProviderError("response", "Trae returned an invalid text delta.");
        if (data[field]) yield { type, text: data[field] };
      }
    }
    if (event.name === "done") {
      if (typeof data.finish_reason !== "string") throw new TraeProviderError("response", "Trae returned an invalid completion marker.");
      finishReason = data.finish_reason;
    }
  }
  if (finishReason === undefined) throw new TraeProviderError("transport", "Trae stream ended before its completion marker.");
  yield { type: "done", finishReason };
}

export async function completeTrae(credential: TraeCredential, options: TraeCompletionOptions): Promise<TraeCompletion> {
  let text = "", reasoning = "", finishReason = "";
  let usage: TraeUsage | undefined;
  for await (const event of streamTrae(credential, options)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "reasoning") reasoning += event.text;
    else if (event.type === "usage") usage = event.usage;
    else if (event.type === "done") finishReason = event.finishReason;
  }
  return { text, reasoning, finishReason, ...(usage ? { usage } : {}) };
}

async function request(credential: TraeCredential, path: string, options: TraeApiOptions, payload?: { body: string; headers: Record<string, string> }): Promise<Response> {
  aborted(options.signal);
  if (!credential || typeof credential.access !== "string" || !credential.access || !Number.isFinite(credential.expires) || credential.expires <= Date.now()) throw new TraeProviderError("authentication", "Trae credential is missing or expired.");
  const country = (credential as TraeCredential & { storeCountry?: string }).storeCountry;
  const region = options.region ?? (typeof country === "string" && /^[A-Z]{2}$/.test(country) ? (["AS", "GU", "MP", "PR", "UM", "US", "VI"].includes(country) ? "USTTP" : "SG") : undefined);
  if (!region || !Object.hasOwn(HOSTS, region)) throw new TraeProviderError("response", "Trae inference requires the account's deployment region.");
  const device = credential.device;
  if (!device || !device.deviceId || !device.machineId) throw new TraeProviderError("authentication", "Trae device binding is missing.");
  const deviceHeaders: Record<string, string> = {};
  for (const [header, value] of Object.entries({ "X-Device-Id": device.deviceId, "X-Machine-Id": device.machineId, "X-Device-Cpu": device.cpu, "X-Device-Brand": device.model, "X-Device-Type": device.os, "X-Os-Version": device.osVersion })) {
    if (value) deviceHeaders[header] = encodeURIComponent(value);
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(HOSTS[region as TraeInferenceRegion] + path, {
      method: payload ? "POST" : "GET", redirect: "error", ...(options.signal ? { signal: options.signal } : {}),
      headers: { "Content-Type": "application/json", "X-App-Id": APP_ID, Authorization: `Cloud-IDE-JWT ${credential.access}`, "get-svc": "1", "x-ide-version-code": "20260212", ...deviceHeaders, ...payload?.headers },
      ...(payload ? { body: payload.body } : {}),
    });
  } catch {
    aborted(options.signal);
    throw new TraeProviderError("transport", "Trae service request failed.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TraeProviderError(response.status === 401 || response.status === 403 ? "authentication" : "response", `Trae service rejected the request (HTTP ${response.status}).`);
  }
  return response;
}

async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ name: string; data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", name = "", data: string[] = [], skipLf = false;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      aborted(signal);
      const part = await reader.read();
      aborted(signal);
      buffer += decoder.decode(part.value, { stream: !part.done });
      if (skipLf && buffer.length) { if (buffer[0] === "\n") buffer = buffer.slice(1); skipLf = false; }
      let match: RegExpExecArray | null;
      while ((match = /[\r\n]/.exec(buffer))) {
        const line = buffer.slice(0, match.index), ending = buffer[match.index];
        buffer = buffer.slice(match.index + 1);
        if (ending === "\r") { if (buffer.startsWith("\n")) buffer = buffer.slice(1); else if (!buffer.length) skipLf = true; }
        if (!line) {
          if (data.length) yield { name, data: data.join("\n") };
          name = ""; data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":"), field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") name = value;
          if (field === "data") data.push(value);
        }
      }
      if (part.done) {
        if (buffer.length || data.length) throw new TraeProviderError("transport", "Trae stream ended inside an event.");
        return;
      }
    }
  } catch (error) {
    aborted(signal);
    if (error instanceof TraeProviderError) throw error;
    throw new TraeProviderError("transport", "Trae stream was interrupted.");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new TraeProviderError("aborted", "Trae request was cancelled."); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function parseJson(value: string): Record<string, unknown> { try { const parsed: unknown = JSON.parse(value); if (record(parsed)) return parsed; } catch {} throw new TraeProviderError("response", "Trae returned invalid JSON."); }
async function json(response: Response): Promise<Record<string, unknown>> { return parseJson(await response.text()); }
function errorMessage(body: Record<string, unknown>): string { return `Trae service reported an error${typeof body.code === "string" || typeof body.code === "number" ? ` (${body.code})` : ""}.`; }
