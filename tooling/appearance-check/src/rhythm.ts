import type { BrowserResult, CheckId } from "./types.js";

export function inspectRhythm(_enabled: CheckId[]): BrowserResult {
  return { findings: [], skipped: [] };
}
