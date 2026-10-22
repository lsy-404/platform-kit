import { displacementMap } from "./map.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** A resizing element rebuilds its map at most this often; a large surface's map takes tens of milliseconds. */
const REFIT_MS = 100;
/** Drawn maps kept for reuse, most recent last. */
const MAP_CACHE = 64;
/** Where a lens would hurt legibility or the person asked for less transparency, surfaces stay flat. */
export const LIQUID_GLASS_DISABLED_QUERY = "(forced-colors: active), (prefers-contrast: more), (prefers-reduced-transparency: reduce)";
/** The custom property a lensed element receives: `url(#…)`, ready to lead its `backdrop-filter`. */
export const LIQUID_GLASS_LENS_PROPERTY = "--pk-lens";
/** Elements the default `liquidGlass()` watch refracts. */
export const LIQUID_GLASS_SELECTOR = ".pk-glass, .pk-glass-field, [data-pk-glass]";

interface Lens { id: string; filter: SVGFilterElement; users: number }
interface DrawnMap { url: string; scale: number }

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

function drawMap(w: number, h: number, radius: number): DrawnMap {
  const map = displacementMap(w, h, radius);
  const canvas = document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  canvas.getContext("2d")?.putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
  return { url: canvas.toDataURL(), scale: map.scale };
}

function cachedMap(key: string, w: number, h: number, radius: number): DrawnMap {
  let map = maps.get(key);
  if (map) maps.delete(key);
  else map = drawMap(w, h, radius);
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

/** One filter per element size and corner radius, shared by every element of that shape. */
function acquire(w: number, h: number, radius: number): Lens {
  const key = `${w}x${h}r${radius}`;
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
    const { url, scale } = cachedMap(key, w, h, radius);
    const image = document.createElementNS(SVG_NS, "feImage");
    image.setAttribute("href", url);
    image.setAttribute("width", String(w));
    image.setAttribute("height", String(h));
    image.setAttribute("result", "map");
    const displace = document.createElementNS(SVG_NS, "feDisplacementMap");
    displace.setAttribute("in", "SourceGraphic");
    displace.setAttribute("in2", "map");
    displace.setAttribute("scale", String(scale));
    displace.setAttribute("xChannelSelector", "R");
    displace.setAttribute("yChannelSelector", "G");
    filter.append(image, displace);
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
const bound = new WeakMap<HTMLElement, Binding>();

function refit(el: HTMLElement, binding: Binding): void {
  binding.timer = null;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  // A hidden view (kept alive, collapsed panel) keeps its last lens until it has a size again.
  if (w < 2 || h < 2) return;
  const radius = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  const previous = binding.lens;
  binding.lens = acquire(w, h, radius);
  if (previous) release(previous);
  el.style.setProperty(LIQUID_GLASS_LENS_PROPERTY, `url(#${binding.lens.id})`);
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
