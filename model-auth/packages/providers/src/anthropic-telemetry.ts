import { randomUUID } from "node:crypto";
import { observeAnthropicRequest, type AnthropicTelemetryRequest } from "./anthropic-telemetry-request.js";

export type AnthropicTelemetryMetadata = Readonly<Record<string, string | number | boolean>>;

export interface AnthropicTelemetryContext {
  readonly deviceId?: string;
  readonly accountUuid?: string;
  readonly organizationUuid?: string;
  readonly model?: string;
  readonly userType?: "external" | "ant";
  readonly isInteractive?: boolean;
  readonly clientType?: string;
  readonly entrypoint?: string;
  readonly environment?: { readonly version?: string; readonly versionBase?: string; readonly buildTime?: string; readonly platform?: string; readonly platformRaw?: string; readonly arch?: string; readonly isClaudeAiAuth?: boolean };
}

export type AnthropicTelemetryOptions =
  | { readonly enabled?: false }
  | { readonly enabled: true; readonly sessionId: string; readonly fetchImpl: typeof fetch; readonly context?: AnthropicTelemetryContext; readonly signal?: AbortSignal };

export interface AnthropicTelemetry {
  record(event: string, metadata?: AnthropicTelemetryMetadata): boolean;
  request(fetchImpl: typeof fetch): AnthropicTelemetryRequest;
  flush(): Promise<boolean>;
  close(): Promise<boolean>;
}

const ENDPOINT = "https://api.anthropic.com/api/event_logging/v2/batch";
const LIMIT = 100;
const DELAY_MS = 5_000;
const TIMEOUT_MS = 10_000;
const EVENT_NAME = /^tengu_[a-z0-9_]{1,58}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SESSION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

type Row = { event_type: "ClaudeCodeInternalEvent"; event_data: Record<string, unknown> };

/** Creates an explicitly enabled sender bound to one host-authenticated session. */
export function createAnthropicTelemetry(options: AnthropicTelemetryOptions = {}): AnthropicTelemetry {
  if (!options.enabled) return { record: () => false, request: fetchImpl => observeAnthropicRequest(fetchImpl), flush: async () => true, close: async () => true };
  if (!SESSION_ID.test(options.sessionId)) throw new TypeError("Invalid telemetry session ID.");
  const { fetchImpl, sessionId, signal } = options;
  const context = options.context;
  const deviceId = context?.deviceId;
  const environment = context?.environment;
  const strings = [context?.deviceId, context?.accountUuid, context?.organizationUuid, context?.model, context?.clientType, context?.entrypoint,
    environment?.version, environment?.versionBase, environment?.buildTime, environment?.platform, environment?.platformRaw, environment?.arch];
  if (strings.some(value => value !== undefined && (typeof value !== "string" || !value.length || value.length > 256))
    || (context?.userType !== undefined && context.userType !== "external" && context.userType !== "ant")
    || (context?.isInteractive !== undefined && typeof context.isInteractive !== "boolean")
    || (environment?.isClaudeAiAuth !== undefined && typeof environment.isClaudeAiAuth !== "boolean")) throw new TypeError("Invalid telemetry context.");
  const stamp = {
    ...(context?.deviceId !== undefined ? { device_id: context.deviceId } : {}),
    ...(context?.accountUuid !== undefined || context?.organizationUuid !== undefined ? { auth: {
      ...(context.accountUuid !== undefined ? { account_uuid: context.accountUuid } : {}),
      ...(context.organizationUuid !== undefined ? { organization_uuid: context.organizationUuid } : {}),
    } } : {}),
    ...(context?.model !== undefined ? { model: context.model } : {}),
    ...(context?.userType !== undefined ? { user_type: context.userType } : {}),
    ...(context?.isInteractive !== undefined ? { is_interactive: context.isInteractive } : {}),
    ...(context?.clientType !== undefined ? { client_type: context.clientType } : {}),
    ...(context?.entrypoint !== undefined ? { entrypoint: context.entrypoint } : {}),
    ...(environment ? { env: {
      ...(environment.version !== undefined ? { version: environment.version } : {}),
      ...(environment.versionBase !== undefined ? { version_base: environment.versionBase } : {}),
      ...(environment.buildTime !== undefined ? { build_time: environment.buildTime } : {}),
      ...(environment.platform !== undefined ? { platform: environment.platform } : {}),
      ...(environment.platformRaw !== undefined ? { platform_raw: environment.platformRaw } : {}),
      ...(environment.arch !== undefined ? { arch: environment.arch } : {}),
      ...(environment.isClaudeAiAuth !== undefined ? { is_claude_ai_auth: environment.isClaudeAiAuth } : {}),
    } } : {}),
  };
  let queue: Row[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let closing = false;
  let failed = false;
  let pending: Promise<boolean> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const onAbort = () => { if (queue.length || pending) failed = true; closed = true; clear(); queue = []; };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const schedule = () => {
    if (closed || closing || timer !== undefined || !queue.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, DELAY_MS);
    timer.unref?.();
  };
  const flush = (): Promise<boolean> => {
    clear();
    if (pending) return pending.then(async ok => (await flush()) && ok);
    if (!queue.length) return Promise.resolve(!failed);
    const batch = queue;
    queue = [];
    pending = (async () => {
      try {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const expired = new Promise<false>(resolve => {
          abort = () => { controller.abort(); resolve(false); };
          timeout = setTimeout(abort, TIMEOUT_MS);
          timeout.unref?.();
          signal?.addEventListener("abort", abort, { once: true });
        });
        const request = Promise.resolve().then(() => controller.signal.aborted ? false : fetchImpl(ENDPOINT, {
          method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-service-name": "claude-code" },
          body: JSON.stringify({ events: batch }), signal: controller.signal,
        }).then(response => response.ok)).catch(() => false);
        try { const ok = await Promise.race([request, expired]); failed ||= !ok; return !failed; }
        finally { if (timeout !== undefined) clearTimeout(timeout); if (abort) signal?.removeEventListener("abort", abort); }
      } catch { failed = true; return false; }
    })().finally(() => { pending = undefined; schedule(); });
    return pending;
  };
  const record = (event: string, metadata: AnthropicTelemetryMetadata = {}, model?: string): boolean => {
      if (closed || closing || typeof event !== "string" || !EVENT_NAME.test(event) || queue.length >= LIMIT || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
      const entries = Object.entries(metadata);
      if (entries.length > 32 || entries.some(([key, value]) => !KEY.test(key) || !(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 256)))) return false;
      queue.push({ event_type: "ClaudeCodeInternalEvent", event_data: {
        event_id: randomUUID(), event_name: event,
        client_timestamp: new Date().toISOString(), session_id: sessionId, ...stamp, ...(model ? { model } : {}),
        additional_metadata: Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8").toString("base64"),
      } });
      if (queue.length === LIMIT) void flush(); else schedule();
      return true;
  };
  return {
    record,
    request: transport => observeAnthropicRequest(transport, sessionId, deviceId, (name, metadata, model) => { record(name, metadata, model); }),
    flush,
    async close() {
      if (closed) return pending ? pending : !failed;
      closing = true;
      clear();
      const result = await flush();
      closed = true;
      clear();
      signal?.removeEventListener("abort", onAbort);
      return result;
    },
  };
}
