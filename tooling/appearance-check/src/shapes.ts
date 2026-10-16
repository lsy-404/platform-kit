import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectShapes(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const pill = enabled.includes("AP028"), overlay = enabled.includes("AP029");
  if (!pill && !overlay) return { findings, skipped };

  const MAX_ELEMENTS = 3000;
  const INTERACTIVE = "button,a,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=combobox],[role=menuitem],[role=option]";
  const OVERLAY = "dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]";
  const round = (value: number): number => Math.round(value * 100) / 100;
  const painted = (style: CSSStyleDeclaration): boolean => kit.rgba(style.backgroundColor)[3] > 0 || style.backgroundImage !== "none" || style.boxShadow !== "none"
    || ["top", "right", "bottom", "left"].some(side => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0
      && !/^(none|hidden)$/.test(style.getPropertyValue(`border-${side}-style`)) && kit.rgba(style.getPropertyValue(`border-${side}-color`))[3] > 0);
  // Uniform circular corner radius as painted (clamped to half the shorter side); null for elliptical, percentage or mixed corners.
  const radiusOf = (style: CSSStyleDeclaration, rect: DOMRect): number | null => {
    const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => value.trim().split(/\s+/));
    if (corners.some(pair => pair.some(part => part.endsWith("%")) || pair[1] !== undefined && pair[1] !== pair[0])) return null;
    const px = corners.map(pair => parseFloat(pair[0] ?? ""));
    if (!px.every(Number.isFinite) || Math.max(...px) - Math.min(...px) > 0.5) return null;
    return Math.min(px[0]!, Math.min(rect.width, rect.height) / 2);
  };

  interface Shape { element: Element; rect: DOMRect; radius: number }
  const shapes: Shape[] = [];
  let examined = 0;
  for (const element of Array.from(document.querySelectorAll("body *"))) {
    if (!kit.visible(element) || kit.srOnly(element)) continue;
    const style = getComputedStyle(element);
    if (!painted(style)) continue;
    if (++examined > MAX_ELEMENTS) {
      for (const checkId of ["AP028", "AP029"] as const) if (enabled.includes(checkId)) skipped.push({ checkId, target: "body", reason: "Painted element limit reached; remaining shapes were not checked." });
      break;
    }
    const rect = element.getBoundingClientRect();
    const radius = radiusOf(style, rect);
    if (radius === null) continue;
    const issue = kit.geometryIssue(element);
    if (issue) {
      if (pill && radius > 0.5) skipped.push({ checkId: "AP028", target: kit.selector(element), reason: issue });
      continue;
    }
    shapes.push({ element, rect, radius });
  }

  if (pill) {
    for (const { element, rect, radius } of shapes) {
      const half = Math.min(rect.width, rect.height) / 2;
      if (rect.height < 12 || rect.height > 64 || rect.width < rect.height) continue;
      if (radius >= 0.8 * half && half - radius >= 0.75) {
        findings.push({
          checkId: "AP028",
          target: kit.selector(element),
          message: "Corners stop just short of a full round end; a pill takes a radius of half its height.",
          confidence: "measured",
          evidence: { radius: round(radius), height: round(rect.height), width: round(rect.width), pillRadius: round(half) },
        });
      }
    }
  }

  if (overlay) {
    const overlays = Array.from(document.querySelectorAll(OVERLAY)).filter(element => kit.visible(element));
    if (overlays.length) {
      const cards = shapes.filter(({ element, rect, radius }) => !element.matches(INTERACTIVE) && !element.closest(OVERLAY) && !element.querySelector(OVERLAY)
        && rect.width >= 120 && rect.height >= 64 && rect.width < innerWidth * 0.95 && radius > 0.5 && radius < Math.min(rect.width, rect.height) / 2 - 0.5);
      const counts = new Map<number, Shape[]>();
      for (const card of cards) {
        const key = Math.round(card.radius * 2) / 2;
        counts.set(key, [...counts.get(key) ?? [], card]);
      }
      const common = [...counts].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0];
      if (common && common[1].length >= 2) {
        const [cardRadius, examples] = common;
        for (const element of overlays) {
          const area = element.getBoundingClientRect();
          // The dialog's visible panel is the overlay itself or the painted box filling it.
          const surface = shapes.find(shape => (shape.element === element || element.contains(shape.element))
            && shape.rect.width * shape.rect.height >= 0.9 * area.width * area.height);
          if (!surface) continue;
          const r = surface.rect;
          if (r.left <= 1 || r.top <= 1 || r.right >= innerWidth - 1 || r.bottom >= innerHeight - 1) continue; // edge sheets and full-screen dialogs
          if (surface.radius < cardRadius - 0.5) {
            findings.push({
              checkId: "AP029",
              target: kit.selector(surface.element),
              related: kit.selector(examples[0]!.element),
              message: "An open dialog has smaller corners than the page's cards; the higher layer usually takes an equal or larger radius.",
              confidence: "heuristic",
              evidence: { overlayRadius: round(surface.radius), cardRadius, cards: examples.length, cardRadii: [...counts.keys()].sort((a, b) => a - b) },
            });
          }
        }
      }
    }
  }
  return { findings, skipped };
}
