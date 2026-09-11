import { describe, expect, it } from "vitest";
import { DEFAULT_PERCENTAGE_PRECISION, formatPercentage, normalizePercentagePrecision } from "../../model-auth/packages/vue/src/percentage";

describe("percentage formatting", () => {
  it("defaults to two decimal places", () => {
    expect(DEFAULT_PERCENTAGE_PRECISION).toBe(2);
    expect(formatPercentage(12.3456)).toBe("12.35");
  });

  it("supports integer and explicit precision", () => {
    expect(formatPercentage(12.3456, 0)).toBe("12");
    expect(formatPercentage(12.3456, 4)).toBe("12.3456");
  });

  it("keeps the meaningful value for -1 and rejects invalid precision", () => {
    expect(formatPercentage(12.3456, -1)).toBe("12.3456");
    expect(normalizePercentagePrecision(-2)).toBe(2);
    expect(normalizePercentagePrecision(2.5)).toBe(2);
    expect(normalizePercentagePrecision("2")).toBe(2);
  });
});
