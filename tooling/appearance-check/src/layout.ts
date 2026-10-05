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
  const visible = (element: Element): boolean => {
    if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    if (element.closest("details:not([open])") && !element.closest("details:not([open]) > summary")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && Number(style.opacity) > 0 && element.getClientRects().length > 0;
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
      for (const rect of Array.from(range.getClientRects())) if (rect.width > 1 && rect.height > 1) result.push({ element: owner, rect });
      range.detach();
    }
    return result;
  };

  if (enabled.includes("AP004")) {
    const runs = textNodes();
    let examined = 0;
    for (let i = 0; i < runs.length && examined < 12000; i++) {
      const a = runs[i];
      if (!a) continue;
      for (let j = i + 1; j < runs.length && examined < 12000; j++) {
        const b = runs[j];
        if (!b) continue;
        if (a.element === b.element || a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const intentionalOverlay = (element: Element) => Boolean(element.closest('[data-overlay], [role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"], dialog[open], [popover]'));
        if (intentionalOverlay(a.element) || intentionalOverlay(b.element)) continue;
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
      if (!owner || !visible(owner) || owner.closest("script, style, noscript, textarea, input, select, option")) continue;
      checked++;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()); range.detach();
      if (!rects.length) continue;
      let boundary: Element = owner;
      while (boundary.parentElement && boundary.parentElement !== document.body && boundary.parentElement.getClientRects().length && boundary.parentElement.contains(owner)) {
        const parentElement: Element = boundary.parentElement;
        const parentStyle = getComputedStyle(parentElement);
        if (parentStyle.display === "block" || parentStyle.display === "flex" || parentStyle.display === "grid" || parentStyle.overflowX !== "visible" || parentStyle.overflowY !== "visible") { boundary = parentElement; break; }
        boundary = parentElement;
      }
      const bounds = boundary.getBoundingClientRect();
      const style = getComputedStyle(boundary);
      const canScroll = /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
      const clamped = style.webkitLineClamp !== "none" && style.webkitLineClamp !== "" || style.display === "-webkit-box" && style.webkitBoxOrient === "vertical";
      const ellipsis = style.textOverflow === "ellipsis" || boundary.scrollWidth > boundary.clientWidth && canScroll;
      if (clamped || ellipsis) continue;
      const escaped = rects.some(rect => rect.left < bounds.left - 4 || rect.right > bounds.right + 4 || rect.top < bounds.top - 4 || rect.bottom > bounds.bottom + 4);
      const hasClip = /(hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`) && (boundary.scrollWidth > boundary.clientWidth + 2 || boundary.scrollHeight > boundary.clientHeight + 2);
      const rangeHeight = Math.max(...rects.map(rect => rect.height));
      const font = parseFloat(style.fontSize);
      const labelContext = Boolean(boundary.closest("button,a,label,[role=button],[role=tab],[role=menuitem],h1,h2,h3,h4,h5,h6"));
      const shortLabel = node.data.trim().length <= 120;
      const fragmented = rangeHeight > 0 && shortLabel && labelContext && rects.length > 2;
      if (escaped || hasClip || fragmented) add("AP005", boundary, escaped ? "Text extends beyond its containing box." : hasClip ? "Text exceeds a clipping container." : "Text breaks into unusually fragmented lines.", "measured", { escaped, clipped: hasClip, fragmented, textRects: rects.slice(0, 8).map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })), container: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, overflow: { x: style.overflowX, y: style.overflowY }, text: node.data.trim().slice(0, 120) });
    }
    if (checked >= 1500) skip("AP005", "body", "Text scan limit reached; remaining text was not checked.");
  }

  if (enabled.includes("AP006")) {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"));
    for (const heading of headings) {
      if (!visible(heading) || !heading.textContent?.trim()) continue;
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
        if (bodySize >= headingSize + 2 && bodyWeight >= headingWeight) add("AP006", heading, "A nearby body label has stronger font metrics than its heading.", "measured", { heading: { fontSize: headingSize, fontWeight: headingWeight }, nearbyBody: { fontSize: bodySize, fontWeight: bodyWeight }, sizeDifference: bodySize - headingSize }, bodyText);
      }
    }
  }

  if (enabled.includes("AP007")) {
    for (const control of Array.from(document.querySelectorAll("button,a,[role=button]"))) {
      if (!visible(control)) continue;
      const content = Array.from(control.children).filter(child => visible(child));
      if (content.length !== 1 || content[0]?.tagName.toLowerCase() !== "svg" || control.textContent?.trim()) continue;
      const svg = content[0] as SVGSVGElement;
      const label = control.getAttribute("aria-label") || control.getAttribute("title") || svg.getAttribute("aria-label");
      if (!label) continue;
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
      if (!visible(element)) continue;
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
