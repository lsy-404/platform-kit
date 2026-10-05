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

function evidenceFor(node: AxeNode, state: State, summary: string): Record<string, unknown> {
  const data = node.any.find(check => check.data)?.data;
  const evidence: Record<string, unknown> = { state, failureSummary: summary };
  if (data) {
    for (const key of ["contrastRatio", "fgColor", "bgColor", "expectedContrastRatio", "fontSize", "fontWeight"]) {
      if (data[key] !== undefined) evidence[key] = data[key];
    }
  }
  return evidence;
}

export async function inspectColors(page: Page, state: State, target?: string): Promise<BrowserResult> {
  if (state !== "default" && !target) throw new TypeError(`A target is required for ${state} color inspection.`);

  const builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (target) builder.include(target);
  const results = await builder.analyze();
  const findings: RawFinding[] = [];
  const seen = new Set<string>();
  const skipped: BrowserResult["skipped"] = [];
  const uncertainTargets = new Set<string>();
  const checkId = state === "default" ? "AP001" as const : "AP002" as const;

  for (const violation of results.violations.filter(item => item.id === "color-contrast")) {
    for (const node of violation.nodes as unknown as AxeNode[]) {
      const selector = selectorFor(node);
      if (!selector) {
        skipped.push({ checkId, target: target ?? "document", reason: "Axe returned a multi-part target that cannot be represented as one unique CSS selector." });
        continue;
      }
      if (seen.has(selector)) continue;
      seen.add(selector);
      const summary = node.failureSummary ?? node.any.map(check => check.message).filter(Boolean).join(" ");
      findings.push({
        checkId,
        target: selector,
        message: state === "default" ? "Visible text does not meet its contrast requirement." : `Visible text does not meet its contrast requirement in ${state} state.`,
        confidence: "measured",
        evidence: evidenceFor(node, state, summary),
      });
    }
  }

  skipped.push(...results.incomplete
    .filter(item => item.id === "color-contrast")
    .flatMap(item => (item.nodes as unknown as AxeNode[]).flatMap(node => {
      const selector = selectorFor(node);
      if (selector) uncertainTargets.add(selector);
      return [{ checkId, target: selector ?? target ?? "document", reason: selector ? "Axe could not determine the rendered text or background colors reliably." : "Axe returned a multi-part target that cannot be represented as one unique CSS selector." }];
    })));

  if (target && !seen.has(target)) uncertainTargets.add(target);
  for (const candidate of uncertainTargets) {
    if (seen.has(candidate)) continue;
    const equality = await page.locator(candidate).evaluate(element => {
      if (!element.isConnected || element.closest(":disabled,[aria-disabled=true]") || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.getClientRects().length === 0) return null;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        if (!textNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        if (![...range.getClientRects()].some(rect => {
          let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
          for (let ancestor = textNode!.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
            if (style.overflowX !== "visible") { left = Math.max(left, box.left); right = Math.min(right, box.right); }
            if (style.overflowY !== "visible") { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
          }
          return right > left && bottom > top;
        })) continue;
        let current = textNode.parentElement;
        let foreground: string | undefined;
        while (current) {
          const style = getComputedStyle(current);
          foreground ??= style.color;
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 1) break;
          if (style.backgroundImage !== "none" || style.textShadow !== "none" || parseFloat(style.webkitTextStrokeWidth) > 0) break;
          const background = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/)?.[1];
          if (background) {
            const channels = background.split(/[\s,\/]+/).map(part => Number.parseFloat(part));
            const alpha = channels.length > 3 ? channels[3] ?? 1 : 1;
            if (alpha === 1) {
              if (foreground === style.backgroundColor) return { foreground, background: style.backgroundColor };
              break;
            }
            if (alpha > 0) break;
          }
          current = current.parentElement;
        }
      }
      return null;
    });
    if (equality) {
      for (let index = skipped.length - 1; index >= 0; index--) {
        if (skipped[index]?.target === candidate) skipped.splice(index, 1);
      }
      findings.push({
        checkId,
        target: candidate,
        message: state === "default" ? "Visible text has the same foreground and background color." : `Visible text has the same foreground and background color in ${state} state.`,
        confidence: "measured",
        evidence: { state, ...equality, contrastRatio: 1 },
      });
    }
  }

  return { findings, skipped };
}
