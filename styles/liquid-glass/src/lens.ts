import { slicedDisplacementMap, type LensTuning, type MapSlice } from "./map.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** A resizing element rebuilds its map at most this often; a large surface's map takes tens of milliseconds. */
const REFIT_MS = 100;
/** Drawn maps kept for reuse, most recent last. */
const MAP_CACHE = 64;
/** Rim blur that adds less than this to the element's own frost, in pixels, cannot be seen and is left out. */
const EDGE_BLUR_VISIBLE = 0.5;
/** Where a lens would hurt legibility or the person asked for less transparency, surfaces stay flat. */
export const LIQUID_GLASS_DISABLED_QUERY = "(forced-colors: active), (prefers-contrast: more), (prefers-reduced-transparency: reduce)";
/** The custom property a lensed element receives: `url(#…)`, ready to lead its `backdrop-filter`. */
export const LIQUID_GLASS_LENS_PROPERTY = "--pk-lens";
/**
 * Per-element tuning, read from inherited custom properties whenever a lens is fitted (set them on :root or any
 * container, then call refreshLiquidGlass() to refit what is already on screen): `--pk-glass-refraction` and
 * `--pk-glass-rim-width` scale the demo's bend and rim band, `--pk-glass-edge-blur` blurs the rim band in pixels.
 * The rim blur is dropped where the element's own `backdrop-filter` blur already hides it, so a lens fitted before
 * that frost changes needs refreshLiquidGlass() too.
 */
export const LIQUID_GLASS_TUNING_PROPERTIES = ["--pk-glass-refraction", "--pk-glass-rim-width", "--pk-glass-edge-blur"] as const;
/** Elements the default `liquidGlass()` watch refracts. */
export const LIQUID_GLASS_SELECTOR = ".pk-glass, .pk-glass-field, [data-pk-glass]";

interface Lens { id: string; filter: SVGFilterElement; users: number }
interface DrawnSlice { url: string; x: number; y: number; width: number; height: number }
interface DrawnMap { slices: DrawnSlice[]; scale: number }

let defs: SVGDefsElement | null = null;
const lenses = new Map<string, Lens>();
/** Drawn maps outlive their filters, so a view coming back from a cache does not redraw its surfaces. */
const maps = new Map<string, DrawnMap>();
let nextId = 0;

/** Whether this engine can lead a `backdrop-filter` with an SVG filter (Chromium can; others keep the material only). */
export function liquidGlassSupported(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#pk-lens) blur(1px)")
    && typeof ResizeObserver !== "undefined";
}

interface Tuning extends Required<LensTuning> { edgeBlur: number }

function tuningValue(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The standard deviation of every `blur()` the element's backdrop filter applies after its lens. */
function frostBlur(style: CSSStyleDeclaration): number {
  let variance = 0;
  for (const [, px] of style.backdropFilter.matchAll(/blur\(([\d.]+)px\)/g)) variance += Number(px) ** 2;
  return Math.sqrt(variance);
}

function readTuning(style: CSSStyleDeclaration): Tuning {
  const frost = frostBlur(style);
  const edgeBlur = tuningValue(style, "--pk-glass-edge-blur", 0);
  return {
    refraction: tuningValue(style, "--pk-glass-refraction", 1),
    rimWidth: tuningValue(style, "--pk-glass-rim-width", 1),
    // Blurs stack in quadrature; the rim blur's branch costs several full-size passes per frame for each element.
    edgeBlur: Math.hypot(edgeBlur, frost) - frost < EDGE_BLUR_VISIBLE ? 0 : edgeBlur,
  };
}

function drawSlice(slice: MapSlice): DrawnSlice {
  const canvas = document.createElement("canvas");
  canvas.width = slice.dataWidth;
  canvas.height = slice.dataHeight;
  canvas.getContext("2d")?.putImageData(new ImageData(slice.data, slice.dataWidth, slice.dataHeight), 0, 0);
  return { url: canvas.toDataURL(), x: slice.x, y: slice.y, width: slice.width, height: slice.height };
}

function drawMap(w: number, h: number, radius: number, tuning: Tuning): DrawnMap {
  const map = slicedDisplacementMap(w, h, radius, tuning);
  return { slices: map.slices.map(drawSlice), scale: map.scale };
}

function cachedMap(key: string, w: number, h: number, radius: number, tuning: Tuning): DrawnMap {
  let map = maps.get(key);
  if (map) maps.delete(key);
  else map = drawMap(w, h, radius, tuning);
  maps.set(key, map);
  if (maps.size > MAP_CACHE) maps.delete(maps.keys().next().value!);
  return map;
}

function ensureDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.dataset.pkLiquidGlass = "";
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}

/** Primitives that leave the map in `map`: one image, or the slices laid over a neutral fill. */
function mapPrimitives(slices: DrawnSlice[], w: number, h: number): SVGElement[] {
  // Stretching a one-pixel edge line to its length takes ignoring its aspect ratio.
  const image = (slice: DrawnSlice, result: string) => svg("feImage", {
    href: slice.url, x: slice.x, y: slice.y, width: slice.width, height: slice.height, preserveAspectRatio: "none", result,
  });
  if (slices.length === 1) return [image(slices[0]!, "map")];
  const merge = svg("feMerge", { result: "map" });
  merge.append(svg("feMergeNode", { in: "neutral" }), ...slices.map((_, i) => svg("feMergeNode", { in: `slice${i}` })));
  return [
    svg("feFlood", { "flood-color": "rgb(128, 128, 0)", "flood-opacity": 1, x: 0, y: 0, width: w, height: h, result: "neutral" }),
    ...slices.map((slice, i) => image(slice, `slice${i}`)),
    merge,
  ];
}

/** One filter per element size, corner radius and tuning, shared by every element of that shape. */
function acquire(w: number, h: number, radius: number, tuning: Tuning): Lens {
  const mapKey = `${w}x${h}r${radius}f${tuning.refraction}w${tuning.rimWidth}`;
  const key = `${mapKey}b${tuning.edgeBlur}`;
  let lens = lenses.get(key);
  if (!lens) {
    const id = `pk-lens-${nextId++}`;
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(w));
    filter.setAttribute("height", String(h));
    const { slices, scale } = cachedMap(mapKey, w, h, radius, tuning);
    filter.append(...mapPrimitives(slices, w, h));
    filter.append(
      svg("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale, xChannelSelector: "R", yChannelSelector: "G", result: "bent" }),
    );
    if (tuning.edgeBlur > 0) {
      // The map's blue channel weighs the rim band: blur the bent page, keep it only there, lay it over the sharp middle.
      const merge = svg("feMerge", {});
      merge.append(svg("feMergeNode", { in: "bent" }), svg("feMergeNode", { in: "rim" }));
      filter.append(
        svg("feGaussianBlur", { in: "bent", stdDeviation: tuning.edgeBlur, edgeMode: "duplicate", result: "soft" }),
        svg("feColorMatrix", { in: "map", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0", result: "band" }),
        svg("feComposite", { in: "soft", in2: "band", operator: "in", result: "rim" }),
        merge,
      );
    }
    ensureDefs().appendChild(filter);
    lens = { id, filter, users: 0 };
    lenses.set(key, lens);
  }
  lens.users++;
  return lens;
}

function release(lens: Lens): void {
  if (--lens.users > 0) return;
  lens.filter.remove();
  for (const [key, value] of lenses) if (value === lens) lenses.delete(key);
}

interface Binding { lens: Lens | null; observer: ResizeObserver; timer: ReturnType<typeof setTimeout> | null }
const bound = new Map<HTMLElement, Binding>();

function refit(el: HTMLElement, binding: Binding): void {
  binding.timer = null;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  // A hidden view (kept alive, collapsed panel) keeps its last lens until it has a size again.
  if (w < 2 || h < 2) return;
  const style = getComputedStyle(el);
  const radius = Math.round(parseFloat(style.borderTopLeftRadius) || 0);
  const previous = binding.lens;
  binding.lens = acquire(w, h, radius, readTuning(style));
  if (previous) release(previous);
  el.style.setProperty(LIQUID_GLASS_LENS_PROPERTY, `url(#${binding.lens.id})`);
}

/** Refits every refracting element, after its tuning properties (or anything else its lens reads) changed. */
export function refreshLiquidGlass(): void {
  for (const [el, binding] of bound) {
    if (binding.timer !== null) clearTimeout(binding.timer);
    refit(el, binding);
  }
}

/** Whether `el` currently refracts. */
export function isLiquidGlass(el: HTMLElement): boolean {
  return bound.has(el);
}

/**
 * Bends the page behind `el`'s rim: `el` gets `data-liquid-glass` and `--pk-lens`, and its lens follows its size.
 * Returns false where the engine or the person's settings keep surfaces flat.
 */
export function attachLiquidGlass(el: HTMLElement): boolean {
  if (bound.has(el)) return true;
  if (!liquidGlassSupported() || window.matchMedia(LIQUID_GLASS_DISABLED_QUERY).matches) return false;
  // ResizeObserver already reports at most once a frame: the first size fits at once, later ones are throttled.
  const binding: Binding = {
    lens: null,
    timer: null,
    observer: new ResizeObserver(() => {
      if (!binding.lens) refit(el, binding);
      else binding.timer ??= setTimeout(() => refit(el, binding), REFIT_MS);
    }),
  };
  bound.set(el, binding);
  el.dataset.liquidGlass = "";
  binding.observer.observe(el);
  return true;
}

/** Lets `el` go flat again and frees its lens once no other element of its shape uses it. */
export function detachLiquidGlass(el: HTMLElement): void {
  const binding = bound.get(el);
  if (!binding) return;
  binding.observer.disconnect();
  if (binding.timer !== null) clearTimeout(binding.timer);
  if (binding.lens) release(binding.lens);
  bound.delete(el);
  delete el.dataset.liquidGlass;
  el.style.removeProperty(LIQUID_GLASS_LENS_PROPERTY);
}

export interface LiquidGlassOptions {
  /** Elements to refract. Defaults to `.pk-glass, .pk-glass-field, [data-pk-glass]`. */
  selector?: string;
  /**
   * Leave an element flat when it sits inside another refracting one (default true). The outer surface's
   * backdrop filter makes it the inner one's backdrop root, so an inner lens would only bend the outer fill.
   */
  flatWhenNested?: boolean;
}

/**
 * Keeps every element matching `selector` under `root` refracting: elements are lensed as they appear and
 * released once they leave the document (a cached view returning re-adds them, its maps still drawn).
 * Returns a function that stops watching and lets every element go flat.
 */
export function liquidGlass(root: ParentNode = document.body, options: LiquidGlassOptions = {}): () => void {
  const selector = options.selector ?? LIQUID_GLASS_SELECTOR;
  const flatWhenNested = options.flatWhenNested ?? true;
  const taken = new Set<HTMLElement>();
  const take = (el: HTMLElement) => {
    if (taken.has(el) || bound.has(el)) return;
    if (flatWhenNested && el.parentElement?.closest(selector)) return;
    if (attachLiquidGlass(el)) taken.add(el);
  };
  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selector)) take(node);
    for (const el of node.querySelectorAll<HTMLElement>(selector)) take(el);
  };
  let sweep = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scan);
      if (record.removedNodes.length) sweep = true;
    }
    // A node moved within the document is removed and re-added in one batch, so only the ones still gone let go.
    if (!sweep) return;
    sweep = false;
    for (const el of taken) {
      if (el.isConnected) continue;
      taken.delete(el);
      detachLiquidGlass(el);
    }
  });
  if (root instanceof HTMLElement) scan(root);
  else for (const el of root.querySelectorAll<HTMLElement>(selector)) take(el);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const el of taken) detachLiquidGlass(el);
    taken.clear();
  };
}
