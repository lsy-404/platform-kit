import type { Page } from "playwright";
import { inspectLayout } from "./layout.js";
import { settlePage } from "./reflow.js";
import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

const OVERRIDE = "*:not(svg):not(svg *){line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p{margin-bottom:2em!important}";
const LAYOUT_CHECKS: CheckId[] = ["AP004", "AP005"];

interface Tracked { target: number | null; related: number | null; raw: RawFinding }
interface Baseline { inlineBlocked: Skipped[]; truncated: number[]; visibleOwners: Element[] }

declare global {
  // eslint-disable-next-line no-var
  var __textSpacing: { baseline: Baseline; observer: MutationObserver; mutated: Set<Element>; keys: Set<string> } | undefined;
}

// Resolves layout selectors to kit identities while the DOM is still in the state they were measured in.
function resolve(selectors: Array<string | undefined>): Array<number | null> {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  return selectors.map(selector => {
    if (!selector) return null;
    try {
      const element = document.querySelector(selector);
      return element ? kit.identity(element) : null;
    } catch { return null; }
  });
}

function begin(): { inlineBlocked: Skipped[] } {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const inlineBlocked: Skipped[] = [];
  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("[style]"))) {
    if (inlineBlocked.length >= 10) break;
    if (!kit.visible(element)) continue;
    if (["line-height", "letter-spacing", "word-spacing", "margin-bottom"].some(property => element.style.getPropertyPriority(property) === "important")) {
      inlineBlocked.push({ checkId: "AP015", target: kit.selector(element), reason: "Inline !important spacing blocks the override; not measured" });
    }
  }
  const truncatedNow = (): Element[] => {
    const result = new Set<Element>();
    for (const { owner } of kit.textRuns()) {
      let node: Element | null = owner;
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        const style = getComputedStyle(node);
        const clamp = parseInt(style.webkitLineClamp, 10) > 0;
        if (style.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth || clamp && node.scrollHeight > node.clientHeight) { result.add(node); break; }
        if (style.display !== "inline") break;
      }
    }
    return [...result];
  };
  globalThis.__textSpacing = {
    baseline: { inlineBlocked, truncated: truncatedNow().map(kit.identity), visibleOwners: [...new Set(kit.textRuns().map(run => run.owner))] },
    observer: new MutationObserver(records => { for (const record of records) globalThis.__textSpacing?.mutated.add(record.target as Element); }),
    mutated: new Set<Element>(),
    keys: new Set<string>(),
  };
  globalThis.__textSpacing.observer.observe(document.body, { childList: true, subtree: true });
  return { inlineBlocked };
}

function rememberBase(keys: string[]): void {
  const state = globalThis.__textSpacing;
  if (state) for (const key of keys) state.keys.add(key);
}

function judge(candidates: Array<{ target: number | null; related: number | null; checkId: string; clipped: boolean; targetSelector: string; relatedSelector?: string; evidence: Record<string, unknown> }>): { findings: RawFinding[]; mutated: Skipped[]; truncated: Skipped[] } {
  const kit = globalThis.__appearanceKit;
  const state = globalThis.__textSpacing;
  if (!kit || !state) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const elementOf = (selector: string | undefined): Element | null => {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch { return null; }
  };
  const icons = /\b(icons?|symbols?)\b/i;
  const ownersContain = (element: Element) => state.baseline.visibleOwners.some(owner => owner === element || element.contains(owner));
  const insideMutation = (element: Element) => [...state.mutated].some(node => node.contains(element));
  for (const candidate of candidates) {
    const key = `${candidate.checkId}|${candidate.target}|${candidate.related}`;
    if (state.keys.has(key)) continue;
    if (candidate.checkId === "AP005" && !candidate.clipped) continue;
    const target = elementOf(candidate.targetSelector);
    if (!target || !target.isConnected || !ownersContain(target) || insideMutation(target)) continue;
    const related = elementOf(candidate.relatedSelector);
    if (candidate.checkId === "AP004" && (!related || insideMutation(related))) continue;
    if ([target, related].some(element => element && (kit.decorative(element) || icons.test(getComputedStyle(element).fontFamily)))) continue;
    findings.push({ checkId: "AP015", target: candidate.targetSelector, ...(candidate.relatedSelector ? { related: candidate.relatedSelector } : {}), message: "Text is clipped or overlaps when WCAG text-spacing overrides are applied.", confidence: "measured", evidence: { kind: candidate.checkId === "AP004" ? "overlap" : "clipped", override: "WCAG 1.4.12", source: candidate.evidence } });
  }
  const baseTruncated = new Set(state.baseline.truncated);
  const truncatedElements = new Set<Element>();
  for (const { owner } of kit.textRuns()) {
    let node: Element | null = owner;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      const clamp = parseInt(style.webkitLineClamp, 10) > 0;
      if (style.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth || clamp && node.scrollHeight > node.clientHeight) { truncatedElements.add(node); break; }
      if (style.display !== "inline") break;
    }
  }
  const truncated = [...truncatedElements].filter(element => !baseTruncated.has(kit.identity(element)) && !insideMutation(element)).map(element => ({ target: kit.selector(element) }));
  const mutated = [...new Set([...state.mutated].filter(node => node.isConnected && state.baseline.visibleOwners.some(owner => node.contains(owner))).map(node => kit.selector(node)))].slice(0, 5);
  return {
    findings,
    mutated: mutated.map(target => ({ checkId: "AP015", target, reason: "Content re-rendered during override" })),
    truncated: truncated.map(item => ({ checkId: "AP015", target: item.target, reason: "Text truncated under override; full text must be available another way" })),
  };
}

function finish(): void {
  const state = globalThis.__textSpacing;
  state?.observer.disconnect();
  globalThis.__textSpacing = undefined;
}

async function identify(page: Page, layout: BrowserResult): Promise<Tracked[]> {
  const ids = await page.evaluate(resolve, layout.findings.flatMap(f => [f.target, f.related]));
  return layout.findings.map((raw, i) => ({ raw, target: ids[i * 2] ?? null, related: ids[i * 2 + 1] ?? null }));
}

export async function checkTextSpacing(page: Page): Promise<BrowserResult> {
  const skipped: Skipped[] = [];
  let style: Awaited<ReturnType<Page["addStyleTag"]>> | undefined;
  try {
    const started = await page.evaluate(begin);
    skipped.push(...started.inlineBlocked);
    const base = await identify(page, await page.evaluate(inspectLayout, LAYOUT_CHECKS));
    await page.evaluate(rememberBase, base.map(item => `${item.raw.checkId}|${item.target}|${item.related}`));
    style = await page.addStyleTag({ content: OVERRIDE });
    await page.evaluate(() => document.fonts.ready);
    await settlePage(page);
    const after = await identify(page, await page.evaluate(inspectLayout, LAYOUT_CHECKS));
    const verdict = await page.evaluate(judge, after.map(item => ({
      target: item.target, related: item.related, checkId: item.raw.checkId, clipped: item.raw.evidence.clipped === true,
      targetSelector: item.raw.target, relatedSelector: item.raw.related, evidence: item.raw.evidence,
    })));
    skipped.push(...verdict.mutated, ...verdict.truncated);
    return { findings: verdict.findings, skipped };
  } catch (error) {
    skipped.push({ checkId: "AP015", target: "document", reason: String(error) });
    return { findings: [], skipped };
  } finally {
    await style?.evaluate(node => (node as Element).remove()).catch(() => undefined);
    await page.evaluate(finish).catch(() => undefined);
    await settlePage(page).catch(() => undefined);
  }
}
