import type { BrowserResult, Dimension, PageMetrics } from "./types.js";
import type { DesignSample } from "./design.js";

export function analyzeDesign(_sample: DesignSample): {
  drift: BrowserResult;
  metrics: Omit<PageMetrics, "page" | "viewport" | "colorScheme">;
  notes: Partial<Record<Dimension, string[]>>;
} {
  return {
    drift: { findings: [], skipped: [] },
    metrics: {
      palette: { neutral: 0, chromatic: 0, hueFamilies: [], surfaces: [], text: [] },
      type: { bodySize: null, sizes: [], nearDuplicateSizes: [], families: [], weights: [], smallTextShare: 0 },
      spacing: { samples: 0, fit: { 2: 0, 4: 0, 8: 0 }, baseUnit: null, distinct: 0, offGrid: [] },
    },
    notes: {},
  };
}
