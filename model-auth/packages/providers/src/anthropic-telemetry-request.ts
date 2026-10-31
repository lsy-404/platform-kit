import type { AnthropicTelemetryMetadata } from "./anthropic-telemetry.js";

export interface AnthropicTelemetryRequest {
  readonly fetch: typeof fetch;
  onStreamEvent(event: unknown): void;
}

type Emit = (name: string, metadata: AnthropicTelemetryMetadata, model: string) => void;
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function observeAnthropicRequest(transport: typeof fetch, sessionId?: string, deviceId?: string, emit?: Emit): AnthropicTelemetryRequest {
  if (!emit || !sessionId || !deviceId) return { fetch: transport, onStreamEvent() {} };
  let used = false, active = false, finished = false, started = 0;
  let model = "", requestId: string | undefined;
  const usage: Record<string, number> = {};
  const send = (name: string, metadata: AnthropicTelemetryMetadata) => { try { emit(name, { model, ...metadata }, model); } catch { /* Observation cannot affect inference. */ } };
  const duration = () => Math.max(0, Math.round(performance.now() - started));
  const fail = (extra: AnthropicTelemetryMetadata = {}) => {
    if (!active || finished) return;
    finished = true;
    send("tengu_api_error", { durationMs: duration(), ...extra, ...(requestId ? { requestId } : {}) });
  };
  return {
    fetch: async (input, init) => {
      if (used) return transport(input, init);
      let observed = false;
      try {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const body = typeof init?.body === "string" ? object(JSON.parse(init.body)) : undefined;
        const metadata = object(body?.metadata);
        const identity = typeof metadata?.user_id === "string" ? object(JSON.parse(metadata.user_id)) : undefined;
        if (url.origin === "https://api.anthropic.com" && url.pathname === "/v1/messages" && method === "POST"
          && headers.get("x-claude-code-session-id") === sessionId && identity?.session_id === sessionId && identity.device_id === deviceId
          && typeof body?.model === "string" && body.model.length > 0 && body.model.length <= 256) {
          used = true;
          model = body.model;
          started = performance.now(); active = true; observed = true;
          send("tengu_api_query", { ...(Array.isArray(body.messages) ? { messagesLength: body.messages.length } : {}),
            ...(typeof body.temperature === "number" && Number.isFinite(body.temperature) ? { temperature: body.temperature } : {}) });
        }
      } catch { /* Unreadable metadata leaves the request untouched. */ }
      try {
        const response = await transport(input, init);
        if (observed) {
          const id = response.headers.get("request-id");
          if (id && id.length <= 256) requestId = id;
          if (!response.ok) fail({ status: String(response.status) });
        }
        return response;
      } catch (error) {
        if (observed) fail();
        throw error;
      }
    },
    onStreamEvent(raw) {
      if (!active || finished) return;
      try {
        const event = object(raw);
        if (!event) return;
        if (event.type === "error") { fail(); return; }
        const data = event.type === "message_start" ? object(object(event.message)?.usage) : event.type === "message_delta" ? object(event.usage) : undefined;
        if (data) {
          for (const [key, target] of [["input_tokens", "inputTokens"], ["output_tokens", "outputTokens"], ["cache_read_input_tokens", "cachedInputTokens"]] as const) {
            const value = count(data[key]); if (value !== undefined) usage[target] = value;
          }
          const creation = object(data.cache_creation);
          for (const [key, target] of [["ephemeral_5m_input_tokens", "cache_creation_5m_input_tokens"], ["ephemeral_1h_input_tokens", "cache_creation_1h_input_tokens"]] as const) {
            const value = count(creation?.[key]); if (value !== undefined) usage[target] = value;
          }
        }
        if (event.type === "message_stop") {
          finished = true;
          send("tengu_api_success", { ...usage, durationMs: duration(), ...(requestId ? { requestId } : {}) });
        }
      } catch { /* Malformed observer events are ignored. */ }
    },
  };
}
