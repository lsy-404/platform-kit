export interface AppearanceKit {
  selector(el: Element): string;
  visible(el: Element): boolean;
  geometryIssue(el: Element): string | null;
  srOnly(el: Element): boolean;
  decorative(el: Element): boolean;
  disabled(el: Element): boolean;
  clippedRect(el: Element, r: DOMRect): DOMRect;
  textRuns(): Array<{ owner: Element; rect: DOMRect }>;
  lines(block: Element): Array<{ top: number; left: number; right: number; width: number }>;
  rgba(css: string): [number, number, number, number];
  composite(top: number[], bottom: number[]): number[];
  contrast(a: number[], b: number[]): number;
  effectiveOpacity(el: Element): number;
  paintBehind(x: number, y: number, exclude?: Element): number[] | null;
  adjacentColor(el: Element): { rgb: number[] } | { reason: string };
  script(text: string): "cjk" | "latin";
  identity(el: Element): number;
}

declare global {
  // eslint-disable-next-line no-var
  var __appearanceKit: AppearanceKit | undefined;
}

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function installKit(): void {
  if (globalThis.__appearanceKit) return;

  const selector = (element: Element): string => {
    const path: string[] = [];
    for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const testId = current.getAttribute("data-testid");
      const id = current.id;
      const segment = id ? `${tag}#${CSS.escape(id)}` : testId ? `${tag}[data-testid="${CSS.escape(testId)}"]` : `${tag}:nth-child(${Array.prototype.indexOf.call(current.parentElement?.children ?? [], current) + 1})`;
      path.unshift(segment);
      const candidate = path.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    return element.tagName.toLowerCase();
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

  const geometryIssue = (element: Element): string | null => {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), zoom = parseFloat(style.zoom);
      const matrix = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
      const reshaped = matrix && (!matrix.is2D || Math.abs(matrix.a - 1) > 0.0001 || Math.abs(matrix.d - 1) > 0.0001 || Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001);
      if (style.clipPath !== "none" || style.maskImage !== "none" || Number.isFinite(zoom) && Math.abs(zoom - 1) > 0.0001 || reshaped) {
        return "Transformed, clipped or masked paint needs separate geometry (" + selector(ancestor) + ")";
      }
    }
    return null;
  };

  const srOnly = (element: Element): boolean => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width <= 1 && box.height <= 1 || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
  };

  const decorative = (element: Element): boolean => element.closest('[aria-hidden="true"],[inert]') !== null;
  const disabled = (element: Element): boolean => element.closest(':disabled,[aria-disabled="true"]') !== null;

  const clippedRect = (element: Element, rect: DOMRect): DOMRect => {
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (style.overflowX !== "visible") { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (style.overflowY !== "visible") { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };

  const textRuns = (): Array<{ owner: Element; rect: DOMRect }> => {
    const result: Array<{ owner: Element; rect: DOMRect }> = [];
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
        if (rect.width > 1 && rect.height > 1) result.push({ owner, rect });
      }
      range.detach();
    }
    return result;
  };

  const lines = (block: Element): Array<{ top: number; left: number; right: number; width: number }> => {
    const size = parseFloat(getComputedStyle(block).fontSize) || 16;
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) if (rect.width > 0 && rect.height > 0) rects.push(rect);
      range.detach();
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const grouped: Array<{ top: number; left: number; right: number }> = [];
    for (const rect of rects) {
      const line = grouped.find(candidate => Math.abs(candidate.top - rect.top) <= 0.25 * size);
      if (line) { line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right); line.top = Math.min(line.top, rect.top); }
      else grouped.push({ top: rect.top, left: rect.left, right: rect.right });
    }
    return grouped.sort((a, b) => a.top - b.top).map(line => ({ ...line, width: line.right - line.left }));
  };

  const colorCache = new Map<string, [number, number, number, number]>();
  let canvas: OffscreenCanvasRenderingContext2D | null = null;
  const rgba = (css: string): [number, number, number, number] => {
    const cached = colorCache.get(css);
    if (cached) return cached;
    let value: [number, number, number, number];
    const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css.trim());
    if (match) {
      const alpha = match[4] === undefined ? 1 : match[5] ? Number(match[4]) / 100 : Number(match[4]);
      value = [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
    } else {
      canvas ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
      if (!canvas) throw new Error("2D canvas is unavailable");
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = "#000";
      canvas.fillStyle = css;
      canvas.fillRect(0, 0, 1, 1);
      const data = canvas.getImageData(0, 0, 1, 1).data;
      value = [data[0]!, data[1]!, data[2]!, data[3]! / 255];
    }
    colorCache.set(css, value);
    return value;
  };

  const composite = (top: number[], bottom: number[]): number[] => {
    const at = top[3] ?? 1, ab = bottom[3] ?? 1, alpha = at + ab * (1 - at);
    if (alpha <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => ((top[i] ?? 0) * at + (bottom[i] ?? 0) * ab * (1 - at)) / alpha).concat(alpha);
  };

  const luminance = (color: number[]): number => {
    const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(color[0] ?? 0) + 0.7152 * channel(color[1] ?? 0) + 0.0722 * channel(color[2] ?? 0);
  };
  const contrast = (a: number[], b: number[]): number => {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const effectiveOpacity = (element: Element): number => {
    let product = 1;
    for (let current: Element | null = element; current; current = current.parentElement) product *= parseFloat(getComputedStyle(current).opacity);
    return product;
  };

  const paintBehind = (x: number, y: number, exclude?: Element): number[] | null => {
    const stack = document.elementsFromPoint(x, y).filter(element => !exclude || element !== exclude && !exclude.contains(element));
    const layers: number[][] = [];
    let opaque = false;
    for (const element of stack) {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== "none" || style.filter !== "none" || style.backdropFilter !== "none" || style.mixBlendMode !== "normal" || effectiveOpacity(element) < 1) return null;
      if (/^(IMG|VIDEO|CANVAS|IFRAME|OBJECT|EMBED)$/.test(element.tagName)) return null;
      for (const pseudo of ["::before", "::after"] as const) {
        const generated = getComputedStyle(element, pseudo);
        if (generated.content !== "none" && generated.content !== "normal" && (rgba(generated.backgroundColor)[3] > 0 || generated.backgroundImage !== "none")) return null;
      }
      const color = rgba(style.backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 0.999) { opaque = true; break; }
    }
    if (!opaque && !stack.includes(document.body) && document.body && rgba(getComputedStyle(document.documentElement).backgroundColor)[3] === 0) {
      // A body background propagates to the canvas when the root has none.
      const body = getComputedStyle(document.body);
      if (body.backgroundImage !== "none") return null;
      const color = rgba(body.backgroundColor);
      if (color[3] > 0) layers.push(color);
      opaque = color[3] >= 0.999;
    }
    if (!opaque) {
      const probe = document.createElement("div");
      probe.style.background = "Canvas";
      document.documentElement.appendChild(probe);
      const canvasColor = rgba(getComputedStyle(probe).backgroundColor);
      probe.remove();
      layers.push([canvasColor[0], canvasColor[1], canvasColor[2], 1]);
    }
    let result = layers[layers.length - 1]!;
    for (let i = layers.length - 2; i >= 0; i--) result = composite(layers[i]!, result);
    return result;
  };

  const adjacentColor = (element: Element): { rgb: number[] } | { reason: string } => {
    const box = element.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const points: Array<[number, number]> = [[cx, box.top - 3], [cx, box.bottom + 3], [box.left - 3, cy], [box.right + 3, cy]];
    const known = points.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight).map(([x, y]) => paintBehind(x, y)).filter((color): color is number[] => color !== null);
    const flat = known.length >= 2 && known.every(a => known.every(b => [0, 1, 2].every(i => Math.abs(Math.round(a[i]!) - Math.round(b[i]!)) <= 2)));
    return flat ? { rgb: known[0]! } : { reason: "Adjacent background varies or is not a flat color" };
  };

  const script = (text: string): "cjk" | "latin" => {
    const chars = [...text.replace(/\s+/g, "")];
    if (!chars.length) return "latin";
    const cjk = chars.filter(char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)).length;
    return cjk / chars.length >= 0.3 ? "cjk" : "latin";
  };

  const identities = new WeakMap<Element, number>();
  let next = 0;
  const identity = (element: Element): number => {
    let id = identities.get(element);
    if (id === undefined) { id = ++next; identities.set(element, id); }
    return id;
  };

  globalThis.__appearanceKit = { selector, visible, geometryIssue, srOnly, decorative, disabled, clippedRect, textRuns, lines, rgba, composite, contrast, effectiveOpacity, paintBehind, adjacentColor, script, identity };
}
