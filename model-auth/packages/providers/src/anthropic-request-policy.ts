export type AnthropicCacheTarget =
  | { readonly kind: "system"; readonly index: number; readonly scope?: "global" }
  | { readonly kind: "tool"; readonly index: number; readonly scope?: "global" }
  | { readonly kind: "message"; readonly index: number; readonly block: number; readonly scope?: "global" };

export interface AnthropicRequestPolicy {
  readonly system?: { readonly mode: "sdk" | "sdk-append" | "interactive" | "recorded"; readonly recorded?: string };
  readonly thinking?: { readonly mode: "adaptive" | "enabled" | "disabled"; readonly supported: boolean; readonly budgetTokens?: number; readonly display?: "summarized" | "omitted"; readonly acceptsDisabled?: boolean };
  readonly supportsEffort?: boolean;
  readonly supportsContextManagement?: boolean;
  readonly cache?: { readonly force5m?: boolean; readonly environment?: "5m" | "1h"; readonly setting?: "5m" | "1h"; readonly frontmatter?: "5m" | "1h"; readonly subscriberEligible?: boolean; readonly targets?: readonly AnthropicCacheTarget[] };
  readonly betas?: { readonly allowed: readonly string[] };
}

const PREFIXES = ["You are a Claude agent, built on Anthropic's Claude Agent SDK.", "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.", "You are Claude Code, Anthropic's official CLI for Claude."] as const;
const obj = (v: unknown): Record<string, any> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : undefined;
const validIndex = (v: number) => Number.isSafeInteger(v) && v >= 0;

/** Applies only capabilities and cache locations supplied by the host. */
export function applyAnthropicRequestPolicy(input: Record<string, unknown>, policy: AnthropicRequestPolicy): { body: Record<string, unknown>; betas: string[] } {
  const body = structuredClone(input) as Record<string, any>;
  if (policy.system) {
    const { mode, recorded } = policy.system;
    const prefix = mode === "recorded" ? recorded : PREFIXES[mode === "sdk" ? 0 : mode === "sdk-append" ? 1 : 2];
    if (typeof prefix !== "string" || !prefix.trim()) throw new TypeError("A recorded system prefix is required.");
    const blocks = typeof body.system === "string" ? [{ type: "text", text: body.system }] : Array.isArray(body.system) ? body.system : [];
    const index = typeof blocks[0]?.text === "string" && blocks[0].text.startsWith("x-anthropic-billing-header:") ? 1 : 0;
    if (PREFIXES.includes(blocks[index]?.text) || blocks[index]?.text === prefix) blocks[index] = { ...blocks[index], text: prefix };
    else blocks.splice(index, 0, { type: "text", text: prefix });
    body.system = blocks;
  }
  const thinking = policy.thinking;
  if (thinking?.supported === false) delete body.thinking;
  if (thinking?.supported) {
    if (thinking.mode === "disabled") {
      if (thinking.acceptsDisabled === true) body.thinking = { type: "disabled" };
      else if (thinking.acceptsDisabled === false) delete body.thinking;
    } else if (thinking.mode === "adaptive") {
      body.thinking = { type: "adaptive", ...(thinking.display ? { display: thinking.display } : {}) };
    } else {
      const max = body.max_tokens;
      if (!Number.isSafeInteger(max) || max < 1025 || !Number.isSafeInteger(thinking.budgetTokens) || thinking.budgetTokens! <= 0) throw new TypeError("Enabled thinking requires a valid budget and max_tokens of at least 1025.");
      body.thinking = { type: "enabled", budget_tokens: Math.min(max - 1, Math.max(1024, thinking.budgetTokens!)), ...(thinking.display ? { display: thinking.display } : {}) };
    }
    if (body.thinking?.type === "adaptive" || body.thinking?.type === "enabled") {
      delete body.temperature;
      if (body.tool_choice?.type === "tool") body.tool_choice = { type: "auto" };
    }
  }
  if (policy.supportsEffort === false && obj(body.output_config)) {
    delete body.output_config.effort;
    if (!Object.keys(body.output_config).length) delete body.output_config;
  }
  if (policy.supportsContextManagement === false) delete body.context_management;
  else if (policy.supportsContextManagement === true && policy.betas?.allowed.includes("context-management-2025-06-27") && thinking?.supported && thinking.mode !== "disabled" && (body.thinking?.type === "enabled" || body.thinking?.type === "adaptive") && body.context_management === undefined) {
    body.context_management = { edits: [{ type: "clear_thinking_20251015", keep: "all" }] };
  }
  if (policy.cache) {
    const cache = policy.cache;
    const ttl = cache.force5m ? "5m" : cache.environment ?? cache.setting ?? cache.frontmatter ?? (cache.subscriberEligible === undefined ? undefined : cache.subscriberEligible ? "1h" : "5m");
    if (!ttl && cache.targets?.length) throw new TypeError("Cache targets require an explicit TTL policy.");
    if (ttl) for (const target of cache.targets ?? []) {
      if (!validIndex(target.index)) throw new TypeError("Invalid cache target.");
      let block: unknown;
      if (target.kind === "system") block = Array.isArray(body.system) ? body.system[target.index] : undefined;
      else if (target.kind === "tool") block = Array.isArray(body.tools) ? body.tools[target.index] : undefined;
      else if (validIndex(target.block) && Array.isArray(body.messages)) {
        const message = obj(body.messages[target.index]);
        block = Array.isArray(message?.content) ? message.content[target.block] : undefined;
      }
      const item = obj(block);
      const valid = item && (target.kind === "tool" ? typeof item.name === "string" : item.type === "text" ? typeof item.text === "string" && !!item.text.trim() : target.kind === "message" && ["image", "document", "tool_use", "tool_result"].includes(item.type));
      if (!valid) throw new TypeError("Invalid cache target.");
      item.cache_control = { type: "ephemeral", ...(ttl === "1h" ? { ttl } : {}), ...(target.scope === "global" ? { scope: "global" } : {}) };
    }
    const present = (value: unknown) => obj(value)?.cache_control != null ? 1 : 0;
    let count = body.cache_control != null ? 1 : 0;
    if (Array.isArray(body.system)) count += body.system.reduce((n: number, item: unknown) => n + present(item), 0);
    if (Array.isArray(body.tools)) count += body.tools.reduce((n: number, item: unknown) => n + present(item), 0);
    if (Array.isArray(body.messages)) for (const message of body.messages) {
      const content = obj(message)?.content;
      if (Array.isArray(content)) count += content.reduce((n: number, item: unknown) => n + present(item), 0);
    }
    if (count > 4) throw new RangeError("At most four cache breakpoints are allowed.");
  }
  return { body, betas: [...new Set(policy.betas?.allowed ?? [])].filter(beta => !(policy.supportsEffort === false && beta === "effort-2025-11-24") && !(policy.supportsContextManagement === false && beta === "context-management-2025-06-27")) };
}
