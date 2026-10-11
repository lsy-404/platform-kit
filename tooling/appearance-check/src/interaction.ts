import type { Page } from "playwright";
import type { BrowserResult, CheckId, State } from "./types.js";

export interface Control {
  target: string;
  hoverTarget: string;
  colorTargets: string[];
}

export function discoverControls(): Control[] {
  return [];
}

export async function runInteractions(
  _page: Page,
  _controls: Control[],
  _options: { enabled: CheckId[]; maxControls: number },
  _add: (result: BrowserResult, state: State) => Promise<void>,
): Promise<void> {}
