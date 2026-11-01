import protobuf from "protobufjs/light.js";

export interface AntigravityTelemetryContext {
  readonly ideName?: string;
  readonly ideVersion?: string;
  readonly os?: string;
  readonly arch?: string;
  readonly productName?: string;
}
export interface AntigravityTelemetrySettings {
  readonly telemetryEnabled: boolean;
  readonly userDataCollectionForceDisabled: boolean;
}
export interface AntigravityTelemetryEvent {
  readonly eventType: string;
  readonly timestamp: number;
  readonly isRedacted: boolean;
  readonly context?: AntigravityTelemetryContext;
}
export type AntigravityTelemetryOptions = {
  readonly enabled?: false;
  readonly initialized?: boolean;
} | {
  readonly enabled: true;
  readonly initialized: false;
} | {
  readonly enabled: true;
  readonly initialized: true;
  readonly fetchImpl: typeof fetch;
  readonly context?: AntigravityTelemetryContext;
  readonly settings?: () => Promise<AntigravityTelemetrySettings | null>;
  readonly onError: (error: unknown) => void;
};
export interface AntigravityTelemetry {
  record(eventType: string, conversation?: { readonly sensitivity: number }): boolean;
  flush(): Promise<void>;
  close(): Promise<void>;
}

const schema = protobuf.Root.fromJSON({ nested: {
  AnalyticsEventMetadata: { fields: { eventType: { type: "string", id: 1 } } },
  JetskiTelemetryExtension: { fields: {
    analyticsEventMetadata: { type: "AnalyticsEventMetadata", id: 6 }, ideName: { type: "string", id: 16 },
    ideVersion: { type: "string", id: 17 }, os: { type: "string", id: 18 }, arch: { type: "string", id: 19 },
    isRedacted: { type: "bool", id: 24 }, productName: { type: "string", id: 27 },
  } },
  LogEvent: { fields: { eventTimeMs: { type: "int64", id: 1 }, sourceExtension: { type: "bytes", id: 6 }, eventCode: { type: "int32", id: 11 } } },
  LogRequest: { fields: { logSource: { type: "int32", id: 2 }, logEvent: { rule: "repeated", type: "LogEvent", id: 3 }, requestTimeMs: { type: "int64", id: 4 } } },
} });
const Extension = schema.lookupType("JetskiTelemetryExtension");
const Request = schema.lookupType("LogRequest");
const EVENT_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;
const ENDPOINT = "https://play.googleapis.com/log";
const PERIOD_MS = 5_000;
const TIMEOUT_MS = 5_000;
const QUEUE_LIMIT = 1024;

type PendingEvent = { readonly eventType: string; readonly timestamp: number };

export function encodeAntigravityTelemetryBatch(events: readonly AntigravityTelemetryEvent[], requestTimeMs = Date.now()): Uint8Array {
  const logEvent = events.map(event => {
    if (typeof event.eventType !== "string" || !EVENT_NAME.test(event.eventType) || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) throw new TypeError("Invalid telemetry event.");
    const context = event.context;
    const extension = {
      ...(context?.ideName !== undefined ? { ideName: context.ideName } : {}),
      ...(context?.ideVersion !== undefined ? { ideVersion: context.ideVersion } : {}),
      ...(context?.os !== undefined ? { os: context.os } : {}),
      ...(context?.arch !== undefined ? { arch: context.arch } : {}),
      ...(context?.productName !== undefined ? { productName: context.productName } : {}),
      analyticsEventMetadata: { eventType: event.eventType }, isRedacted: event.isRedacted,
    };
    const error = Extension.verify(extension);
    if (error) throw new TypeError(error);
    return { eventTimeMs: event.timestamp, sourceExtension: Extension.encode(Extension.create(extension)).finish(), eventCode: 5 };
  });
  if (!Number.isSafeInteger(requestTimeMs) || requestTimeMs < 0) throw new TypeError("Invalid telemetry request time.");
  const request = { logSource: 2747, logEvent, requestTimeMs };
  const error = Request.verify(request);
  if (error) throw new TypeError(error);
  return Request.encode(Request.create(request)).finish();
}

export function createAntigravityTelemetry(options: AntigravityTelemetryOptions = {}): AntigravityTelemetry {
  if (options.enabled !== true || options.initialized !== true) return { record: () => false, flush: async () => {}, close: async () => {} };
  if (!options.fetchImpl || !options.onError) throw new TypeError("Telemetry requires an account-bound fetch and error handler.");
  const active = options;
  const fetchImpl = options.fetchImpl;
  const queue: PendingEvent[] = [];
  let closed = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function redacted(): Promise<boolean> {
    try {
      const settings = await active.settings?.();
      return !settings || settings.telemetryEnabled !== true || settings.userDataCollectionForceDisabled !== false;
    } catch { return true; }
  }
  function flush(): Promise<void> {
    if (running) return running;
    if (!queue.length) return Promise.resolve();
    const batch = queue.slice();
    const abort = new AbortController();
    controller = abort;
    const work = (async () => {
      const isRedacted = await redacted();
      if (abort.signal.aborted) throw new Error("Telemetry request timed out.");
      if (isRedacted) throw new Error("Telemetry settings do not allow upload.");
      const payload = encodeAntigravityTelemetryBatch(batch.map(event => ({ ...event, isRedacted, ...(active.context ? { context: active.context } : {}) })));
      const response = await fetchImpl(ENDPOINT, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: Buffer.from(payload), signal: abort.signal, redirect: "error" });
      if (abort.signal.aborted) throw new Error("Telemetry request timed out.");
      if (response.redirected) throw new Error("Telemetry redirect was rejected.");
      if (!response.ok) throw new Error(`Telemetry request failed (${response.status}).`);
      queue.splice(0, batch.length);
    })();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    timeout.unref?.();
    running = Promise.race([work, new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(new Error("Telemetry request timed out.")), { once: true }))])
      .finally(() => { clearTimeout(timeout); controller = undefined; running = undefined; });
    return running;
  }
  function schedule(): void {
    if (closed) return;
    timer = setTimeout(() => { void flush().catch(error => active.onError(error)).finally(schedule); }, PERIOD_MS);
    timer.unref?.();
  }
  schedule();
  return {
    record(eventType, conversation) {
      if (closed || queue.length >= QUEUE_LIMIT || typeof eventType !== "string" || !EVENT_NAME.test(eventType) || (conversation && (!Number.isFinite(conversation.sensitivity) || conversation.sensitivity >= 2))) return false;
      queue.push({ eventType, timestamp: Date.now() });
      return true;
    },
    flush,
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      try { await flush(); } finally { controller?.abort(); }
    },
  };
}
