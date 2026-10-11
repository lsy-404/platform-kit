import type { Page } from "playwright";
import { inspectColors } from "./colors.js";
import { comparePixels, helperPage } from "./pixels.js";
import type { BrowserResult, CheckId, RawFinding, Skipped, State } from "./types.js";

export interface Control {
  target: string;
  hoverTarget: string;
  colorTargets: string[];
}

export interface InteractionOptions {
  enabled: CheckId[];
  maxControls: number;
}

type Add = (result: BrowserResult, state: State) => Promise<void>;

// Page function: finds controls that start fully inside the viewport.
export function discoverControls(): Control[] {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const inView = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
  };
  return [...document.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[tabindex]")].flatMap(element => {
    if (element.matches(":disabled,[aria-disabled=true],[tabindex='-1']")) return [];
    const labels = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
      ? [...element.labels ?? []].filter(inView) : [];
    if (!element.checkVisibility({ checkVisibilityCSS: true }) || !inView(element) && !labels.length) return [];
    return [{ target: kit.selector(element), hoverTarget: kit.selector(labels[0] ?? element), colorTargets: (labels.length ? labels : [element]).map(kit.selector) }];
  });
}

interface FocusProbe {
  found: boolean;
  active: boolean;
  focusVisible: boolean;
  textEntry: boolean;
  rect: [number, number, number, number];
  scroll: [number, number];
  area: number;
  clip: { x: number; y: number; width: number; height: number };
  styles: string;
  outline: { style: string; width: string; color: string };
  boxShadow: string;
}

// Page function: geometry and the computed styles that could carry a focus indicator.
function probeFocus(target: string): FocusProbe {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const el = document.querySelector(target);
  const empty: FocusProbe = { found: false, active: false, focusVisible: false, textEntry: false, rect: [0, 0, 0, 0], scroll: [0, 0], area: 0, clip: { x: 0, y: 0, width: 0, height: 0 }, styles: "", outline: { style: "", width: "", color: "" }, boxShadow: "" };
  if (!el) return empty;
  const box = el.getBoundingClientRect();
  const labels = [...(el as HTMLInputElement).labels ?? []].filter(label => kit.visible(label));
  const siblings = [el.previousElementSibling, el.nextElementSibling].filter((sibling): sibling is Element => {
    if (!sibling || !kit.visible(sibling)) return false;
    const b = sibling.getBoundingClientRect();
    return Math.max(b.left - box.right, box.left - b.right, b.top - box.bottom, box.top - b.bottom) <= 16;
  });
  let left = box.left, top = box.top, right = box.right, bottom = box.bottom;
  for (const part of [...labels, ...siblings]) {
    const b = part.getBoundingClientRect();
    left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
  }
  const x0 = Math.max(0, Math.floor(left - 8)), y0 = Math.max(0, Math.floor(top - 8));
  const x1 = Math.min(innerWidth, Math.ceil(right + 8)), y1 = Math.min(innerHeight, Math.ceil(bottom + 8));
  const watched: Element[] = [el, ...labels, ...siblings];
  for (let ancestor = el.parentElement, i = 0; ancestor && i < 3; ancestor = ancestor.parentElement, i++) watched.push(ancestor);
  const properties = ["outline-style", "outline-width", "outline-color", "outline-offset", "box-shadow", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "background-color", "color", "text-decoration-line"];
  const styles = JSON.stringify(watched.map(part => { const s = getComputedStyle(part); return properties.map(p => s.getPropertyValue(p)); }));
  const own = getComputedStyle(el);
  const active = document.activeElement;
  const textLike = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement && ["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "week", "time"].includes(el.type) || el.matches("[contenteditable]:not([contenteditable=false])");
  return {
    found: true,
    active: active === el,
    focusVisible: active instanceof Element && active.matches(":focus-visible"),
    textEntry: textLike,
    rect: [box.left, box.top, box.width, box.height],
    scroll: [scrollX, scrollY],
    area: (right - left) * (bottom - top),
    clip: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) },
    styles,
    outline: { style: own.outlineStyle, width: own.outlineWidth, color: own.outlineColor },
    boxShadow: own.boxShadow,
  };
}

interface ObscuredResult {
  outcome: "ok" | "gap" | "finding";
  reason?: string;
  evidence?: Record<string, unknown>;
  related?: string;
}

// Page function: a control is obscured only when every sampled point is covered by opaque fixed or sticky content.
function focusObscured(target: string): ObscuredResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const el = document.querySelector(target);
  if (!el) return { outcome: "ok" };
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return { outcome: "ok" };
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return { outcome: "gap", reason: "Focused control is outside the viewport" };
  const inset = Math.min(2, r.width / 4, r.height / 4);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max - 0.01);
  const points: Array<[number, number]> = [
    [r.left + r.width / 2, r.top + r.height / 2], [r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset],
  ].map(([x, y]) => [clamp(x!, innerWidth), clamp(y!, innerHeight)]);
  const labels = [...(el as HTMLInputElement).labels ?? []];
  let modalSelector = ":modal, [aria-modal=true], [popover=auto]:popover-open";
  try { document.querySelector(modalSelector); } catch { modalSelector = "[aria-modal=true]"; }
  const samples: Array<{ x: number; y: number; obscuredBy: string | null }> = [];
  let first: { element: Element; position: string } | undefined;
  for (const [x, y] of points) {
    const top = document.elementsFromPoint(x, y)[0];
    let blocker: { element: Element; position: string } | undefined;
    const own = !top || el.contains(top) || top.contains(el) || labels.some(label => label.contains(top));
    if (!own) {
      let anchor: Element | null = null;
      for (let node: Element | null = top; node; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") { anchor = node; break; }
      }
      if (anchor && !anchor.closest(modalSelector)) {
        let opaque = kit.effectiveOpacity(top) >= 0.99, painted = false;
        for (let node: Element | null = top; node; node = node.parentElement) {
          if (/^(IMG|VIDEO|CANVAS)$/.test(node.tagName) || kit.rgba(getComputedStyle(node).backgroundColor)[3] >= 0.99) painted = true;
          if (node === anchor) break;
        }
        if (opaque && painted) blocker = { element: top, position: getComputedStyle(anchor).position };
      }
    }
    samples.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, obscuredBy: blocker ? kit.selector(blocker.element) : null });
    first ??= blocker;
  }
  if (!samples.every(sample => sample.obscuredBy) || !first) return { outcome: "ok" };
  return {
    outcome: "finding",
    related: kit.selector(first.element),
    evidence: { controlRect: { x: r.left, y: r.top, width: r.width, height: r.height }, points: samples, obscurer: kit.selector(first.element), obscurerPosition: first.position },
  };
}

async function settle(page: Page): Promise<void> {
  const delay = await page.evaluate(() => {
    let longest = 0;
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const milliseconds = (value: string) => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000));
      const durations = milliseconds(style.transitionDuration), delays = milliseconds(style.transitionDelay);
      for (let i = 0; i < durations.length; i++) longest = Math.max(longest, (durations[i] ?? 0) + (delays[i % delays.length] ?? 0));
    }
    return Math.min(2000, longest + 50);
  });
  await page.waitForTimeout(delay);
}

async function reset(page: Page, scroll: [number, number]): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(([x, y]) => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(x, y); }, scroll);
}

export async function runInteractions(page: Page, controls: Control[], options: InteractionOptions, add: Add): Promise<void> {
  const { enabled } = options;
  const colors = enabled.includes("AP002"), visible = enabled.includes("AP012"), obscured = enabled.includes("AP013");
  const focusChecks = (["AP002", "AP012", "AP013"] as const).filter(id => enabled.includes(id));
  if (!focusChecks.length) return;
  const gaps = (state: State, target: string, reason: string, ids: readonly CheckId[] = focusChecks): Promise<void> =>
    add({ findings: [], skipped: ids.map((checkId): Skipped => ({ checkId, target, reason })) }, state);

  if (controls.length > options.maxControls) {
    await gaps("focus", "document", `Control limit reached; ${controls.length - options.maxControls} control(s) were not inspected`);
  }

  const scroll = await page.evaluate((): [number, number] => [window.scrollX, window.scrollY]);
  for (const { target, hoverTarget, colorTargets } of controls.slice(0, options.maxControls)) {
    const control = page.locator(target);
    if (colors) {
      try {
        await reset(page, scroll);
        await page.locator(hoverTarget).hover({ timeout: 2000 });
        await settle(page);
        for (const colorTarget of colorTargets) await add(await inspectColors(page, "hover", colorTarget), "hover");
      } catch (error) {
        await gaps("hover", target, String(error), ["AP002"]);
      }
    }
    try {
      await reset(page, scroll);
      await settle(page);
      let before: { image: string; probe: FocusProbe } | undefined;
      if (visible) {
        const probe = await page.evaluate(probeFocus, target);
        if (probe.area < 4 || probe.clip.width < 1 || probe.clip.height < 1) await gaps("focus", target, "No visible region to compare", ["AP012"]);
        else before = { probe, image: (await page.screenshot({ clip: probe.clip, animations: "disabled", caret: "hide", scale: "css" })).toString("base64") };
      }
      await page.keyboard.press("Shift");
      await control.focus({ timeout: 2000 });
      await settle(page);
      const after = await page.evaluate(probeFocus, target);
      const focused = after.found && after.active;

      if (obscured) {
        if (!focused) await gaps("focus", target, "Focus moved elsewhere", ["AP013"]);
        else {
          const result = await page.evaluate(focusObscured, target);
          if (result.outcome === "gap") await gaps("focus", target, result.reason!, ["AP013"]);
          else if (result.outcome === "finding") {
            const finding: RawFinding = { checkId: "AP013", target, related: result.related, message: "Focused control is entirely hidden by fixed or sticky content.", confidence: "measured", evidence: result.evidence! };
            await add({ findings: [finding], skipped: [] }, "focus");
          }
        }
      }
      if (colors) for (const colorTarget of colorTargets) await add(await inspectColors(page, "focus", colorTarget), "focus");

      if (before) {
        if (!focused) await gaps("focus", target, "Focus moved elsewhere", ["AP012"]);
        else if (!after.focusVisible) await gaps("focus", target, "Keyboard focus modality not engaged", ["AP012"]);
        else if (after.scroll[0] !== before.probe.scroll[0] || after.scroll[1] !== before.probe.scroll[1] || after.rect.some((v, i) => Math.abs(v - before!.probe.rect[i]!) > 0.5)) {
          await gaps("focus", target, "Layout moved during focus; pixels not compared", ["AP012"]);
        } else {
          const afterImage = (await page.screenshot({ clip: before.probe.clip, animations: "disabled", caret: "hide", scale: "css" })).toString("base64");
          const stats = await comparePixels(await helperPage(page.context()), before.image, afterImage);
          const styleChanged = after.styles !== before.probe.styles;
          if (stats.changed < 4 && !styleChanged) {
            if (after.textEntry) await gaps("focus", target, "Only the text caret indicates focus; needs review", ["AP012"]);
            else {
              const finding: RawFinding = {
                checkId: "AP012", target, message: "No visible change when the control receives keyboard focus.", confidence: "measured",
                evidence: { clip: before.probe.clip, changedPixels: stats.changed, styleChanged, outline: after.outline, boxShadow: after.boxShadow },
              };
              await add({ findings: [finding], skipped: [] }, "focus");
            }
          }
        }
      }
    } catch (error) {
      await gaps("focus", target, String(error));
    }
  }
}
