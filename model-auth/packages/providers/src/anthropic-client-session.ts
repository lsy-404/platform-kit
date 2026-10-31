import { randomUUID } from "node:crypto";
import { anthropicIdentityHeaders } from "./anthropic-client-identity.js";
import { createAnthropicTelemetry, type AnthropicTelemetry, type AnthropicTelemetryContext, type AnthropicTelemetryStorage } from "./anthropic-telemetry.js";
import type { AnthropicTelemetryRequest } from "./anthropic-telemetry-request.js";

export type AnthropicRequestClass = "main" | "subagent" | "workflow" | "compaction" | "auxiliary" | "side_reply";
export type AnthropicClientSessionOptions = { readonly enabled?: false } | {
  readonly enabled: true; readonly clientVersion: string; readonly sdkVersion: string; readonly deviceId: string;
  readonly sessionId?: string; readonly parentSessionId?: string; readonly accountUuid?: string; readonly organizationUuid?: string;
  readonly entrypoint?: string; readonly clientApp?: string;
  readonly telemetry?: { readonly enabled: true; readonly fetchImpl: typeof fetch; readonly signal?: AbortSignal; readonly storage?: AnthropicTelemetryStorage; readonly environment?: Omit<NonNullable<AnthropicTelemetryContext["environment"]>, "version"> };
};
export interface AnthropicClientRequestOptions {
  readonly fetchImpl: typeof fetch;
  readonly requestClass?: AnthropicRequestClass;
  readonly promptId?: string;
  readonly agentId?: string;
  readonly agentType?: string;
  readonly parentAgentId?: string;
}
export interface AnthropicClientSession {
  readonly sessionId: string | null;
  request(options: AnthropicClientRequestOptions): AnthropicTelemetryRequest;
  flush(): Promise<boolean>;
  close(): Promise<boolean>;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const CLASSES: readonly AnthropicRequestClass[] = ["main", "subagent", "workflow", "compaction", "auxiliary", "side_reply"];
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Creates one explicitly enabled client identity shared by its requests. */
export function createAnthropicClientSession(options: AnthropicClientSessionOptions = {}): AnthropicClientSession {
  let closed = false;
  if (!options.enabled) return { sessionId: null, request: ({ fetchImpl }) => {
    if (closed) throw new Error("Anthropic client session is closed.");
    return { fetch: fetchImpl, onStreamEvent() {}, onError() {} };
  }, flush: async () => true, close: async () => { closed = true; return true; } };
  const { clientVersion, sdkVersion, deviceId, accountUuid, organizationUuid, clientApp, parentSessionId } = options;
  const sessionId = options.sessionId ?? randomUUID(), entrypoint = options.entrypoint ?? "sdk-ts";
  if (![sessionId, deviceId, ...(parentSessionId !== undefined ? [parentSessionId] : []), ...(accountUuid !== undefined ? [accountUuid] : []), ...(organizationUuid !== undefined ? [organizationUuid] : [])].every(value => IDENTIFIER.test(value))) throw new TypeError("Invalid Anthropic session identity.");
  const clientHeaders = anthropicIdentityHeaders({ clientVersion, sdkVersion, entrypoint, ...(clientApp ? { clientApp } : {}) });
  const telemetryFetch = options.telemetry?.fetchImpl;
  const telemetry: AnthropicTelemetry = options.telemetry?.enabled
    ? createAnthropicTelemetry({ enabled: true, sessionId, fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("user-agent", `claude-code/${clientVersion}`);
      return telemetryFetch!(input, { ...init, headers });
    },
      context: { deviceId, ...(accountUuid ? { accountUuid } : {}), ...(organizationUuid ? { organizationUuid } : {}), entrypoint,
        ...(entrypoint === "sdk-ts" ? { isInteractive: false, userType: "external" as const } : {}), environment: { ...options.telemetry.environment, version: clientVersion } },
      ...(options.telemetry.signal ? { signal: options.telemetry.signal } : {}),
      ...(options.telemetry.storage ? { storage: options.telemetry.storage } : {}) })
    : createAnthropicTelemetry();
  return {
    sessionId,
    request({ fetchImpl, requestClass = "main", promptId, agentId, parentAgentId, agentType }) {
      if (closed) throw new Error("Anthropic client session is closed.");
      if (!CLASSES.includes(requestClass) || [promptId, agentId, parentAgentId, agentType].some(value => value !== undefined && !IDENTIFIER.test(value))) throw new TypeError("Invalid Anthropic request identity.");
      const observer = telemetry.request(fetchImpl);
      const fetch: typeof globalThis.fetch = (input, init) => {
        let prepared: RequestInit | undefined;
        try {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (url.origin === "https://api.anthropic.com" && url.pathname === "/v1/messages" && method === "POST" && typeof init?.body === "string") {
            const payload = object(JSON.parse(init.body));
            if (payload && Array.isArray(payload.messages)) {
              const metadata = object(payload.metadata) ?? {};
              payload.metadata = { ...metadata, user_id: JSON.stringify({ device_id: deviceId, account_uuid: accountUuid ?? "", session_id: sessionId, ...(parentSessionId ? { parent_session_id: parentSessionId } : {}) }) };
              const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
              for (const [key, value] of Object.entries(clientHeaders)) headers.set(key, value);
              headers.set("x-claude-code-session-id", sessionId);
              headers.set("x-claude-code-request-class", requestClass);
              for (const [key, value] of [["x-claude-code-prompt-id", promptId], ["x-claude-code-agent-id", agentId], ["x-claude-code-parent-agent-id", parentAgentId], ["x-claude-code-agent-type", agentType]] as const) {
                if (value) headers.set(key, value); else headers.delete(key);
              }
              headers.delete("content-length");
              prepared = { ...init, headers, body: JSON.stringify(payload) };
            }
          }
        } catch { /* Unrecognized request bodies pass through untouched. */ }
        return observer.fetch(input, prepared ?? init);
      };
      return { fetch, onStreamEvent: observer.onStreamEvent, onError: observer.onError };
    },
    flush: () => telemetry.flush(),
    close: () => { closed = true; return telemetry.close(); },
  };
}
