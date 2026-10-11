import type { BrowserResult, RawFinding, Skipped } from "./types.js";

// Page function: serialized by Playwright, so it may only use the injected kit and its own body.
export function inspectNonText(): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const REQUIRED = 3, CAP = 200;
  const gap = (target: string, reason: string) => skipped.push({ checkId: "AP016", target, reason });
  const css = (c: number[]) => {
    const rgb = `rgb(${c.slice(0, 3).map(v => Math.round(v)).join(", ")})`;
    return (c[3] ?? 1) < 1 ? rgb + ` / ${Math.round((c[3] ?? 1) * 100) / 100}` : rgb;
  };
  const round = (value: number) => Math.round(value * 100) / 100;

  const TEXT_TYPES = ["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "week", "time"];
  const isFieldCandidate = (el: Element): boolean => {
    if (el instanceof HTMLInputElement) {
      if (TEXT_TYPES.includes(el.type)) return true;
      return (el.type === "checkbox" || el.type === "radio") && getComputedStyle(el).appearance === "none";
    }
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return el.matches("[role=checkbox],[role=radio],[role=switch]") && !(el.textContent ?? "").trim();
  };

  const hasVisibleText = (control: Element): boolean => {
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const owner = node.parentElement;
      if (!node.data.trim() || !owner || owner.closest("svg") || !owner.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let hidden = false;
      for (let el: Element | null = owner; el && el !== control.parentElement; el = el.parentElement) if (kit.srOnly(el)) { hidden = true; break; }
      if (!hidden) return true;
    }
    return false;
  };

  // Splits at top-level commas so rgb(a, b, c) stays intact.
  const shadowLayers = (value: string) => {
    if (value === "none") return [];
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      else if (value[i] === "," && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
    }
    parts.push(value.slice(start));
    return parts.map(part => {
      const colorMatch = /[a-z-]+\([^)]*\)/i.exec(part);
      const rest = (colorMatch ? part.replace(colorMatch[0], "") : part).trim().split(/\s+/).filter(Boolean);
      const inset = rest.includes("inset");
      const lengths = rest.filter(token => token !== "inset").map(parseFloat);
      return { color: colorMatch ? kit.rgba(colorMatch[0]) : kit.rgba(getComputedStyle(document.body).color), inset, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 };
    });
  };

  const inspectField = (el: Element) => {
    const target = kit.selector(el);
    const adjacent = kit.adjacentColor(el);
    if ("reason" in adjacent) { gap(target, adjacent.reason); return; }
    const P = [...adjacent.rgb.slice(0, 3), 1];
    const style = getComputedStyle(el);
    const F = kit.composite(kit.rgba(style.backgroundColor), P);
    const fillBase = style.backgroundClip === "border-box" ? F : P;
    const borders: Array<{ side: string; color: string; ratio: number }> = [];
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const borderStyle = style.getPropertyValue(`border-${side}-style`);
      const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
      const color = kit.rgba(style.getPropertyValue(`border-${side}-color`));
      if (width < 1 || borderStyle === "none" || borderStyle === "hidden" || color[3] <= 0) continue;
      borders.push({ side, color: css(color), ratio: kit.contrast(kit.composite(color, fillBase), P) });
    }
    const layers = shadowLayers(style.boxShadow);
    const rings = layers.filter(layer => !layer.inset && layer.blur === 0 && layer.spread >= 1)
      .map(layer => ({ color: css(layer.color), ratio: kit.contrast(kit.composite(layer.color, P), P) }));
    const fillRatio = kit.contrast(F, P);
    const blurred = layers.some(layer => layer.blur > 0);
    if (!borders.length && !rings.length) {
      if (fillRatio < 1.1 && !blurred) return;
      gap(target, "Fill-only or soft-shadow boundary needs review");
      return;
    }
    const best = Math.max(fillRatio, ...borders.map(b => b.ratio), ...rings.map(r => r.ratio));
    if (best >= REQUIRED) return;
    findings.push({
      checkId: "AP016", target, confidence: "measured",
      message: "Control boundary contrast is below 3:1 against the adjacent color.",
      evidence: {
        kind: "control-boundary", adjacent: css(P), fill: css(F), fillRatio: round(fillRatio),
        borders: borders.map(b => ({ ...b, ratio: round(b.ratio) })), rings: rings.map(r => ({ ...r, ratio: round(r.ratio) })),
        bestRatio: round(best), required: REQUIRED,
      },
    });
  };

  const SHAPES = "path,rect,circle,ellipse,line,polyline,polygon,text,use";
  const inspectIcon = (control: Element, svg: SVGSVGElement) => {
    const target = kit.selector(control);
    const box = control.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { gap(target, "Control center is outside the viewport"); return; }
    const back = kit.paintBehind(x, y, svg);
    if (!back) { gap(target, "Icon backdrop is not a flat color"); return; }
    const B = [...back.slice(0, 3), 1];
    const paints: Array<{ color: string; ratio: number }> = [];
    let patterned = false;
    const add = (shape: Element, value: string, opacity: string) => {
      if (value === "none") return;
      if (value.startsWith("url(")) { patterned = true; return; }
      let alpha = parseFloat(opacity) || 0;
      for (let el: Element | null = shape; el; el = el.parentElement) {
        alpha *= parseFloat(getComputedStyle(el).opacity);
        if (el === svg) break;
      }
      const color = kit.rgba(value);
      const painted = [color[0], color[1], color[2], color[3] * alpha];
      if (painted[3]! <= 0) return;
      paints.push({ color: css(painted), ratio: kit.contrast(kit.composite(painted, B), B) });
    };
    for (const shape of svg.querySelectorAll(SHAPES)) {
      if (shape.closest("defs,clipPath,mask,pattern,marker,symbol") || !shape.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(shape);
      if (shape.tagName.toLowerCase() !== "line") add(shape, style.fill, style.fillOpacity);
      if (style.stroke !== "none" && parseFloat(style.strokeWidth) >= 1) add(shape, style.stroke, style.strokeOpacity);
    }
    if (patterned) gap(target, "Gradient or pattern icon paint");
    if (!paints.length) return;
    const best = Math.max(...paints.map(p => p.ratio));
    if (best >= REQUIRED) return;
    findings.push({
      checkId: "AP016", target, confidence: "measured",
      message: "Icon-only control glyph contrast is below 3:1.",
      evidence: { kind: "icon", adjacent: css(B), iconPaints: paints.map(p => ({ ...p, ratio: round(p.ratio) })), bestRatio: round(best), required: REQUIRED },
    });
  };

  const candidates = document.querySelectorAll("input,textarea,select,button,a[href],[role=checkbox],[role=radio],[role=switch],[role=button]");
  let inspected = 0;
  for (const el of candidates) {
    const field = isFieldCandidate(el);
    const iconControl = !field && el.matches("button,a[href],[role=button]");
    if (!field && !iconControl) continue;
    if (kit.disabled(el) || kit.decorative(el) || !kit.visible(el) || field && kit.srOnly(el)) continue;
    if (iconControl && (hasVisibleText(el))) continue;
    const svg = iconControl ? [...el.querySelectorAll("svg")].find(candidate => kit.visible(candidate)) : undefined;
    if (iconControl && !svg) {
      if ([...el.querySelectorAll("img")].some(img => kit.visible(img))) gap(kit.selector(el), "Raster icon contrast is not measured");
      continue;
    }
    if (inspected >= CAP) { gap("document", `Candidate limit reached (${CAP}); remaining controls were not inspected`); break; }
    inspected++;
    const issue = kit.geometryIssue(el);
    if (issue) { gap(kit.selector(el), issue); continue; }
    if (field) inspectField(el);
    else inspectIcon(el, svg as SVGSVGElement);
  }
  return { findings, skipped };
}
