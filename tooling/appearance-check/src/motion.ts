import type { Browser } from "playwright";
import { installKit } from "./kit.js";
import { settlePage } from "./reflow.js";
import type { PageEntry, ProbeOptions } from "./reflow.js";
import type { BrowserResult, ColorScheme, RawFinding, Viewport } from "./types.js";

export function inspectMotion(): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const MOTION = new Set(["transform", "translate", "rotate", "scale", "left", "top", "right", "bottom", "inset", "offsetDistance", "backgroundPosition"]);
  const NON_PROPERTY = new Set(["offset", "easing", "composite", "computedOffset"]);
  const seen = new Set<Element>();
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (animation.playState !== "running" || animation instanceof CSSTransition || !(effect instanceof KeyframeEffect)) continue;
    const target = effect.target;
    if (!target || seen.has(target) || !kit.visible(target) || kit.decorative(target)) continue;
    const keyframes = effect.getKeyframes();
    const properties = new Set<string>();
    for (const keyframe of keyframes) for (const key of Object.keys(keyframe)) if (!NON_PROPERTY.has(key)) properties.add(key);
    const motion = [...properties].filter(property => MOTION.has(property));
    if (!motion.length) continue;
    const timing = effect.getComputedTiming();
    const activeDuration = Number(timing.activeDuration);
    if (!(timing.iterations === Infinity || activeDuration > 5000)) continue;
    const rect = target.getBoundingClientRect();
    const rotateOnly = motion.every(property => property === "transform" || property === "rotate")
      && keyframes.every(keyframe => {
        const transform = (keyframe as Record<string, unknown>).transform;
        return transform === undefined || transform === null || /^(none|rotate\([^)]*\))$/.test(String(transform).trim());
      });
    const spinner = target.closest('[role=progressbar],[aria-busy=true],[role=status]') !== null || rect.width <= 48 && rect.height <= 48 && rotateOnly;
    if (spinner) continue;
    seen.add(target);
    const named = animation as Animation & { animationName?: string };
    findings.push({
      checkId: "AP017", target: kit.selector(target),
      message: "Auto-started motion lasting over 5 s keeps running with prefers-reduced-motion: reduce.",
      confidence: "heuristic",
      evidence: { animationName: named.animationName ?? (animation.id || "web-animation"), properties: motion, iterations: timing.iterations === Infinity ? "Infinity" : timing.iterations, activeDuration: Number.isFinite(activeDuration) ? activeDuration : "Infinity", pseudoElement: effect.pseudoElement },
    });
  }
  return { findings, skipped: [] };
}

export async function probeMotion(browser: Browser, url: string, viewport: Viewport, scheme: ColorScheme, opts: ProbeOptions = {}): Promise<{ result: BrowserResult; page: PageEntry }> {
  const timeout = opts.timeoutMs ?? 15000;
  const entry: PageEntry = { page: url, viewport, colorScheme: scheme, kind: "motion", controls: 0 };
  const result: BrowserResult = { findings: [], skipped: [] };
  const context = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce", deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const response = await page.goto(url, { waitUntil: "load" });
    if (response && response.status() >= 400) throw new Error("HTTP " + response.status());
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 2000) }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await settlePage(page);
    await page.waitForTimeout(500);
    await page.evaluate(installKit);
    const motion = await page.evaluate(inspectMotion);
    result.findings.push(...motion.findings);
    result.skipped.push(...motion.skipped);
  } catch (error) {
    result.skipped.push({ checkId: "AP017", target: "document", reason: String(error) });
  } finally {
    await context.close();
  }
  return { result, page: entry };
}
