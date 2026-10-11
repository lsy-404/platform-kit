import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AxeResults, RunOptions } from "axe-core";
import type { Page } from "playwright";
import type { BrowserResult, CheckId, RawFinding, Skipped, State } from "./types.js";

export type { AxeResults };

interface AxeCheck { data?: unknown; message?: string }
interface AxeNode {
  target: unknown[];
  failureSummary?: string;
  any: AxeCheck[];
  all?: AxeCheck[];
  none?: AxeCheck[];
}

const axeHandle = "__appearanceCheckAxe";
let axeSource: Promise<string> | undefined;

// Navigation discards the injected copy, so presence is checked on every run.
async function ensureAxe(page: Page): Promise<void> {
  if (await page.evaluate(key => key in globalThis, axeHandle)) return;
  axeSource ??= readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  await page.evaluate(`${await axeSource};globalThis.${axeHandle}=globalThis.axe;undefined`);
}

// Iframe contents are reported as an out-of-scope coverage gap, so frames are not messaged.
export async function runAxe(page: Page, rules: string[], include?: string): Promise<AxeResults> {
  await ensureAxe(page);
  const options: RunOptions = { runOnly: { type: "rule", values: rules }, iframes: false };
  return page.evaluate(({ key, include, options }) => {
    const axe = (globalThis as unknown as Record<string, typeof import("axe-core")>)[key]!;
    return axe.run(include ? { include: [include] } : document, options);
  }, { key: axeHandle, include, options });
}

const incompleteReasons: Record<string, string> = {
  bgImage: "background image",
  bgGradient: "background gradient",
  imgNode: "image element",
  bgOverlap: "overlapped by another element",
  fgAlpha: "translucent text",
  elmPartiallyObscured: "partially obscured",
  elmPartiallyObscuring: "partially overlapping other elements",
  pseudoContent: "pseudo-element content",
  shadowOutlineEmMax: "text shadow or outline",
};

const multiPartReason = "Axe returned a multi-part target that cannot be represented as one unique CSS selector.";

function selectorFor(node: AxeNode): string | undefined {
  const selectors = node.target.flat().filter(Boolean);
  return selectors.length === 1 && typeof selectors[0] === "string" ? selectors[0] : undefined;
}

function allChecks(node: AxeNode): AxeCheck[] {
  return [...node.any, ...(node.all ?? []), ...(node.none ?? [])];
}

function mergedData(node: AxeNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { data } of allChecks(node)) {
    if (data !== null && typeof data === "object" && !Array.isArray(data)) Object.assign(out, data);
    else if (data !== undefined && data !== null) out.value = data;
  }
  return out;
}

function summaryFor(node: AxeNode): string {
  return node.failureSummary ?? allChecks(node).map(check => check.message).filter(Boolean).join(" ");
}

function messageKey(node: AxeNode): string | undefined {
  const key = mergedData(node).messageKey;
  return typeof key === "string" ? key : undefined;
}

function nodesOf(list: AxeResults["violations"], rule: string): AxeNode[] {
  return list.filter(item => item.id === rule).flatMap(item => item.nodes as unknown as AxeNode[]);
}

function incompleteGaps(results: AxeResults, rule: string, checkId: CheckId, describe: (key: string | undefined) => string): Skipped[] {
  return nodesOf(results.incomplete, rule).map(node => {
    const selector = selectorFor(node);
    return { checkId, target: selector ?? "document", reason: selector ? describe(messageKey(node)) : multiPartReason };
  });
}

export function axeResult(results: AxeResults, rule: string, checkId: CheckId, message: string): BrowserResult {
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  for (const violation of results.violations.filter(item => item.id === rule)) {
    for (const node of violation.nodes as unknown as AxeNode[]) {
      const selector = selectorFor(node);
      if (!selector) {
        skipped.push({ checkId, target: "document", reason: multiPartReason });
        continue;
      }
      if (seen.has(selector)) continue;
      seen.add(selector);
      findings.push({
        checkId,
        target: selector,
        message,
        confidence: "measured",
        evidence: { rule, impact: violation.impact ?? null, failureSummary: summaryFor(node), data: mergedData(node) },
      });
    }
  }
  skipped.push(...incompleteGaps(results, rule, checkId, key => `Axe could not determine ${rule}${key ? ` (${incompleteReasons[key] ?? key})` : ""}.`));
  return { findings, skipped };
}

function merge(...parts: BrowserResult[]): BrowserResult {
  return { findings: parts.flatMap(part => part.findings), skipped: parts.flatMap(part => part.skipped) };
}

// Text whose foreground and background are exactly equal is invisible, but axe reports it as incomplete.
async function sameColorEvidence(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
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
}

const colorEvidenceKeys = ["contrastRatio", "fgColor", "bgColor", "expectedContrastRatio", "fontSize", "fontWeight"];

export async function colorContrastResult(page: Page, results: AxeResults, state: State, target?: string): Promise<BrowserResult> {
  const checkId: CheckId = state === "default" ? "AP001" : "AP002";
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  const uncertain = new Set<string>();

  for (const node of nodesOf(results.violations, "color-contrast")) {
    const selector = selectorFor(node);
    if (!selector) {
      skipped.push({ checkId, target: target ?? "document", reason: multiPartReason });
      continue;
    }
    if (seen.has(selector)) continue;
    seen.add(selector);
    const data = mergedData(node);
    const evidence: Record<string, unknown> = { state, failureSummary: summaryFor(node) };
    for (const key of colorEvidenceKeys) if (data[key] !== undefined) evidence[key] = data[key];
    if (typeof data.expectedContrastRatio === "number" || typeof data.expectedContrastRatio === "string") {
      const required = Number.parseFloat(String(data.expectedContrastRatio));
      evidence.requiredRatio = required;
      evidence.largeText = required === 3;
      if (typeof data.contrastRatio === "number") evidence.margin = Math.round((required - data.contrastRatio) * 100) / 100;
    }
    findings.push({
      checkId,
      target: selector,
      message: state === "default" ? "Visible text does not meet its contrast requirement." : `Visible text does not meet its contrast requirement in ${state} state.`,
      confidence: "measured",
      evidence,
    });
  }

  for (const node of nodesOf(results.incomplete, "color-contrast")) {
    const selector = selectorFor(node);
    const key = messageKey(node);
    if (selector && key === "equalRatio") uncertain.add(selector);
    skipped.push({
      checkId,
      target: selector ?? target ?? "document",
      reason: selector ? `Axe could not determine colors${key ? ` (${incompleteReasons[key] ?? key})` : ""}.` : multiPartReason,
    });
  }

  for (const candidate of uncertain) {
    if (seen.has(candidate)) continue;
    const equality = await sameColorEvidence(page, candidate);
    if (!equality) continue;
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
  return { findings, skipped };
}

const defaultRules: Array<{ checkId: CheckId; rule: string; message: string }> = [
  { checkId: "AP001", rule: "color-contrast", message: "" },
  { checkId: "AP009", rule: "link-in-text-block", message: "Link in text is distinguished from surrounding text by color alone." },
  { checkId: "AP010", rule: "target-size", message: "Pointer target is smaller than 24×24 CSS px without enough spacing." },
];

const documentRules: Array<{ checkId: CheckId; rule: string; message: string }> = [
  { checkId: "AP011", rule: "meta-viewport", message: "Viewport meta prevents zooming to 200%." },
  { checkId: "AP018", rule: "heading-order", message: "Heading level skipped." },
  { checkId: "AP018", rule: "empty-heading", message: "Heading has no text." },
];

export async function inspectDefaultAxe(page: Page, enabled: CheckId[]): Promise<BrowserResult> {
  const active = defaultRules.filter(item => enabled.includes(item.checkId));
  if (!active.length) return { findings: [], skipped: [] };
  const results = await runAxe(page, active.map(item => item.rule));
  const parts: BrowserResult[] = [];
  for (const item of active) {
    parts.push(item.rule === "color-contrast" ? await colorContrastResult(page, results, "default") : axeResult(results, item.rule, item.checkId, item.message));
  }
  return merge(...parts);
}

export async function inspectDocumentAxe(page: Page, enabled: CheckId[]): Promise<BrowserResult> {
  const active = documentRules.filter(item => enabled.includes(item.checkId));
  if (!active.length) return { findings: [], skipped: [] };
  const results = await runAxe(page, active.map(item => item.rule));
  return merge(...active.map(item => axeResult(results, item.rule, item.checkId, item.message)));
}
