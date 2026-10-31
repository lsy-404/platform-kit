import { describe, expect, it, vi } from "vitest";
import { anthropicClientHeaders, createAnthropicClientSession } from "../../model-auth/packages/providers/src/anthropic.js";

const url = "https://api.anthropic.com/v1/messages?beta=true";
const request = (): RequestInit => ({ method: "POST", headers: { authorization: "Bearer private", "content-length": "1" }, body: JSON.stringify({ model: "model-a", messages: [{ role: "user", content: "private" }], metadata: { retained: true } }) });
const options = { enabled: true, clientVersion: "2.1.316", sdkVersion: "0.3.316", deviceId: "device_a", sessionId: "session_a", accountUuid: "account_a", organizationUuid: "org_a" } as const;

describe("Anthropic client session", () => {
  it("does nothing when disabled", async () => {
    const transport = vi.fn(async () => new Response("ok"));
    const session = createAnthropicClientSession();
    const observer = session.request({ fetchImpl: transport });
    expect(observer.fetch).toBe(transport);
    expect(session.sessionId).toBeNull();
    expect(await session.close()).toBe(true);
    expect(() => session.request({ fetchImpl: transport })).toThrow("closed");
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the supplied versions without a version lookup", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); });
    expect(await anthropicClientHeaders({ fetchImpl, clientVersion: "2.1.316", entrypoint: "sdk-ts", sdkVersion: "0.3.316", clientApp: "my-app/1.0.0" })).toEqual({ "user-agent": "claude-cli/2.1.316 (external, sdk-ts, agent-sdk/0.3.316, client-app/my-app/1.0.0)", "x-app": "cli", "x-client-app": "my-app/1.0.0" });
    await expect(anthropicClientHeaders({ clientVersion: "2.1.316", clientApp: "bad)\r\nheader" })).rejects.toThrow("Invalid Anthropic client identity");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generates one session ID without starting telemetry", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const { sessionId: _ignored, ...other } = options;
    const session = createAnthropicClientSession(other);
    const first = session.sessionId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.sessionId).toBe(first);
    expect(await session.close()).toBe(true);
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it("binds request identity and telemetry to one session and preserves the response", async () => {
    let sent: RequestInit | undefined, telemetryHeaders: Headers | undefined, events: Array<{ event_name: string; device_id: string; session_id: string; auth: { account_uuid: string }; model: string; env: { version: string } }> = [];
    const response = new Response("unread", { headers: { "request-id": "req-a" } });
    const environment = { platform: "linux", arch: "x64" };
    const session = createAnthropicClientSession({ ...options, parentSessionId: "parent_a", telemetry: { enabled: true, environment, fetchImpl: async (_input, init) => { telemetryHeaders = new Headers(init?.headers); events = JSON.parse(String(init?.body)).events.map((row: { event_data: unknown }) => row.event_data); return new Response(null, { status: 204 }); } } });
    environment.platform = "other";
    const observer = session.request({ fetchImpl: async (_input, init) => { sent = init; return response; }, promptId: "prompt_a", requestClass: "main", agentType: "worker" });
    expect(await observer.fetch(url, request())).toBe(response);
    expect(await response.text()).toBe("unread");
    const headers = new Headers(sent?.headers), body = JSON.parse(String(sent?.body));
    expect(headers.get("authorization")).toBe("Bearer private");
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("x-claude-code-session-id")).toBe("session_a");
    expect(headers.get("x-claude-code-request-class")).toBe("main");
    expect(headers.get("x-claude-code-prompt-id")).toBe("prompt_a");
    expect(headers.get("x-claude-code-agent-type")).toBe("worker");
    expect(headers.get("user-agent")).toBe("claude-cli/2.1.316 (external, sdk-ts, agent-sdk/0.3.316)");
    expect(body.metadata.retained).toBe(true);
    expect(JSON.parse(body.metadata.user_id)).toEqual({ device_id: "device_a", account_uuid: "account_a", session_id: "session_a", parent_session_id: "parent_a" });
    observer.onStreamEvent({ type: "message_stop" });
    expect(await session.close()).toBe(true);
    expect(events.map(event => event.event_name)).toEqual(["tengu_api_query", "tengu_api_success"]);
    expect(telemetryHeaders?.get("user-agent")).toBe("claude-code/2.1.316");
    expect(telemetryHeaders?.get("x-claude-code-session-id")).toBeNull();
    expect(telemetryHeaders?.get("x-claude-code-prompt-id")).toBeNull();
    expect(events[1]).toMatchObject({ device_id: "device_a", session_id: "session_a", is_interactive: false, user_type: "external", auth: { account_uuid: "account_a", organization_uuid: "org_a" }, model: "model-a", env: { version: "2.1.316", platform: "linux", arch: "x64" } });
  });

  it("keeps prompt identity across tool-loop requests and isolates separate sessions", async () => {
    const seen: Array<{ session: string | null; prompt: string | null; agent: string | null }> = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => { const h = new Headers(init?.headers); seen.push({ session: h.get("x-claude-code-session-id"), prompt: h.get("x-claude-code-prompt-id"), agent: h.get("x-claude-code-agent-id") }); return new Response("ok"); };
    const a = createAnthropicClientSession(options), b = createAnthropicClientSession({ ...options, sessionId: "session_b", deviceId: "device_b", accountUuid: "account_b" });
    await a.request({ fetchImpl, promptId: "p" }).fetch(url, request());
    await a.request({ fetchImpl, promptId: "p" }).fetch(url, request());
    await b.request({ fetchImpl, promptId: "p", requestClass: "subagent", agentId: "agent_b" }).fetch(url, request());
    expect(seen).toEqual([{ session: "session_a", prompt: "p", agent: null }, { session: "session_a", prompt: "p", agent: null }, { session: "session_b", prompt: "p", agent: "agent_b" }]);
    await a.close(); await b.close();
  });

  it("passes other requests and cancellation through unchanged", async () => {
    const error = new DOMException("cancelled", "AbortError");
    const transport = vi.fn(async () => { throw error; });
    const session = createAnthropicClientSession(options), observer = session.request({ fetchImpl: transport });
    const input = request();
    await expect(observer.fetch("https://api.anthropic.com/v1/messages/count_tokens", input)).rejects.toBe(error);
    expect(transport).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages/count_tokens", input);
    await session.close();
  });

  it("does not retry a synchronously throwing transport", () => {
    const error = new Error("transport");
    const transport = vi.fn(() => { throw error; }) as unknown as typeof fetch;
    const session = createAnthropicClientSession(options), observer = session.request({ fetchImpl: transport });
    expect(() => observer.fetch(url, request())).toThrow(error);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects new requests after close without stopping an existing observer", async () => {
    const transport = vi.fn(async () => new Response("ok"));
    const session = createAnthropicClientSession(options);
    const observer = session.request({ fetchImpl: transport });
    await session.close();
    expect(() => session.request({ fetchImpl: transport })).toThrow("closed");
    expect(await (await observer.fetch(url, request())).text()).toBe("ok");
    expect(transport).toHaveBeenCalledOnce();
  });
});
