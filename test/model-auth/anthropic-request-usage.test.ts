import { describe, expect, it } from "vitest";
import { normalizeAnthropicRequestUsage } from "../../model-auth/packages/providers/src/anthropic.js";

describe("Anthropic request usage", () => {
  it("keeps missing cache subdivisions unknown and does not count them twice", () => {
    expect(normalizeAnthropicRequestUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 9,
      cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 5 },
    })).toEqual({ input: 12, output: 7, cacheRead: 5, cacheWrite: 9, cacheWrite5m: 4, cacheWrite1h: 5 });
    expect(normalizeAnthropicRequestUsage({ input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 8 }))
      .toEqual({ input: 2, output: 3, cacheWrite: 8 });
    expect(normalizeAnthropicRequestUsage({ cache_creation: { ephemeral_5m_input_tokens: 2 } }))
      .toEqual({ cacheWrite5m: 2 });
    expect(normalizeAnthropicRequestUsage({ cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 } }))
      .toEqual({ cacheWrite: 5, cacheWrite5m: 2, cacheWrite1h: 3 });
  });

});
