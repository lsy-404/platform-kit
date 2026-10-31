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

export interface AnthropicTelemetryStorage {
  load(key: string): Promise<readonly AnthropicTelemetryBatch[]>;
  save(key: string, batches: readonly AnthropicTelemetryBatch[]): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AnthropicTelemetryBatch { readonly events: readonly Row[]; readonly attempts: number }

export type AnthropicTelemetryOptions =
  | { readonly enabled?: false }
  | { readonly enabled: true; readonly sessionId: string; readonly fetchImpl: typeof fetch; readonly context?: AnthropicTelemetryContext; readonly signal?: AbortSignal; readonly storage?: AnthropicTelemetryStorage };

export interface AnthropicTelemetry {
  record(event: string, metadata?: AnthropicTelemetryMetadata): boolean;
  request(fetchImpl: typeof fetch): AnthropicTelemetryRequest;
  flush(): Promise<boolean>;
  close(): Promise<boolean>;
}

const ENDPOINT = "https://api.anthropic.com/api/event_logging/v2/batch";
const LIMIT = 200;
const QUEUE_LIMIT = 8192;
const DELAY_MS = 10_000;
const BATCH_DELAY_MS = 100;
const MAX_ATTEMPTS = 8;
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
  const accountUuid = context?.accountUuid;
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
  if (options.storage && (!accountUuid || !deviceId)) throw new TypeError("Storage requires account and device IDs.");
  const { storage } = options;
  const storageKey = JSON.stringify([sessionId, deviceId, accountUuid, context?.organizationUuid ?? null]);
  const closeController = new AbortController();
  let queue: Row[] = [];
  let batches: Array<{ events: Row[]; attempts: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false, closing = false, failed = false, dropped = false, loadFailed = false;
  let pending: Promise<boolean> | undefined;
  let closePromise: Promise<boolean> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const onAbort = () => { closed = true; clear(); if (queue.length || batches.length || pending) failed = true; };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const ready = storage && storageKey ? storage.load(storageKey).then(saved => {
    batches = saved.map(batch => {
      if (!Number.isInteger(batch.attempts) || batch.attempts < 0 || batch.attempts >= MAX_ATTEMPTS || !Array.isArray(batch.events) || !batch.events.length || batch.events.length > LIMIT || batch.events.some(row => row.event_type !== "ClaudeCodeInternalEvent" || row.event_data?.session_id !== sessionId || row.event_data?.device_id !== deviceId || (row.event_data?.auth as { account_uuid?: string; organization_uuid?: string } | undefined)?.account_uuid !== accountUuid || (row.event_data?.auth as { organization_uuid?: string } | undefined)?.organization_uuid !== context?.organizationUuid)) throw new Error("Invalid stored telemetry batch.");
      return { events: [...batch.events], attempts: batch.attempts };
    });
  }).catch(() => { failed = true; loadFailed = true; }) : Promise.resolve();
  const persist = async () => {
    if (!storage || !storageKey) return;
    try { if (batches.length) await storage.save(storageKey, batches); else await storage.remove(storageKey); }
    catch { failed = true; }
  };
  const schedule = (delay = DELAY_MS) => {
    if (closed || closing || timer !== undefined || (!queue.length && !batches.length)) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
    timer.unref?.();
  };
  const post = async (events: Row[]): Promise<boolean> => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const expired = new Promise<false>(resolve => {
      abort = () => { controller.abort(); resolve(false); };
      timeout = setTimeout(abort, TIMEOUT_MS);
      signal?.addEventListener("abort", abort, { once: true });
      closeController.signal.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || closeController.signal.aborted) abort();
    });
    const request = Promise.resolve().then(() => controller.signal.aborted ? false : fetchImpl(ENDPOINT, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-service-name": "claude-code" },
      body: JSON.stringify({ events }), signal: controller.signal,
    }).then(response => response.ok)).catch(() => false);
    try { return await Promise.race([request, expired]); }
    finally { if (timeout !== undefined) clearTimeout(timeout); if (abort) { signal?.removeEventListener("abort", abort); closeController.signal.removeEventListener("abort", abort); } }
  };
  const flush = (): Promise<boolean> => {
    clear();
    if (pending) return pending.then(() => queue.length && !closed ? flush() : !failed && !dropped && !batches.length);
    pending = (async () => {
      await ready;
      if (loadFailed) return false;
      while (queue.length) batches.push({ events: queue.splice(0, LIMIT), attempts: 0 });
      await persist();
      while (batches.length && !closed) {
        const batch = batches[0]!;
        const ok = await post(batch.events);
        if (ok) { batches.shift(); await persist(); if (batches.length) await new Promise<void>(resolve => setTimeout(resolve, BATCH_DELAY_MS)); }
        else {
          batch.attempts++;
          if (batch.attempts >= MAX_ATTEMPTS) { batches.shift(); dropped = true; }
          await persist();
          if (!closed && !closing && batches.length) { clear(); schedule(Math.min(Math.max(500, 500 * batch.attempts ** 2), 30_000)); }
          break;
        }
      }
      return !failed && !dropped && !queue.length && !batches.length;
    })().finally(() => { pending = undefined; if (queue.length) schedule(); });
    return pending;
  };
  void ready.then(() => schedule());
  const record = (event: string, metadata: AnthropicTelemetryMetadata = {}, model?: string): boolean => {
      if (closed || closing || typeof event !== "string" || !EVENT_NAME.test(event) || queue.length + batches.reduce((total, batch) => total + batch.events.length, 0) >= QUEUE_LIMIT || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
      const entries = Object.entries(metadata);
      if (entries.length > 32 || entries.some(([key, value]) => !KEY.test(key) || !(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 256)))) return false;
      queue.push({ event_type: "ClaudeCodeInternalEvent", event_data: {
        event_id: randomUUID(), event_name: event,
        client_timestamp: new Date().toISOString(), session_id: sessionId, ...stamp, ...(model ? { model } : {}),
        additional_metadata: Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8").toString("base64"),
      } });
      if (queue.length >= LIMIT) void flush(); else schedule();
      return true;
  };
  return {
    record,
    request: transport => observeAnthropicRequest(transport, sessionId, deviceId, accountUuid, (name, metadata, model) => { record(name, metadata, model); }),
    flush,
    close() {
      if (closePromise) return closePromise;
      closing = true; clear();
      closePromise = (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<false>(resolve => { deadline = setTimeout(() => { closeController.abort(); resolve(false); }, TIMEOUT_MS); });
        const result = await Promise.race([flush(), expired]);
        if (deadline !== undefined) clearTimeout(deadline);
        closed = true; clear();
        signal?.removeEventListener("abort", onAbort);
        return result;
      })();
      return closePromise;
    },
  };
}
