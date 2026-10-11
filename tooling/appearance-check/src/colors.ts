import type { Page } from "playwright";
import { colorContrastResult, runAxe } from "./axe.js";
import type { BrowserResult, State } from "./types.js";

export async function inspectColors(page: Page, state: State, target?: string): Promise<BrowserResult> {
  if (state !== "default" && !target) throw new TypeError(`A target is required for ${state} color inspection.`);
  return colorContrastResult(page, await runAxe(page, ["color-contrast"], target), state, target);
}
