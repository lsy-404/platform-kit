import type { BrowserResult, CheckId } from "./types.js";

export function inspectTypography(_enabled: CheckId[]): BrowserResult {
  return { findings: [], skipped: [] };
}

export async function inspectFonts(): Promise<BrowserResult> {
  return { findings: [], skipped: [] };
}
