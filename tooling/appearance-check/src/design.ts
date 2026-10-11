export interface DesignColor {
  role: "text" | "background" | "border";
  value: string;
  count: number;
  weight: number;
  examples: string[];
}

export interface DesignTextRun {
  size: number;
  weight: number;
  family: string;
  code: boolean;
  chars: number;
  color: string | null;
}

export interface DesignSample {
  scheme: "light" | "dark";
  colors: DesignColor[];
  text: DesignTextRun[];
  surfaces: Array<{ color: string; count: number }>;
  spacing: number[];
  skipped: Array<{ target: string; reason: string }>;
}

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function collectDesign(): DesignSample {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");

  const hex = (color: number[]): string => "#" + [0, 1, 2].map(i => Math.round(color[i] ?? 0).toString(16).padStart(2, "0")).join("");
  const skipped: DesignSample["skipped"] = [];
  const colors = new Map<string, DesignColor>();
  const addColor = (role: DesignColor["role"], value: string, weight: number, element: Element) => {
    const key = role + "|" + value;
    let entry = colors.get(key);
    if (!entry) { entry = { role, value, count: 0, weight: 0, examples: [] }; colors.set(key, entry); }
    entry.count++;
    entry.weight += weight;
    if (entry.examples.length < 3) { const target = kit.selector(element); if (!entry.examples.includes(target)) entry.examples.push(target); }
  };

  const text: DesignTextRun[] = [];
  const owners = new Map<Element, number>();
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const chars = node.data.replace(/\s+/g, " ").trim().length;
    if (!chars) continue;
    const owner = node.parentElement;
    if (!owner || owner.closest("script, style, noscript, textarea, input, select, option, svg")) continue;
    owners.set(owner, (owners.get(owner) ?? 0) + chars);
  }
  for (const [owner, chars] of owners) {
    if (!kit.visible(owner) || kit.decorative(owner)) continue;
    const style = getComputedStyle(owner);
    const family = (style.fontFamily.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
    const code = owner.closest("pre, code, kbd, samp") !== null || /mono/.test(family);
    const color = kit.rgba(style.color);
    text.push({ size: parseFloat(style.fontSize), weight: parseInt(style.fontWeight, 10) || 400, family, code, chars, color: color[3] >= 0.999 ? hex(color) : null });
    if (color[3] >= 0.999 && !code && !owner.closest("[contenteditable]") && !kit.disabled(owner)) addColor("text", hex(color), chars, owner);
  }

  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|OBJECT|EMBED|PICTURE|PROGRESS|METER)$/i;
  const spacing: number[] = [];
  const elements = Array.from(document.querySelectorAll("body, body *"));
  let sampled = 0;
  for (const element of elements) {
    if (sampled >= 3000) { skipped.push({ target: "body", reason: "Design sampling limit of 3000 elements reached; remaining elements were not sampled." }); break; }
    if (!kit.visible(element)) continue;
    sampled++;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const border = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      const borderStyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      spacing.push((parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0) + (borderStyle === "none" || borderStyle === "hidden" ? 0 : border));
      if (side === "Top" || side === "Bottom") spacing.push(parseFloat(style.getPropertyValue(`margin-${side.toLowerCase()}`)) || 0);
      const borderColor = kit.rgba(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (border >= 1 && borderStyle !== "none" && borderStyle !== "hidden" && borderColor[3] >= 0.999 && !kit.decorative(element)) {
        addColor("border", hex(borderColor), side === "Top" || side === "Bottom" ? box.width : box.height, element);
      }
    }
    for (const gap of [style.rowGap, style.columnGap]) if (gap !== "normal") spacing.push(parseFloat(gap) || 0);
    const background = kit.rgba(style.backgroundColor);
    if (background[3] >= 0.999 && style.backgroundImage === "none" && !MEDIA.test(element.tagName) && !element.matches("input[type=checkbox],input[type=radio],input[type=range],input[type=color],input[type=file]") && !kit.decorative(element)) {
      const clipped = kit.clippedRect(element, box);
      addColor("background", hex(background), clipped.width * clipped.height, element);
    }
  }

  const surfaces = new Map<string, number>();
  const step = Math.max(8, Math.round(Math.min(innerWidth, innerHeight) / 40));
  for (let y = step / 2; y < innerHeight; y += step) {
    for (let x = step / 2; x < innerWidth; x += step) {
      const first = document.elementsFromPoint(x, y)[0];
      if (first && /^(img|video|canvas|svg)$/i.test(first.tagName)) { surfaces.set("media", (surfaces.get("media") ?? 0) + 1); continue; }
      const behind = kit.paintBehind(x, y);
      if (!behind) continue;
      const key = hex(behind);
      surfaces.set(key, (surfaces.get(key) ?? 0) + 1);
    }
  }

  return {
    scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    colors: Array.from(colors.values()),
    text,
    surfaces: Array.from(surfaces, ([color, count]) => ({ color, count })),
    spacing,
    skipped,
  };
}
