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

/** One rendered value with how many elements use it and up to three example selectors. */
export interface DesignUse {
  /** CSS px, or the numeric weight for font weights. */
  px: number;
  count: number;
  examples: string[];
}

export interface DesignSample {
  scheme: "light" | "dark";
  colors: DesignColor[];
  text: DesignTextRun[];
  /** Text owners by half-pixel font size and by weight. */
  fontSizes: DesignUse[];
  fontWeights: DesignUse[];
  /** Uniform corner radii of painted boxes, grouped by element kind; pills and circles keep their own shape. */
  radii: Array<DesignUse & { kind: "control" | "small" | "surface"; shape: "radius" | "pill" | "circle" }>;
  /** Heights of painted form controls and buttons. */
  controls: DesignUse[];
  surfaces: Array<{ color: string; count: number }>;
  /**
   * Absolute spacing values above 1 px with the properties that produced them. A bordered padding is measured
   * from the outer edge (padding + border) and keeps the bare padding as `alt`, so either may sit on a grid.
   */
  spacingUse: Array<DesignUse & { properties: string[]; alt?: number }>;
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

  const half = (value: number): number => Math.round(value * 2) / 2;
  const uses = new Map<string, DesignUse & Record<string, unknown>>();
  const use = (group: string, px: number, element: Element, extra: Record<string, unknown> = {}, property?: string) => {
    const key = group + "|" + px + "|" + Object.values(extra).join("|");
    let entry = uses.get(key);
    if (!entry) { entry = { px, count: 0, examples: [], ...extra, ...(property ? { properties: [] as string[] } : {}) }; uses.set(key, entry); }
    entry.count++;
    if (property && !(entry.properties as string[]).includes(property)) (entry.properties as string[]).push(property);
    if (entry.examples.length < 3) { const target = kit.selector(element); if (!entry.examples.includes(target)) entry.examples.push(target); }
  };
  const used = <T>(group: string): T[] => [...uses].filter(([key]) => key.startsWith(group + "|")).map(([, value]) => value as T);

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
    use("size", half(parseFloat(style.fontSize)), owner);
    use("weight", parseInt(style.fontWeight, 10) || 400, owner);
    if (color[3] >= 0.999 && !code && !owner.closest("[contenteditable]") && !kit.disabled(owner)) addColor("text", hex(color), chars, owner);
  }

  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|OBJECT|EMBED|PICTURE|PROGRESS|METER)$/i;
  const INTERACTIVE = "button,a,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=combobox],[role=menuitem],[role=option]";
  const CONTROL = "button,select,input,[role=button],[role=combobox]";
  const NOT_BOX = /^(checkbox|radio|range|hidden|color|file|image)$/;
  const isControl = (element: Element): boolean => element.matches(CONTROL) && !(element instanceof HTMLInputElement && NOT_BOX.test(element.type)) && !element.parentElement?.closest(CONTROL);
  const elements = Array.from(document.querySelectorAll("body, body *"));
  let sampled = 0;
  for (const element of elements) {
    if (sampled >= 3000) { skipped.push({ target: "body", reason: "Design sampling limit of 3000 elements reached; remaining elements were not sampled." }); break; }
    if (!kit.visible(element)) continue;
    sampled++;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const addSpacing = (value: number, property: string, alt?: number) => {
      const px = half(Math.abs(value));
      if (px > 1) use("spacing", px, element, alt === undefined || half(alt) === px ? {} : { alt: half(alt) }, property);
    };
    let bordered = false;
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const border = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      const borderStyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      if (border > 0 && borderStyle !== "none" && borderStyle !== "hidden" && kit.rgba(style.getPropertyValue(`border-${side.toLowerCase()}-color`))[3] > 0) bordered = true;
      const padding = parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0;
      addSpacing(padding + (borderStyle === "none" || borderStyle === "hidden" ? 0 : border), "padding", padding);
      if (side === "Top" || side === "Bottom") addSpacing(parseFloat(style.getPropertyValue(`margin-${side.toLowerCase()}`)) || 0, "margin");
      const borderColor = kit.rgba(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (border >= 1 && borderStyle !== "none" && borderStyle !== "hidden" && borderColor[3] >= 0.999 && !kit.decorative(element)) {
        addColor("border", hex(borderColor), side === "Top" || side === "Bottom" ? box.width : box.height, element);
      }
    }
    for (const gap of [style.rowGap, style.columnGap]) if (gap !== "normal") addSpacing(parseFloat(gap) || 0, "gap");
    const background = kit.rgba(style.backgroundColor);
    const painted = bordered || background[3] > 0 || style.backgroundImage !== "none" || style.boxShadow !== "none" || MEDIA.test(element.tagName);
    if (painted && !kit.decorative(element) && !kit.geometryIssue(element)) {
      if (isControl(element)) use("control", half(box.height), element);
      // Circular corners only: elliptical and percentage radii are skipped, except a full 50% round.
      const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => value.trim().split(/\s+/));
      const round = corners.every(pair => pair.every(part => part === "50%"));
      const px = round ? corners.map(() => Math.min(box.width, box.height) / 2)
        : corners.some(pair => pair.some(part => part.endsWith("%")) || pair[1] !== undefined && pair[1] !== pair[0]) ? [NaN] : corners.map(pair => parseFloat(pair[0] ?? ""));
      if (px.every(Number.isFinite) && Math.max(...px) - Math.min(...px) <= 0.5 && px[0]! > 0.5) {
        const radius = px[0]!, pill = radius >= Math.min(box.width, box.height) / 2 - 0.5;
        const shape = pill ? (Math.abs(box.width - box.height) <= 1 ? "circle" : "pill") : "radius";
        const kind = element.matches(INTERACTIVE) ? "control" : box.height < 40 ? "small" : "surface";
        use("radius", shape === "radius" ? half(radius) : 0, element, { kind, shape });
      }
    }
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
      if (first && (first.closest("svg") || /^(img|video|canvas)$/i.test(first.tagName))) { surfaces.set("media", (surfaces.get("media") ?? 0) + 1); continue; }
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
    fontSizes: used("size"),
    fontWeights: used("weight"),
    radii: used("radius"),
    controls: used("control"),
    surfaces: Array.from(surfaces, ([color, count]) => ({ color, count })),
    spacingUse: used("spacing"),
    skipped,
  };
}
