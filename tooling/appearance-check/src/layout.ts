import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

export function inspectLayout(enabled: CheckId[]): BrowserResult {
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const ids = new WeakMap<Element, string>();
  const selector = (element: Element): string => {
    const cached = ids.get(element);
    if (cached) return cached;
    const path: string[] = [];
    for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const testId = current.getAttribute("data-testid");
      const id = current.id;
      const segment = id ? `${tag}#${CSS.escape(id)}` : testId ? `${tag}[data-testid="${CSS.escape(testId)}"]` : `${tag}:nth-child(${Array.prototype.indexOf.call(current.parentElement?.children ?? [], current) + 1})`;
      path.unshift(segment);
      const candidate = path.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) {
        ids.set(element, candidate);
        return candidate;
      }
    }
    const fallback = element.tagName.toLowerCase();
    ids.set(element, fallback);
    return fallback;
  };
  const add = (checkId: CheckId, target: Element, message: string, confidence: "measured" | "heuristic", evidence: Record<string, unknown>, related?: Element) => {
    findings.push({ checkId, target: selector(target), ...(related ? { related: selector(related) } : {}), message, confidence, evidence });
  };
  const skip = (checkId: CheckId, target: string, reason: string) => skipped.push({ checkId, target, reason });
  const unsupported = new Set<string>();
  const geometrySupported = (element: Element, checkId: CheckId): boolean => {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), zoom = parseFloat(style.zoom);
      const matrix = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
      if (style.clipPath !== "none" || style.maskImage !== "none" || Number.isFinite(zoom) && Math.abs(zoom - 1) > 0.0001 || matrix && (!matrix.is2D || Math.abs(matrix.a - 1) > 0.0001 || Math.abs(matrix.d - 1) > 0.0001 || Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001)) {
        const key = checkId + selector(ancestor);
        if (!unsupported.has(key)) { skip(checkId, selector(ancestor), "Transformed or masked paint needs separate geometry."); unsupported.add(key); }
        return false;
      }
    }
    return true;
  };
  const visible = (element: Element): boolean => {
    if (!element.isConnected || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) return false;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open && ![...ancestor.children].find(child => child.tagName === "SUMMARY")?.contains(element)) return false;
    }
    return true;
  };
  const clippedRect = (element: Element, rect: DOMRect): DOMRect => {
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (style.overflowX !== "visible") { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (style.overflowY !== "visible") { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };
  const textNodes = (): Array<{ element: Element; rect: DOMRect }> => {
    const result: Array<{ element: Element; rect: DOMRect }> = [];
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.trim()) continue;
      const owner = node.parentElement;
      if (!owner || !visible(owner) || owner.closest("script, style, noscript, textarea, input, select, option")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const raw of Array.from(range.getClientRects())) {
        const rect = clippedRect(owner, raw);
        if (rect.width > 1 && rect.height > 1) result.push({ element: owner, rect });
      }
      range.detach();
    }
    return result;
  };

  if (enabled.includes("AP004")) {
    const runs = textNodes();
    let examined = 0;
    for (let i = 0; i < runs.length && examined < 12000; i++) {
      const a = runs[i];
      if (!a || !geometrySupported(a.element, "AP004")) continue;
      for (let j = i + 1; j < runs.length && examined < 12000; j++) {
        const b = runs[j];
        if (!b || !geometrySupported(b.element, "AP004")) continue;
        if (a.element === b.element || a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const overlay = (element: Element) => element.closest('[role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"], dialog[open], [popover]');
        if (overlay(a.element) !== overlay(b.element)) continue;
        examined++;
        const width = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
        const height = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
        const area = width * height;
        if (area > 9 && Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height) > 0 && area / Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height) > 0.06) {
          add("AP004", a.element, "Visible text overlaps text from an independent element.", "measured", { overlap: { x: Math.max(a.rect.left, b.rect.left), y: Math.max(a.rect.top, b.rect.top), width, height, area }, firstTextRect: { x: a.rect.x, y: a.rect.y, width: a.rect.width, height: a.rect.height }, secondTextRect: { x: b.rect.x, y: b.rect.y, width: b.rect.width, height: b.rect.height } }, b.element);
        }
      }
    }
    if (runs.length > 0 && examined >= 12000) skip("AP004", "body", "Text overlap comparison limit reached; remaining pairs were not checked.");
  }

  if (enabled.includes("AP005")) {
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    let checked = 0;
    while (walker.nextNode() && checked < 1500) {
      const node = walker.currentNode as Text;
      if (!node.data.trim()) continue;
      const owner = node.parentElement;
      if (!owner || !visible(owner) || !geometrySupported(owner, "AP005") || owner.closest("script, style, noscript, textarea, input, select, option")) continue;
      checked++;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()); range.detach();
      if (!rects.length) continue;
      let boundary: Element = owner;
      while (boundary.parentElement && boundary !== document.body) {
        const style = getComputedStyle(boundary);
        if (style.display !== "inline" && style.display !== "contents" || style.overflowX !== "visible" || style.overflowY !== "visible") break;
        boundary = boundary.parentElement;
      }
      let intentionalContainment = false;
      for (let container: Element | null = boundary; container; container = container.parentElement) {
        const containerStyle = getComputedStyle(container);
        if (/(auto|scroll)/.test(`${containerStyle.overflowX} ${containerStyle.overflowY}`) || containerStyle.textOverflow === "ellipsis" || parseInt(containerStyle.webkitLineClamp) > 0) { intentionalContainment = true; break; }
        if (/(hidden|clip)/.test(`${containerStyle.overflowX} ${containerStyle.overflowY}`)) boundary = container;
        if (container === document.body) break;
      }
      if (intentionalContainment) continue;
      const bounds = boundary.getBoundingClientRect();
      const style = getComputedStyle(boundary);
      const canScroll = /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
      if (canScroll) continue;
      const clamped = style.webkitLineClamp !== "none" && style.webkitLineClamp !== "" || style.display === "-webkit-box" && style.webkitBoxOrient === "vertical";
      const ellipsis = style.textOverflow === "ellipsis" || boundary.scrollWidth > boundary.clientWidth && canScroll;
      if (clamped || ellipsis) continue;
      const escaped = rects.some(rect => rect.left < bounds.left - 4 || rect.right > bounds.right + 4 || ["hidden", "clip"].includes(style.overflowY) && (rect.top < bounds.top - 4 || rect.bottom > bounds.bottom + 4));
      const hasClip = /(hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`) && (boundary.scrollWidth > boundary.clientWidth + 2 || boundary.scrollHeight > boundary.clientHeight + 2);
      const rangeHeight = Math.max(...rects.map(rect => rect.height));
      const font = parseFloat(style.fontSize);
      const labelContext = Boolean(boundary.closest("button,a,label,[role=button],[role=tab],[role=menuitem],h1,h2,h3,h4,h5,h6"));
      const shortLabel = node.data.trim().length <= 120;
      const fragmented = rangeHeight > 0 && shortLabel && labelContext && rects.length > 2;
      if (escaped || hasClip || fragmented) add("AP005", boundary, escaped ? "Text extends beyond its containing box." : hasClip ? "Text exceeds a clipping container." : "Text breaks into unusually fragmented lines.", "heuristic", { escaped, clipped: hasClip, fragmented, textRects: rects.slice(0, 8).map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })), container: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, overflow: { x: style.overflowX, y: style.overflowY }, text: node.data.trim().slice(0, 120) });
    }
    if (checked >= 1500) skip("AP005", "body", "Text scan limit reached; remaining text was not checked.");
  }

  if (enabled.includes("AP006")) {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"));
    for (const heading of headings) {
      if (!visible(heading) || !geometrySupported(heading, "AP006") || !heading.textContent?.trim()) continue;
      const headingStyle = getComputedStyle(heading);
      const headingSize = parseFloat(headingStyle.fontSize);
      const headingWeight = parseInt(headingStyle.fontWeight, 10) || 400;
      const parent = heading.parentElement;
      const bodies = parent ? Array.from(parent.children).filter(child => child !== heading && (child.matches("p,li,span,div") || child.querySelector("p"))).slice(0, 6) : [];
      for (const body of bodies) {
        const bodyText = body.matches("p,li,span") ? body : body.querySelector("p");
        if (!bodyText || !visible(bodyText) || !bodyText.textContent?.trim()) continue;
        const hs = heading.getBoundingClientRect(); const bs = bodyText.getBoundingClientRect();
        if (Math.abs((hs.top + hs.bottom) / 2 - (bs.top + bs.bottom) / 2) > Math.max(160, hs.height + bs.height + 80)) continue;
        const bodyStyle = getComputedStyle(bodyText);
        const bodySize = parseFloat(bodyStyle.fontSize); const bodyWeight = parseInt(bodyStyle.fontWeight, 10) || 400;
        if (bodySize >= headingSize + 2 && bodyWeight >= headingWeight) add("AP006", heading, "A nearby body label has stronger font metrics than its heading.", "heuristic", { heading: { fontSize: headingSize, fontWeight: headingWeight }, nearbyBody: { fontSize: bodySize, fontWeight: bodyWeight }, sizeDifference: bodySize - headingSize }, bodyText);
      }
    }
  }

  if (enabled.includes("AP007")) {
    for (const control of Array.from(document.querySelectorAll("button,a,[role=button]"))) {
      if (!visible(control) || !geometrySupported(control, "AP007")) continue;
      const content = Array.from(control.children).filter(child => visible(child));
      if (content.length !== 1 || content[0]?.tagName.toLowerCase() !== "svg" || control.textContent?.trim()) continue;
      const svg = content[0] as SVGSVGElement;
      const cs = getComputedStyle(control);
      const centered = ((cs.display === "flex" || cs.display === "inline-flex") && cs.justifyContent === "center" && cs.alignItems === "center") || ((cs.display === "grid" || cs.display === "inline-grid") && cs.placeItems.includes("center")) || cs.textAlign === "center";
      if (!centered) continue;
      try {
        const box = svg.getBBox(); const matrix = svg.getScreenCTM();
        if (!matrix || box.width === 0 || box.height === 0) { skip("AP007", selector(control), "SVG painted bounds or screen transform are unavailable."); continue; }
        const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x ?? 0, y ?? 0).matrixTransform(matrix));
        const left = Math.min(...points.map(point => point.x)); const right = Math.max(...points.map(point => point.x)); const top = Math.min(...points.map(point => point.y)); const bottom = Math.max(...points.map(point => point.y));
        const vb = svg.viewBox.baseVal; const vbCenter = vb.width && vb.height ? new DOMPoint(vb.x + vb.width / 2, vb.y + vb.height / 2).matrixTransform(matrix) : null;
        const paintedCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
        const dx = vbCenter ? paintedCenter.x - vbCenter.x : NaN; const dy = vbCenter ? paintedCenter.y - vbCenter.y : NaN;
        if (!vbCenter) { skip("AP007", selector(control), "SVG viewBox is missing; painted bounds cannot be compared with its icon canvas."); continue; }
        if (Math.hypot(dx, dy) > Math.max(2, Math.min(right - left, bottom - top) * 0.06)) add("AP007", control, "Painted SVG bounds are visibly shifted within a centered icon control.", "heuristic", { paintedBounds: { x: left, y: top, width: right - left, height: bottom - top }, viewBoxCenter: { x: vbCenter.x, y: vbCenter.y }, offset: { x: dx, y: dy }, svgViewport: (() => { const r = svg.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })() });
      } catch { skip("AP007", selector(control), "SVG geometry is unsupported or unavailable in this browser state."); }
    }
  }

  if (enabled.includes("AP008")) {
    const surfaces: Array<{ element: Element; rect: DOMRect; signature: string; kind: string }> = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(element) || !geometrySupported(element, "AP008")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 18 || rect.height < 18) continue;
      const style = getComputedStyle(element);
      const borderWidth = Math.max(parseFloat(style.borderTopWidth), parseFloat(style.borderRightWidth), parseFloat(style.borderBottomWidth), parseFloat(style.borderLeftWidth));
      const border = borderWidth >= 1 && style.borderTopStyle !== "none" && style.borderTopStyle !== "hidden" && style.borderTopColor !== "rgba(0, 0, 0, 0)";
      const shadow = style.boxShadow !== "none";
      if (!border && !shadow) continue;
      const radius = `${style.borderTopLeftRadius}|${style.borderTopRightRadius}|${style.borderBottomRightRadius}|${style.borderBottomLeftRadius}`;
      const signature = `${border ? `b:${style.borderTopStyle}:${style.borderTopColor}:${Math.round(borderWidth)}` : ""}|${shadow ? `s:${style.boxShadow.replace(/\d+(?:\.\d+)?px/g, "#px")}` : ""}`;
      surfaces.push({ element, rect, signature: `${signature}|r:${radius}`, kind: `${border ? "border" : ""}${border && shadow ? "+" : ""}${shadow ? "shadow" : ""}` });
    }
    if (surfaces.length > 600) {
      skip("AP008", "body", "More than 600 painted surface candidates were found; nested surface comparison was skipped.");
    } else {
      for (const inner of surfaces) {
        const enclosing = surfaces.filter(outer => outer.element !== inner.element && outer.element.contains(inner.element) && outer.rect.left <= inner.rect.left + 1 && outer.rect.top <= inner.rect.top + 1 && outer.rect.right >= inner.rect.right - 1 && outer.rect.bottom >= inner.rect.bottom - 1 && outer.signature === inner.signature && (outer.rect.width > inner.rect.width + 8 || outer.rect.height > inner.rect.height + 8));
        if (enclosing.length < 2) continue;
        const chain = [...enclosing, inner].sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
        add("AP008", inner.element, "Three or more nested surfaces repeat the same visible border or shadow treatment.", "heuristic", { repeatedTreatment: inner.signature, nestedSurfaceCount: chain.length, surfaces: chain.map(surface => ({ selector: selector(surface.element), kind: surface.kind, bounds: { x: surface.rect.x, y: surface.rect.y, width: surface.rect.width, height: surface.rect.height } })) });
      }
    }
  }

  return { findings, skipped };
}
