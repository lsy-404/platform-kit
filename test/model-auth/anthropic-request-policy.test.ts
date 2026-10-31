import { describe, expect, it, vi } from "vitest";
import { applyAnthropicRequestPolicy, createAnthropicClientSession } from "../../model-auth/packages/providers/src/anthropic.js";

describe("Anthropic request policy", () => {
  it("preserves unknown facts and the input object", () => {
    const input = { system: "application", max_tokens: 4096, thinking: { type: "enabled", budget_tokens: 1200 }, temperature: 0.3 };
    expect(applyAnthropicRequestPolicy(input, {}).body).toEqual(input);
    expect(input.system).toBe("application");
  });
  it("selects the requested system prefix without losing application text", () => {
    const input = { system: [{ type: "text", text: "application" }], messages: [] };
    for (const [mode, expected] of [["sdk", "You are a Claude agent"], ["sdk-append", "You are Claude Code"], ["interactive", "You are Claude Code"], ["recorded", "recorded prefix"]] as const) {
      const result = applyAnthropicRequestPolicy(input, { system: { mode, ...(mode === "recorded" ? { recorded: expected } : {}) } });
      expect((result.body.system as any[])[0].text).toContain(expected);
      expect((result.body.system as any[])[1].text).toBe("application");
    }
  });
  it("uses explicit model capabilities for thinking, effort and context", () => {
    const input = { max_tokens: 1200, temperature: 0.4, tool_choice: { type: "tool", name: "read" }, output_config: { effort: "high", format: { type: "json_schema" } } };
    const policy = { thinking: { mode: "enabled" as const, supported: true, budgetTokens: 2000 }, supportsEffort: false, supportsContextManagement: true, betas: { allowed: ["context-management-2025-06-27", "effort-2025-11-24"] } };
    const result = applyAnthropicRequestPolicy(input, policy);
    expect(result.body).toMatchObject({ thinking: { type: "enabled", budget_tokens: 1199 }, tool_choice: { type: "auto" }, output_config: { format: { type: "json_schema" } }, context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] } });
    expect(result.body.temperature).toBeUndefined();
    expect(result.betas).toEqual(["context-management-2025-06-27"]);
    expect(input.tool_choice.type).toBe("tool");
    expect(applyAnthropicRequestPolicy(input, { thinking: { mode: "disabled", supported: true, acceptsDisabled: true } }).body.thinking).toEqual({ type: "disabled" });
  });
  it("places cache markers only at host-selected blocks with TTL precedence", () => {
    const input = { system: [{ type: "text", text: "system" }], messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "tail" }] }] };
    const result = applyAnthropicRequestPolicy(input, { cache: { force5m: true, environment: "1h", targets: [{ kind: "message", index: 0, block: 0, scope: "global" }] } });
    const message = (result.body.messages as any[])[0];
    expect(message.content[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m", scope: "global" });
    expect(message.content[1].cache_control).toBeUndefined();
    expect((input.messages[0].content[0] as any).cache_control).toBeUndefined();
  });
  it("applies per-request policy only to enabled first-party sessions", async () => {
    const calls: RequestInit[] = [];
    const transport = vi.fn(async (_input, init) => { calls.push(init); return new Response(null, { status: 204 }); });
    const session = createAnthropicClientSession({ enabled: true, clientVersion: "2.1.316", sdkVersion: "0.3.316", deviceId: "d", bodyPolicy: { system: { mode: "sdk" } } });
    const req = session.request({ fetchImpl: transport, bodyPolicy: { system: { mode: "sdk-append" }, betas: { allowed: ["example-beta"] } } });
    await req.fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "anthropic-beta": "existing" }, body: JSON.stringify({ model: "test", messages: [], system: "app" }) });
    expect(JSON.parse(String(calls[0].body)).system[0].text).toContain("running within the Claude Agent SDK");
    expect(new Headers(calls[0].headers).get("anthropic-beta")).toBe("existing,example-beta");
    await session.close();
    const disabled = createAnthropicClientSession();
    expect(disabled.request({ fetchImpl: transport }).fetch).toBe(transport);
  });
  it("rejects a fifth real breakpoint without counting tool input data", () => {
    const block = () => ({ type: "text", text: "x", cache_control: { type: "ephemeral" } });
    const input = { cache_control: { type: "ephemeral" }, system: [block()], tools: [{ name: "read", input_schema: { cache_control: { type: "ephemeral" } } }], messages: [{ role: "user", content: [block(), block(), { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }] }] };
    expect(() => applyAnthropicRequestPolicy(input, { cache: { setting: "5m", targets: [{ kind: "message", index: 0, block: 2 }] } })).toThrow(RangeError);
    delete (input as any).cache_control;
    const result = applyAnthropicRequestPolicy(input, { cache: { setting: "5m", targets: [{ kind: "message", index: 0, block: 2 }] } });
    expect((result.body.messages as any[])[0].content[2].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
    expect((input.messages[0].content[2] as any).cache_control).toBeUndefined();
  });
  it("rejects invalid explicit policy before transport and passes malformed JSON through", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const session = createAnthropicClientSession({ enabled: true, clientVersion: "2.1.316", sdkVersion: "0.3.316", deviceId: "d" });
    expect(() => session.request({ fetchImpl: transport, bodyPolicy: { thinking: { mode: "enabled", supported: true, budgetTokens: 0 } } })).toThrow();
    const req = session.request({ fetchImpl: transport, bodyPolicy: { thinking: { mode: "enabled", supported: true, budgetTokens: 1024 } } });
    expect(() => req.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ messages: [], max_tokens: 100 }) })).toThrow();
    expect(transport).not.toHaveBeenCalled();
    await req.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{" });
    expect(transport).toHaveBeenCalledOnce();
    await session.close();
  });

});
