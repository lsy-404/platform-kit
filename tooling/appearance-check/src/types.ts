export type CheckId =
  | "AP001" | "AP002" | "AP003" | "AP004" | "AP005" | "AP006" | "AP007" | "AP008"
  | "AP009" | "AP010" | "AP011" | "AP012" | "AP013" | "AP014" | "AP015" | "AP016"
  | "AP017" | "AP018" | "AP019" | "AP020" | "AP021" | "AP022" | "AP023" | "AP024"
  | "AP025" | "AP026" | "AP027" | "AP028" | "AP029" | "AP030" | "AP031" | "AP032"
  | "AP033" | "AP034";
export type Dimension = "accessibility" | "color" | "layout" | "typography";
export type Severity = "normative" | "advisory";
export type Verdict = "fail" | "warn" | "incomplete" | "pass" | "not-run";
export type Scope = "scan" | "viewport" | "scheme" | "document" | "probe";
export type GapLevel = "check" | "blocking" | "info";
export type ColorScheme = "light" | "dark";
export type State = "default" | "hover" | "focus";
export interface CheckInfo {
  id: CheckId;
  name: string;
  description: string;
  dimensions: readonly [Dimension, ...Dimension[]];
  severity: Severity;
  confidence: "measured" | "heuristic";
  scope: Scope;
  source: string;
  criterion?: string;
  /** Runs only when its prerequisite is supplied: a design baseline (AP033) or both light and dark scans (AP034). */
  requires?: "design" | "both-schemes";
}
export interface RawFinding {
  checkId: CheckId;
  target: string;
  related?: string;
  message: string;
  confidence: "measured" | "heuristic";
  evidence: Record<string, unknown>;
}
export interface Skipped {
  checkId: CheckId;
  target: string;
  reason: string;
}
export interface BrowserResult {
  findings: RawFinding[];
  skipped: Skipped[];
}
export interface Viewport { width: number; height: number }
export interface Finding extends RawFinding {
  page: string;
  viewport: Viewport;
  colorScheme: ColorScheme;
  state: State;
  severity: Severity;
  dimensions: Dimension[];
}
export interface CoverageGap {
  page: string;
  viewport: Viewport;
  colorScheme: ColorScheme;
  state: State;
  target: string;
  checkId?: CheckId;
  reason: string;
  level: GapLevel;
}
export interface DimensionSummary {
  dimension: Dimension;
  verdict: Verdict;
  conclusion: string;
  checks: CheckId[];
  counts: { normative: number; advisory: number; suppressed: number; gaps: number };
  byCheck: Array<{ checkId: CheckId; name: string; severity: Severity; findings: number; gaps: number }>;
  top: Array<{ checkId: CheckId; page: string; target: string; message: string }>;
  notes: string[];
}
export interface PaletteMetrics {
  neutral: number;
  chromatic: number;
  hueFamilies: Array<{ hue: number; colors: string[]; surfaceShare: number }>;
  surfaces: Array<{ color: string; share: number }>;
  text: Array<{ color: string; share: number }>;
}
export interface TypeMetrics {
  bodySize: number | null;
  sizes: Array<{ px: number; share: number }>;
  nearDuplicateSizes: Array<[number, number]>;
  families: Array<{ family: string; share: number; code: boolean }>;
  weights: Array<{ weight: number; share: number }>;
  smallTextShare: number;
}
export interface SpacingMetrics {
  samples: number;
  fit: { 2: number; 4: number; 8: number };
  baseUnit: 2 | 4 | 8 | null;
  distinct: number;
  offGrid: Array<{ px: number; count: number }>;
}
export interface PageMetrics {
  page: string;
  viewport: Viewport;
  colorScheme: ColorScheme;
  palette: PaletteMetrics;
  type: TypeMetrics;
  spacing: SpacingMetrics;
}
export interface Ignore {
  checkId?: CheckId;
  page?: string;
  selector?: string;
  state?: State;
  colorScheme?: ColorScheme;
  reason: string;
}
/** Token values a DESIGN.md front matter (or equivalent JSON) declares; lengths may be px, rem/em (16 px) or bare numbers. */
export interface DesignTokens {
  colors?: Record<string, string>;
  typography?: Record<string, { fontSize?: string | number; fontWeight?: string | number; [key: string]: unknown }>;
  rounded?: Record<string, string | number>;
  spacing?: Record<string, string | number>;
}
export interface AuditOptions {
  urls: string[];
  /** DESIGN.md / JSON file path or parsed tokens; enables AP033. */
  design?: string | DesignTokens;
  checks?: CheckId[];
  viewports?: Viewport[];
  colorSchemes?: ColorScheme[];
  ignores?: Ignore[];
  executablePath?: string;
  maxControls?: number;
  timeoutMs?: number;
}
export interface Report {
  verdict: Verdict;
  summary: DimensionSummary[];
  findings: Finding[];
  suppressed: Array<Finding & { reason: string }>;
  coverage: CoverageGap[];
  pages: Array<{ page: string; viewport: Viewport; colorScheme: ColorScheme; kind: "scan" | "reflow" | "motion"; controls: number }>;
  metrics: PageMetrics[];
}
