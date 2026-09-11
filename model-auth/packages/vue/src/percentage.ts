export const DEFAULT_PERCENTAGE_PRECISION = 2;

/** -1 keeps the full meaningful decimal representation; non-negative values are fixed digits. */
export type PercentagePrecision = -1 | number;

export function normalizePercentagePrecision(value: unknown): number {
  if (value === -1) return -1;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100) return value;
  return DEFAULT_PERCENTAGE_PRECISION;
}

export function formatPercentage(value: number, precision: PercentagePrecision = DEFAULT_PERCENTAGE_PRECISION): string {
  const normalized = normalizePercentagePrecision(precision);
  if (normalized === -1) return String(value);
  return value.toFixed(normalized);
}
