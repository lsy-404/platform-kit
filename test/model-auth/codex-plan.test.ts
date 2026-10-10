import { describe, expect, it } from "vitest";
import { normalizeCodexPlan } from "../../model-auth/packages/core/src/index.js";

describe("normalizeCodexPlan multipliers", () => {
  const cases: Array<[string, string, number | null]> = [
    ["pro", "pro", null],
    ["Pro", "pro", null],
    ["prolite", "pro", 5],
    ["pro_lite", "pro", 5],
    ["pro-lite", "pro", 5],
    ["Pro Lite", "pro", 5],
    ["pro_5x", "pro", 5],
    ["pro_10x", "pro", 10],
    ["pro-25x", "pro", 25],
    ["pro_10x_usage_based", "pro", 10],
    ["Pro-25x-Usage-Based", "pro", 25],
    ["go", "go", null],
    ["plus", "plus", null],
    ["team", "business", null],
    ["enterprise", "enterprise", null],
  ];
  for (const [input, plan, multiplier] of cases) {
    it(`maps ${input} to ${plan} with multiplier ${multiplier}`, () => {
      expect(normalizeCodexPlan(input)).toMatchObject({ plan, multiplier });
    });
  }

  it("leaves a nonsensical multiplier as an unknown plan name", () => {
    expect(normalizeCodexPlan("pro_0x")).toMatchObject({ plan: "pro_0x", multiplier: null });
    expect(normalizeCodexPlan("pro_101x")).toMatchObject({ plan: "pro_101x", multiplier: null });
    expect(normalizeCodexPlan("pro_0x_usage_based")).toMatchObject({ plan: "pro_0x_usage_based", multiplier: null });
    expect(normalizeCodexPlan("professional_10x")).toMatchObject({ plan: "professional_10x", multiplier: null });
  });

  it("still drops an email", () => {
    expect(normalizeCodexPlan("person@example.test")).toEqual({ plan: null, multiplier: null, tier: null });
  });
});
