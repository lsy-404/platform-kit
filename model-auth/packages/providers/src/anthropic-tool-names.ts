export interface AnthropicToolNameMapping {
  readonly current?: Readonly<Record<string, string>>;
  readonly retired?: Readonly<Record<string, string>>;
}

export interface AnthropicToolNameCodec {
  encodeRequest<T extends object>(request: T): T;
  decodeMessage<T extends object>(message: T): T;
  decodeStreamEvent<T extends object>(event: T): T;
}

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const validName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Translate explicit tool names for one conversation. */
export function createAnthropicToolNameCodec(mapping: AnthropicToolNameMapping = {}): AnthropicToolNameCodec {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  const history = new Map<string, { internal: string; wire: string }>();
  for (const [internal, wire] of Object.entries(mapping.current ?? {})) {
    if (!validName(internal) || !validName(wire) || reverse.has(wire)) throw new TypeError("Invalid or colliding tool name mapping");
    forward.set(internal, wire);
    reverse.set(wire, internal);
  }
  for (const [wire, internal] of Object.entries(mapping.retired ?? {})) {
    if (!validName(wire) || !validName(internal) || (reverse.has(wire) && reverse.get(wire) !== internal)) throw new TypeError("Invalid or colliding retired tool name mapping");
    reverse.set(wire, internal);
  }
  for (const [wire, internal] of reverse) {
    if (forward.has(wire) && wire !== internal) throw new TypeError("Ambiguous tool name mapping");
  }
  for (const [internal, wire] of forward) {
    if (reverse.has(internal) && reverse.get(internal) !== internal) throw new TypeError("Ambiguous tool name mapping");
    if (forward.has(wire) && forward.get(wire) !== wire) throw new TypeError("Ambiguous tool name mapping");
  }
  const encodeName = (value: unknown): unknown => typeof value === "string" ? forward.get(value) ?? value : value;
  const encodeTree = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(encodeTree);
    if (!isObject(value)) return value;
    const out: ObjectValue = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = key === "input" || key === "input_schema" ? entry : key === "exclude_tools" && Array.isArray(entry) ? entry.map(encodeName) : encodeTree(entry);
    }
    if (value.type === "tool_use") {
      const remembered = typeof value.id === "string" ? history.get(value.id) : undefined;
      out.name = remembered && remembered.internal === value.name ? remembered.wire : encodeName(value.name);
    } else if (value.type === "tool_reference") {
      if ("name" in value) out.name = encodeName(value.name);
      if ("tool_name" in value) out.tool_name = encodeName(value.tool_name);
    } else if (value.type === "tool_definition" && isObject(out.definition)) {
      out.definition = { ...out.definition, name: encodeName(out.definition.name) };
    }
    return out;
  };
  const decodeBlock = (value: unknown): unknown => {
    if (!isObject(value) || value.type !== "tool_use" || typeof value.name !== "string") return value;
    const internal = reverse.get(value.name);
    if (internal === undefined) return { ...value };
    if (typeof value.id === "string") history.set(value.id, { internal, wire: value.name });
    return { ...value, name: internal };
  };
  return {
    encodeRequest<T extends object>(request: T): T {
      const source = request as ObjectValue;
      const out: ObjectValue = { ...source };
      if (Array.isArray(source.tools)) out.tools = source.tools.map(tool => isObject(tool) && typeof tool.name === "string" ? { ...tool, name: encodeName(tool.name) } : tool);
      if (isObject(source.tool_choice) && typeof source.tool_choice.name === "string") out.tool_choice = { ...source.tool_choice, name: encodeName(source.tool_choice.name) };
      if (Array.isArray(source.messages)) out.messages = source.messages.map(message => isObject(message) && Array.isArray(message.content) ? { ...message, content: encodeTree(message.content) } : message);
      if (source.context_management != null) out.context_management = encodeTree(source.context_management);
      return out as T;
    },
    decodeMessage<T extends object>(message: T): T {
      const source = message as ObjectValue;
      return { ...source, ...(Array.isArray(source.content) ? { content: source.content.map(decodeBlock) } : {}) } as T;
    },
    decodeStreamEvent<T extends object>(event: T): T {
      const source = event as ObjectValue;
      return { ...source, ...(source.type === "content_block_start" ? { content_block: decodeBlock(source.content_block) } : {}) } as T;
    },
  };
}
