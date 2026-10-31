import { randomUUID } from "node:crypto";
import { applyAnthropicRequestPolicy, type AnthropicRequestPolicy } from "./anthropic-request-policy.js";
import { anthropicIdentityHeaders } from "./anthropic-client-identity.js";
import { createAnthropicTelemetry, type AnthropicTelemetry, type AnthropicTelemetryContext, type AnthropicTelemetryPrivacyEnv, type AnthropicTelemetryStorage } from "./anthropic-telemetry.js";
import type { AnthropicTelemetryRequest } from "./anthropic-telemetry-request.js";

export type AnthropicRequestClass = "main" | "subagent" | "workflow" | "compaction" | "auxiliary" | "side_reply";
export type AnthropicClientSessionOptions = { readonly enabled?: false } | {
  readonly enabled: true; readonly clientVersion: string; readonly sdkVersion: string; readonly deviceId: string;
  readonly sessionId?: string; readonly parentSessionId?: string; readonly accountUuid?: string; readonly organizationUuid?: string;
  readonly entrypoint?: string; readonly clientApp?: string; readonly bodyPolicy?: AnthropicRequestPolicy;
  readonly telemetry?: { readonly enabled: true; readonly fetchImpl: typeof fetch; readonly signal?: AbortSignal; readonly storage?: AnthropicTelemetryStorage; readonly privacyEnv?: AnthropicTelemetryPrivacyEnv; readonly eligible?: () => boolean; readonly environment?: Omit<NonNullable<AnthropicTelemetryContext["environment"]>, "version"> };
};
export interface AnthropicClientRequestOptions {
  readonly fetchImpl: typeof fetch;
  readonly bodyPolicy?: AnthropicRequestPolicy;
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
    return { fetch: fetchImpl, onStreamEvent() {}, onResponseMessage() {}, onError() {} };
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
      context: { deviceId, ...(accountUuid ? { accountUuid } : {}), ...(organizationUuid ? { organizationUuid } : {}), entrypoint, agentSdkVersion: sdkVersion, ...(parentSessionId ? { parentSessionId } : {}),
        ...(entrypoint === "sdk-ts" ? { isInteractive: false, userType: "external" as const } : {}), environment: { ...options.telemetry.environment, version: clientVersion } },
      ...(options.telemetry.signal ? { signal: options.telemetry.signal } : {}),
      ...(options.telemetry.storage ? { storage: options.telemetry.storage } : {}),
      ...(options.telemetry.privacyEnv ? { privacyEnv: options.telemetry.privacyEnv } : {}), ...(options.telemetry.eligible ? { eligible: options.telemetry.eligible } : {}) })
    : createAnthropicTelemetry();
  return {
    sessionId,
    request({ fetchImpl, bodyPolicy: requestPolicy = options.bodyPolicy, requestClass = "main", promptId, agentId, parentAgentId, agentType }) {
      if (closed) throw new Error("Anthropic client session is closed.");
      const bodyPolicy = requestPolicy ? structuredClone(requestPolicy) : undefined;
      if (bodyPolicy?.system?.mode === "recorded" && !bodyPolicy.system.recorded?.trim()) throw new TypeError("A recorded system prefix is required.");
      if (bodyPolicy?.thinking?.supported && bodyPolicy.thinking.mode === "enabled" && (!Number.isSafeInteger(bodyPolicy.thinking.budgetTokens) || bodyPolicy.thinking.budgetTokens! <= 0)) throw new TypeError("Enabled thinking requires a valid budget.");
      if (bodyPolicy?.cache?.targets?.some(target => !Number.isSafeInteger(target.index) || target.index < 0 || (target.kind === "message" && (!Number.isSafeInteger(target.block) || target.block < 0)))) throw new TypeError("Invalid cache target.");
      if (!CLASSES.includes(requestClass) || [promptId, agentId, parentAgentId, agentType].some(value => value !== undefined && !IDENTIFIER.test(value))) throw new TypeError("Invalid Anthropic request identity.");
      const observer = telemetry.request(fetchImpl, { ...(agentId ? { agentId } : {}), ...(agentType ? { agentType } : {}) });
      const fetch: typeof globalThis.fetch = (input, init) => {
        let prepared: RequestInit | undefined;
        let payload: Record<string, unknown> | undefined;
        try {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (url.origin === "https://api.anthropic.com" && url.pathname === "/v1/messages" && method === "POST" && typeof init?.body === "string") payload = object(JSON.parse(init.body));
        } catch { /* Unrecognized request bodies pass through untouched. */ }
        if (payload && Array.isArray(payload.messages)) {
          const result = bodyPolicy ? applyAnthropicRequestPolicy(payload, bodyPolicy) : undefined;
          const requestBody = result?.body ?? payload;
          const metadata = object(requestBody.metadata) ?? {};
          requestBody.metadata = { ...metadata, user_id: JSON.stringify({ device_id: deviceId, account_uuid: accountUuid ?? "", session_id: sessionId, ...(parentSessionId ? { parent_session_id: parentSessionId } : {}) }) };
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          for (const [key, value] of Object.entries(clientHeaders)) headers.set(key, value);
          headers.set("x-claude-code-session-id", sessionId);
          headers.set("x-claude-code-request-class", requestClass);
          for (const [key, value] of [["x-claude-code-prompt-id", promptId], ["x-claude-code-agent-id", agentId], ["x-claude-code-parent-agent-id", parentAgentId], ["x-claude-code-agent-type", agentType]] as const) {
            if (value) headers.set(key, value); else headers.delete(key);
          }
          if (result && bodyPolicy) {
            const existing = (headers.get("anthropic-beta") ?? "").split(",").map(value => value.trim()).filter(Boolean)
              .filter(value => !(bodyPolicy.supportsEffort === false && value === "effort-2025-11-24") && !(bodyPolicy.supportsContextManagement === false && value === "context-management-2025-06-27"));
            const betas = [...new Set([...existing, ...result.betas])];
            if (betas.length) headers.set("anthropic-beta", betas.join(","));
            else headers.delete("anthropic-beta");
          }
          headers.delete("content-length");
          prepared = { ...init, headers, body: JSON.stringify(requestBody) };
        }
        return observer.fetch(input, prepared ?? init);
      };
      return { fetch, onStreamEvent: observer.onStreamEvent, onResponseMessage: observer.onResponseMessage, onError: observer.onError };
    },
    flush: () => telemetry.flush(),
    close: () => { closed = true; return telemetry.close(); },
  };
}
