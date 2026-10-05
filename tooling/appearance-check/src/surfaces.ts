export interface CornerRadius {
  x: number;
  y: number;
}

export interface CornerEvidence {
  corner: string;
  inset: CornerRadius;
  expected: CornerRadius;
  actual: CornerRadius;
  error: number;
}

export interface SurfaceFinding {
  rule: "nested-radius";
  severity: "warning";
  basis: "inferred-surface-relationship";
  outer: string;
  inner: string;
  relationship: string;
  evidence: CornerEvidence[];
  maxError: number;
}

export interface SurfaceScan {
  status: "complete" | "partial";
  surfaces: number;
  relationships: Array<{ outer: string; inner: string; kind: string }>;
  findings: SurfaceFinding[];
  skipped: Array<{ target: string; reason: string }>;
}

export function scanSurfaces(): SurfaceScan {
  const tolerance = 0.75;
  const names = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
  const radiusProperties = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"] as const;
  type Surface = {
    element: Element;
    selector: string;
    box: DOMRect;
    radii: CornerRadius[];
    interactive: boolean;
    clips: boolean;
    paint: string;
    hasBorder: boolean;
    fill: boolean;
    borders: boolean[];
  };
  const surfaces = new Map<Element, Surface>();
  const skipped: SurfaceScan["skipped"] = [];

  function selector(element: Element): string {
    if (element.id && document.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const parts: string[] = [];
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node!.tagName) : [node];
      parts.unshift(node.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")");
    }
    return "body > " + parts.join(" > ");
  }

  function alpha(color: string): number {
    if (color === "transparent") return 0;
    const match = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    if (match) return Number(match[1]);
    const modern = color.match(/\/\s*([\d.]+)(%)?\s*\)/);
    return modern ? Number(modern[1]) / (modern[2] ? 100 : 1) : 1;
  }

  function length(value: string, size: number): number {
    return value.endsWith("%") ? parseFloat(value) * size / 100 : parseFloat(value);
  }

  function radii(style: CSSStyleDeclaration, box: DOMRect): CornerRadius[] | null {
    const values = radiusProperties.map(property => {
      const values = style[property].trim().split(/\s+/);
      return { x: length(values[0]!, box.width), y: length(values[1] || values[0]!, box.height) };
    });
    if (values.some(value => !Number.isFinite(value.x) || !Number.isFinite(value.y))) return null;
    const sums = [values[0]!.x + values[1]!.x, values[1]!.y + values[2]!.y, values[2]!.x + values[3]!.x, values[3]!.y + values[0]!.y];
    const sizes = [box.width, box.height, box.width, box.height];
    const scale = Math.min(1, ...sums.map((sum, index) => sum > 0 ? sizes[index]! / sum : 1));
    return values.map(value => ({ x: value.x * scale, y: value.y * scale }));
  }

  function visible(element: Element, box: DOMRect): boolean {
    if (box.width <= 0 || box.height <= 0 || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) return false;
    if (typeof element.checkVisibility === "function" && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        const summary = [...ancestor.children].find(child => child.tagName === "SUMMARY");
        if (!summary?.contains(element)) return false;
      }
    }
    return true;
  }

  function unsupportedTransform(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const transform = getComputedStyle(ancestor).transform;
      const style = getComputedStyle(ancestor);
      const zoom = parseFloat(style.zoom);
      if (Number.isFinite(zoom) && Math.abs(zoom - 1) > 0.0001) return true;
      if (style.clipPath !== "none" || style.maskImage !== "none") return true;
      if (transform !== "none") {
        const matrix = new DOMMatrixReadOnly(transform);
        if (!matrix.is2D || Math.abs(matrix.a - 1) > 0.0001 || Math.abs(matrix.d - 1) > 0.0001 || Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001) return true;
      }
    }
    return false;
  }

  for (const element of document.querySelectorAll("body *")) {
    const box = element.getBoundingClientRect();
    if (!visible(element, box)) continue;
    const style = getComputedStyle(element);
    const borders = ["top", "right", "bottom", "left"].map(side => parseFloat(style.getPropertyValue("border-" + side + "-width")) > 0 && alpha(style.getPropertyValue("border-" + side + "-color")) > 0);
    const hasBorder = borders.some(Boolean);
    const fill = alpha(style.backgroundColor) > 0 || style.backgroundImage !== "none" || ["IMG", "VIDEO", "CANVAS"].includes(element.tagName);
    const painted = fill || hasBorder;
    if (!painted) continue;
    if (unsupportedTransform(element)) {
      skipped.push({ target: selector(element), reason: "Transform, zoom, clipping path or mask needs separate paint geometry" });
      continue;
    }
    const usedRadii = radii(style, box);
    if (!usedRadii) {
      skipped.push({ target: selector(element), reason: "Unresolved corner geometry" });
      continue;
    }
    if (style.backgroundClip !== "border-box") {
      skipped.push({ target: selector(element), reason: "Non-border-box paint edge needs separate geometry" });
      continue;
    }
    surfaces.set(element, {
      element, selector: selector(element), box, radii: usedRadii,
      interactive: element.matches("button,a,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=switch]"),
      clips: ["hidden", "clip"].includes(style.overflowX) && ["hidden", "clip"].includes(style.overflowY),
      paint: style.backgroundColor + ":" + style.backgroundImage,
      hasBorder, fill, borders,
    });
  }

  const findings: SurfaceFinding[] = [];
  const relationships: SurfaceScan["relationships"] = [];
  for (const child of surfaces.values()) {
    let ancestor = child.element.parentElement;
    while (ancestor && !surfaces.has(ancestor)) ancestor = ancestor.parentElement;
    const parent = ancestor ? surfaces.get(ancestor) : undefined;
    if (!parent || parent.radii.every(radius => radius.x <= tolerance || radius.y <= tolerance)) continue;
    const p = parent.box, c = child.box;
    const insets = [c.left - p.left, c.top - p.top, p.right - c.right, p.bottom - c.bottom];
    if (insets.some(value => value < -tolerance)) continue;
    if (parent.paint === child.paint && !child.hasBorder) continue;
    const offsets = [
      { x: insets[0]!, y: insets[1]! }, { x: insets[2]!, y: insets[1]! },
      { x: insets[2]!, y: insets[3]! }, { x: insets[0]!, y: insets[3]! },
    ];
    const cornerAttached = offsets.map((offset, index) => offset.x < parent.radii[index]!.x - tolerance && offset.y < parent.radii[index]!.y - tolerance);
    let selected: number[] = [];
    let kind = "";
    if (cornerAttached.every(Boolean)) {
      selected = [0, 1, 2, 3];
      kind = "inset-surface";
    } else if (!child.interactive && cornerAttached[0] && cornerAttached[1]) {
      selected = [0, 1];
      kind = "top-surface";
    } else if (!child.interactive && cornerAttached[2] && cornerAttached[3]) {
      selected = [2, 3];
      kind = "bottom-surface";
    } else continue;
    const paintsCorner = (surface: Surface, index: number) => surface.fill || surface.borders[index] || surface.borders[(index + 3) % 4];
    selected = selected.filter(index => paintsCorner(parent, index) && paintsCorner(child, index));
    if (!selected.length) continue;
    if (parent.clips && selected.some(index => child.radii[index]!.x <= tolerance || child.radii[index]!.y <= tolerance)) {
      skipped.push({ target: child.selector, reason: "Visible corner is generated by parent clipping" });
      continue;
    }
    relationships.push({ outer: parent.selector, inner: child.selector, kind });
    const evidence = selected.map(index => {
      const expected = { x: Math.max(0, parent.radii[index]!.x - offsets[index]!.x), y: Math.max(0, parent.radii[index]!.y - offsets[index]!.y) };
      const actual = child.radii[index]!;
      return { corner: names[index]!, inset: offsets[index]!, expected, actual, error: Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y)) };
    });
    const maxError = Math.max(...evidence.map(corner => corner.error));
    if (maxError > tolerance) findings.push({ rule: "nested-radius", severity: "warning", basis: "inferred-surface-relationship", outer: parent.selector, inner: child.selector, relationship: kind, evidence, maxError });
  }
  return { status: skipped.length ? "partial" : "complete", surfaces: surfaces.size, relationships, findings, skipped };
}
