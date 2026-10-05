import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import type { BrowserResult, RawFinding, State } from "./types.js";

type AxeNode = {
  target: string[][];
  failureSummary?: string;
  any: Array<{ data?: Record<string, unknown>; message?: string }>;
};

function selectorFor(node: AxeNode): string | undefined {
  const selectors = node.target.flat().filter(Boolean);
  if (selectors.length !== 1) return undefined;
  return selectors[0];
}

function parseRatio(summary: string): number | undefined {
  const match = summary.match(/([\d.]+)\s*:\s*1/);
  return match ? Number(match[1]) : undefined;
}

export async function inspectColors(page: Page, state: State, target?: string): Promise<BrowserResult> {
  if (state === "default" && target) return { findings: [], skipped: [] };
  if (state !== "default" && !target) return { findings: [], skipped: [] };

  const builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (target) builder.include(target);
  const results = await builder.analyze();
  const findings: RawFinding[] = [];
  const seen = new Set<string>();

  for (const violation of results.violations.filter(item => item.id === "color-contrast")) {
    for (const node of violation.nodes as unknown as AxeNode[]) {
      const selector = selectorFor(node);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      const summary = node.failureSummary ?? node.any.map(check => check.message).filter(Boolean).join(" ");
      const ratio = parseRatio(summary);
      findings.push({
        checkId: state === "default" ? "AP001" : "AP002",
        target: selector,
        message: state === "default" ? "Visible text does not meet its contrast requirement." : `Visible text does not meet its contrast requirement in ${state} state.`,
        confidence: "measured",
        evidence: { state, ...(ratio === undefined ? {} : { contrastRatio: ratio }), failureSummary: summary },
      });
    }
  }

  const skipped = results.incomplete
    .filter(item => item.id === "color-contrast")
    .flatMap(item => (item.nodes as unknown as AxeNode[]).flatMap(node => {
      const selector = selectorFor(node);
      return selector ? [{ checkId: state === "default" ? "AP001" as const : "AP002" as const, target: selector, reason: "Axe could not determine the rendered text or background colors reliably." }] : [];
    }));

  return { findings, skipped };
}
