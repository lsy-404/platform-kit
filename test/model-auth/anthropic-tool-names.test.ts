import { describe, expect, it } from "vitest";
import { createAnthropicToolNameCodec } from "../../model-auth/packages/providers/src/anthropic.js";

describe("Anthropic tool name codec", () => {
  it("translates protocol references without touching parameters or text", () => {
    const codec = createAnthropicToolNameCodec({ current: { mcp__local__read: "mcp__remote__read" } });
    const input = { name: "mcp__local__read", nested: { type: "tool_reference", name: "mcp__local__read" } };
    const request = { tools: [{ name: "mcp__local__read", input_schema: input }], tool_choice: { type: "tool", name: "mcp__local__read" }, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "one", name: "mcp__local__read", input }, { type: "tool_reference", name: "mcp__local__read", tool_name: "mcp__local__read" }, { type: "tool_definition", definition: { name: "mcp__local__read", input_schema: input } }, { type: "text", text: "mcp__local__read" }] }], context_management: { edits: [{ exclude_tools: ["mcp__local__read", "other"] }] } };
    const result = codec.encodeRequest(request);
    expect(result.tools[0].name).toBe("mcp__remote__read");
    expect(result.tool_choice.name).toBe("mcp__remote__read");
    expect(result.messages[0].content).toEqual([{ type: "tool_use", id: "one", name: "mcp__remote__read", input }, { type: "tool_reference", name: "mcp__remote__read", tool_name: "mcp__remote__read" }, { type: "tool_definition", definition: { name: "mcp__remote__read", input_schema: input } }, { type: "text", text: "mcp__local__read" }]);
    expect(result.context_management.edits[0].exclude_tools).toEqual(["mcp__remote__read", "other"]);
    expect(request.tools[0].name).toBe("mcp__local__read");
  });
  it("decodes responses and remembers the wire name for historical calls", () => {
    const codec = createAnthropicToolNameCodec({ current: { local: "new" }, retired: { old: "local" } });
    const message = { content: [{ type: "tool_use", id: "one", name: "old", input: { name: "old" } }] };
    const decoded = codec.decodeMessage(message);
    expect(decoded.content[0]).toEqual({ type: "tool_use", id: "one", name: "local", input: { name: "old" } });
    expect(message.content[0].name).toBe("old");
    const event = { type: "content_block_start", content_block: { type: "tool_use", id: "two", name: "new", input: {} } };
    expect(codec.decodeStreamEvent(event).content_block.name).toBe("local");
    const delta = { type: "content_block_delta", delta: { partial_json: '"new"' } };
    expect(codec.decodeStreamEvent(delta)).toEqual(delta);
    const request = { messages: [{ content: [decoded.content[0], { ...decoded.content[0], id: "two" }, { ...decoded.content[0], id: "three" }] }] };
    expect(codec.encodeRequest(request).messages[0].content.map(block => block.name)).toEqual(["old", "new", "new"]);
  });
  it("supports one-hop chained mappings and preserves JSON metadata", () => {
    const codec = createAnthropicToolNameCodec({ current: { a: "b", b: "c" } });
    const metadata = JSON.parse('{"__proto__":{"name":"a"},"input_schema":{"__proto__":{"name":"a"}}}');
    const request = { tools: [{ name: "a" }, { name: "b" }], messages: [{ content: [{ type: "tool_use", id: "one", name: "a", input: {} }, { type: "metadata", metadata }] }] };
    const encoded = codec.encodeRequest(request);
    expect(encoded.tools.map(tool => tool.name)).toEqual(["b", "c"]);
    expect(codec.decodeMessage({ content: [{ type: "tool_use", id: "one", name: "b" }, { type: "tool_use", id: "two", name: "c" }] }).content.map(block => block.name)).toEqual(["a", "b"]);
    const actual = encoded.messages[0].content[1].metadata as typeof metadata;
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
    expect(Object.hasOwn(actual, "__proto__")).toBe(true);
    expect(actual.__proto__).toEqual({ name: "a" });
    expect(actual.input_schema).toBe(metadata.input_schema);
    expect(Object.hasOwn(actual.input_schema, "__proto__")).toBe(true);
    expect(metadata.__proto__.name).toBe("a");
  });
  it("rejects declared names that cannot be reversed safely", () => {
    const codec = createAnthropicToolNameCodec({ current: { a: "b" }, retired: { old: "a" } });
    expect(() => codec.encodeRequest({ tools: [{ name: "a" }, { name: "b" }] })).toThrow();
    expect(() => codec.encodeRequest({ tools: [{ name: "b" }] })).toThrow();
    expect(() => codec.encodeRequest({ tools: [{ name: "old" }] })).toThrow();
    expect(codec.encodeRequest({ tools: [{ name: "a" }, { name: "unrelated" }] }).tools.map(tool => tool.name)).toEqual(["b", "unrelated"]);
    expect(codec.encodeRequest({ messages: [] })).toEqual({ messages: [] });
    const chain = createAnthropicToolNameCodec({ current: { a: "b", b: "c" } });
    expect(chain.encodeRequest({ tools: [{ name: "a" }, { name: "b" }] }).tools.map(tool => tool.name)).toEqual(["b", "c"]);
  });
  it("rejects invalid and ambiguous mappings and leaves unknown names alone", () => {
    expect(() => createAnthropicToolNameCodec({ current: { a: "same", b: "same" } })).toThrow();
    expect(() => createAnthropicToolNameCodec({ retired: { "bad name": "a" } })).toThrow();
    expect(() => createAnthropicToolNameCodec({ current: { a: "b" }, retired: { b: "c" } })).toThrow();
    const request = { tools: [{ name: "unknown" }], messages: [{ content: [{ type: "tool_use", name: "unknown" }] }] };
    expect(createAnthropicToolNameCodec().encodeRequest(request)).toEqual(request);
  });
});
