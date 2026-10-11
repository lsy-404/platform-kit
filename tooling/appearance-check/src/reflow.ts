import type { Browser, Page } from "playwright";
import { installKit } from "./kit.js";
import { inspectLayout } from "./layout.js";
import type { BrowserResult, CheckId, ColorScheme, RawFinding, Report, Skipped } from "./types.js";

export type PageEntry = Report["pages"][number];
export interface ProbeOptions { timeoutMs?: number }

const VIEWPORT = { width: 320, height: 640 };

export function inspectReflow(): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const MESSAGE = "Content needs horizontal scrolling or is cut off at 320 CSS px.";
  const TWO_D = "table,[role=table],[role=grid],canvas,video,iframe,object,embed,map,[role=application],img,svg,picture,[role=img],pre";
  const root = document.documentElement;
  const scroller = document.scrollingElement ?? root;
  const vw = root.clientWidth;
  const docOverflow = scroller.scrollWidth - vw;
  const rootClips = [root, document.body].some(element => /^(hidden|clip)$/.test(getComputedStyle(element).overflowX));

  const culprits = new Map<Element, number>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || kit.srOnly(el) || kit.decorative(el)) continue;
    let skip = false;
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.position === "fixed" || node !== el && /^(auto|scroll)$/.test(style.overflowX)) { skip = true; break; }
    }
    if (skip || rect.right <= 0) continue;
    if (rect.left >= vw && rootClips) continue;
    const overshoot = Math.max(rect.right - vw, -rect.left);
    if (overshoot > 1) culprits.set(el, overshoot);
  }

  const topmost = [...culprits.keys()].filter(el => !el.parentElement || !culprits.has(el.parentElement));
  const twoD = topmost.filter(el => el.closest(TWO_D));
  const real = topmost.filter(el => !el.closest(TWO_D));
  const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  if ((docOverflow > 1 || rootClips) && real.length) {
    for (const el of real.sort((a, b) => culprits.get(b)! - culprits.get(a)!).slice(0, 10)) {
      findings.push({
        checkId: "AP014", target: kit.selector(el), message: MESSAGE, confidence: "measured",
        evidence: { kind: rootClips ? "cut-off" : "overflow", viewportWidth: vw, documentScrollWidth: scroller.scrollWidth, overshoot: culprits.get(el)!, rect: box(el.getBoundingClientRect()), rootClips },
      });
    }
  }
  for (const el of twoD.slice(0, 5)) skipped.push({ checkId: "AP014", target: kit.selector(el), reason: "Overflow from 2-D content (image, table, media, code); exception needs review" });
  return { findings, skipped };
}

function reflowMetrics(): { viewportWidth: number; documentScrollWidth: number; rootClips: boolean } {
  const root = document.documentElement;
  return {
    viewportWidth: root.clientWidth,
    documentScrollWidth: (document.scrollingElement ?? root).scrollWidth,
    rootClips: [root, document.body].some(element => /^(hidden|clip)$/.test(getComputedStyle(element).overflowX)),
  };
}

export async function settlePage(page: Page): Promise<void> {
  const delay = await page.evaluate(() => {
    let longest = 0;
    const milliseconds = (value: string) => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000));
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const durations = milliseconds(style.transitionDuration), delays = milliseconds(style.transitionDelay);
      for (let i = 0; i < durations.length; i++) longest = Math.max(longest, (durations[i] ?? 0) + (delays[i % delays.length] ?? 0));
    }
    return Math.min(2000, longest + 50);
  });
  await page.waitForTimeout(delay);
}

export async function probeReflow(browser: Browser, url: string, scheme: ColorScheme, opts: ProbeOptions = {}): Promise<{ result: BrowserResult; page: PageEntry }> {
  const timeout = opts.timeoutMs ?? 15000;
  const entry: PageEntry = { page: url, viewport: { ...VIEWPORT }, colorScheme: scheme, kind: "reflow", controls: 0 };
  const result: BrowserResult = { findings: [], skipped: [] };
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: scheme, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const response = await page.goto(url, { waitUntil: "load" });
    if (response && response.status() >= 400) throw new Error("HTTP " + response.status());
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 2000) }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await settlePage(page);
    await page.evaluate(installKit);
    const reflow = await page.evaluate(inspectReflow);
    result.findings.push(...reflow.findings);
    result.skipped.push(...reflow.skipped);
    const metrics = await page.evaluate(reflowMetrics);
    const layout = await page.evaluate(inspectLayout, ["AP005"] as CheckId[]);
    for (const finding of layout.findings) {
      if (finding.evidence.clipped !== true) continue;
      const container = finding.evidence.container as { x: number; y: number; width: number; height: number };
      const texts = (finding.evidence.textRects as Array<{ x: number; width: number }>) ?? [];
      const overshoot = Math.max(0, ...texts.map(rect => rect.x + rect.width - (container.x + container.width)));
      result.findings.push({ checkId: "AP014", target: finding.target, message: "Content needs horizontal scrolling or is cut off at 320 CSS px.", confidence: "measured", evidence: { kind: "clipped", ...metrics, overshoot, rect: container } });
    }
    for (const gap of layout.skipped) result.skipped.push({ ...gap, checkId: "AP014" });
  } catch (error) {
    result.skipped.push({ checkId: "AP014", target: "document", reason: String(error) });
  } finally {
    await context.close();
  }
  return { result, page: entry };
}
