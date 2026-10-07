export type CheckId = "AP001" | "AP002" | "AP003" | "AP004" | "AP005" | "AP006" | "AP007" | "AP008";
export type State = "default" | "hover" | "focus";
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
  state: State;
}
export interface Ignore {
  checkId?: CheckId;
  page?: string;
  selector?: string;
  state?: State;
  reason: string;
}
export interface AuditOptions {
  urls: string[];
  checks?: CheckId[];
  viewports?: Viewport[];
  colorSchemes?: Array<"light" | "dark">;
  ignores?: Ignore[];
  executablePath?: string;
  maxControls?: number;
  timeoutMs?: number;
}
export interface Report {
  findings: Finding[];
  suppressed: Array<Finding & { reason: string }>;
  coverage: Array<{ page: string; viewport: Viewport; state: State; target: string; checkId?: CheckId; reason: string }>;
  pages: Array<{ page: string; viewport: Viewport; controls: number }>;
}
