export { auditAppearance, validateOptions } from "./runner.js";
export { checks, checkInfo } from "./catalog.js";
export { summarize } from "./summary.js";
export { parseDesignMarkdown } from "./tokens.js";
export type {
  AuditOptions, BrowserResult, CheckId, CheckInfo, ColorScheme, CoverageGap, DesignTokens, Dimension, DimensionSummary, Finding, GapLevel, Ignore,
  PageMetrics, PaletteMetrics, RawFinding, Report, Scope, Severity, Skipped, SpacingMetrics, State, TypeMetrics, Verdict, Viewport,
} from "./types.js";
