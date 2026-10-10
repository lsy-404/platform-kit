import { defineComponent, h, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { measureSvg } from "../behavior/visual-center.js";
import { fluentThemeKey } from "../theme.js";

type GraphicPoint = { x: number; y: number };
type GraphicBounds = GraphicPoint & { width: number; height: number };
type GraphicMeasurement = { width: number; height: number; bounds: GraphicBounds | null; center: GraphicPoint | null; offset: GraphicPoint | null; status: "estimated" | "empty" | "no-contrast"; svg: string };
type GraphicsResult = { measurement: GraphicMeasurement; referenceAscent: number };

function resolvedColor(element: HTMLElement, value: string | undefined, property: "color" | "backgroundColor", fallback: string): string {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) return fallback;
  const pixel = (candidate: string): [number, number, number, number] => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "#000";
    canvas.fillStyle = candidate;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!, a! / 255];
  };
  if (property === "color") { canvas.fillStyle = value ?? style.color; return canvas.fillStyle; }
  const stack: string[] = [];
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const ancestorStyle = getComputedStyle(ancestor);
    if (!value && ancestorStyle.backgroundImage !== "none") throw new Error("Set background explicitly for gradient or image surfaces");
    stack.push(ancestorStyle.backgroundColor);
    ancestor = ancestor.parentElement;
  }
  if (value) stack.push(value);
  let color = pixel(fallback).slice(0, 3) as [number, number, number];
  for (const layer of stack.reverse()) {
    const [r, g, b, alpha] = pixel(layer);
    color = [r * alpha + color[0] * (1 - alpha), g * alpha + color[1] * (1 - alpha), b * alpha + color[2] * (1 - alpha)];
  }
  return `rgb(${color.map(channel => Math.round(channel)).join(", ")})`;
}

function fontReference(script: string, font: string, context: CanvasRenderingContext2D): number {
  context.font = font;
  const metrics = context.measureText(script);
  return metrics.actualBoundingBoxAscent || context.measureText("H").actualBoundingBoxAscent || 1;
}

function useMeasurement(props: { svg: string; size: number; trim: boolean; optical: boolean; foreground?: string; background?: string }, element: () => HTMLElement | null, text: () => string, emit: (event: "ready" | "error", value: GraphicMeasurement | Error) => void) {
  const theme = inject(fluentThemeKey, undefined);
  const result = ref<GraphicsResult>();
  const status = ref<GraphicMeasurement["status"] | "pending" | "error">("pending");
  let alive = true;
  let run = 0;
  const observers: MutationObserver[] = [];
  let resizeObserver: ResizeObserver | undefined;
  let fontSignature = "";
  const refresh = async () => {
    const node = element();
    if (!node || typeof document === "undefined") return;
    const id = ++run;
    status.value = "pending";
    try {
      await document.fonts?.ready;
      const fg = resolvedColor(node, props.foreground, "color", "#000");
      const style = getComputedStyle(node);
      const bg = resolvedColor(node, props.background, "backgroundColor", "#fff");
      const measurement = await measureSvg(props.svg, { width: finiteSize(props.size), height: finiteSize(props.size), background: bg, color: fg }) as GraphicMeasurement;
      const canvas = document.createElement("canvas").getContext("2d");
      const label = text();
      const script = /[\u2e80-\u9fff\uf900-\ufaff]/u.test(label) ? "中" : "H";
      const ascent = canvas ? fontReference(script, style.font, canvas) : finiteSize(props.size);
      if (alive && id === run) { result.value = { measurement, referenceAscent: ascent }; status.value = measurement.status; emit("ready", measurement); }
    } catch (error) {
      if (alive && id === run) { result.value = undefined; status.value = "error"; emit("error", error instanceof Error ? error : new Error("SVG measurement failed")); }
    }
  };
  onMounted(() => {
    const node = element();
    const labelNode = node?.querySelector(".fluent-icon-text__label");
    if (labelNode) {
      const observer = new MutationObserver(refresh);
      observer.observe(labelNode, { childList: true, characterData: true, subtree: true });
      observers.push(observer);
    }
    let ancestor = node?.parentElement ?? null;
    while (ancestor) {
      const observer = new MutationObserver(refresh);
      observer.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "dir", "data-fluent-theme"] });
      observers.push(observer);
      ancestor = ancestor.parentElement;
    }
    if (node && typeof ResizeObserver !== "undefined") {
      fontSignature = getComputedStyle(node).font;
      resizeObserver = new ResizeObserver(() => {
        const next = node.isConnected ? getComputedStyle(node).font : "";
        if (next !== fontSignature) { fontSignature = next; refresh(); }
      });
      resizeObserver.observe(node);
    }
    document.fonts?.addEventListener("loadingdone", refresh);
    refresh();
  });
  watch(() => [props.svg, props.size, props.trim, props.optical, props.foreground, props.background, theme?.value.mode, theme?.value.accent, theme?.value.accentText, theme?.value.resolveTokens?.(), text()], refresh, { deep: true });
  onBeforeUnmount(() => { alive = false; run++; observers.forEach(observer => observer.disconnect()); resizeObserver?.disconnect(); document.fonts?.removeEventListener("loadingdone", refresh); });
  return { result, status };
}

function finiteSize(size: number): number { return Number.isFinite(size) && size > 0 ? size : 16; }

export const FluentSvgIcon = defineComponent({
  name: "FluentSvgIcon",
  inheritAttrs: false,
  props: {
    svg: { type: String, required: true }, size: { type: Number, default: 16 }, trim: { type: Boolean, default: true },
    optical: { type: Boolean, default: true }, foreground: String, background: String, label: String,
  },
  emits: ["ready", "error"],
  setup(props, { attrs, emit }) {
    const root = ref<HTMLElement | null>(null);
    const { result, status } = useMeasurement(props, () => root.value, () => "", (event, value) => emit(event, value));
    return () => {
      const size = finiteSize(props.size);
      const data = result.value?.measurement;
      const bounds = props.trim ? data?.bounds : null;
      const center = props.optical && data?.center ? data.center : bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : { x: (data?.width ?? size) / 2, y: (data?.height ?? size) / 2 };
      const extent = bounds ? Math.max(center.x - bounds.x, bounds.x + bounds.width - center.x, center.y - bounds.y, bounds.y + bounds.height - center.y) : Math.max(data?.width ?? size, data?.height ?? size) / 2;
      const scale = props.trim && extent > 0 ? size / (2 * extent) : (data ? Math.min(size / data.width, size / data.height) : 1);
      const sx = scale;
      const sy = scale;
      const dx = props.trim ? size / 2 - center.x * scale : (size - (data?.width ?? size) * scale) / 2 + (props.optical ? Math.max(-center.x * scale, Math.min(size - (data?.width ?? size) * scale - center.x * scale, size / 2 - center.x * scale)) : 0);
      const dy = props.trim ? size / 2 - center.y * scale : (size - (data?.height ?? size) * scale) / 2 + (props.optical ? size / 2 - center.y * scale : 0);
      return h("span", { ...attrs, ref: root, class: ["fluent-svg-icon", attrs.class], "data-status": status.value, style: [{ "--fluent-graphic-size": `${size}px` }, attrs.style], role: props.label ? "img" : undefined, "aria-label": props.label, "aria-hidden": props.label ? undefined : "true" }, [
        h("span", { class: "fluent-svg-icon__paint", style: { width: `${data?.width ?? size}px`, height: `${data?.height ?? size}px`, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` } }, data ? [h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`, alt: "", draggable: false })] : []),
      ]);
    };
  },
});

export const FluentIconText = defineComponent({
  name: "FluentIconText",
  inheritAttrs: false,
  props: {
    svg: { type: String, required: true }, size: { type: Number, default: 16 }, trim: { type: Boolean, default: true },
    optical: { type: Boolean, default: true }, foreground: String, background: String,
  },
  emits: ["ready", "error"],
  setup(props, { attrs, slots, emit }) {
    const root = ref<HTMLElement | null>(null);
    const labelText = () => root.value?.querySelector(".fluent-icon-text__label")?.textContent?.trim() ?? "";
    const { result, status } = useMeasurement(props, () => root.value, labelText, (event, value) => emit(event, value));
    return () => {
      const size = finiteSize(props.size);
      const data = result.value?.measurement;
      const bounds = props.trim ? data?.bounds : null;
      const paintWidth = bounds?.width ?? data?.width ?? size;
      const scale = bounds ? size / Math.max(bounds.width, bounds.height) : (data ? Math.min(size / data.width, size / data.height) : 1);
      const dx = bounds ? -bounds.x * scale : 0;
      const referenceAscent = result.value?.referenceAscent ?? size;
      const center = props.optical ? data?.center?.y ?? (bounds ? bounds.y + bounds.height / 2 : size / 2) : (bounds ? bounds.y + bounds.height / 2 : size / 2);
      const y = size - referenceAscent / 2 - center * scale;
      const img = h("span", { class: "fluent-icon-text__icon", "aria-hidden": "true", style: { width: `${paintWidth * scale}px`, height: `${size}px` } }, [
        h("span", { class: "fluent-icon-text__paint", style: { width: `${data?.width ?? size}px`, height: `${data?.height ?? size}px`, transform: `translate(${dx}px, ${y}px) scale(${scale})` } }, data ? [h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`, alt: "", draggable: false })] : []),
      ]);
      return h("span", { ...attrs, ref: root, class: ["fluent-icon-text", attrs.class], "data-status": status.value, style: [{ "--fluent-graphic-size": `${size}px` }, attrs.style] }, [img, h("span", { class: "fluent-icon-text__label" }, slots.default?.())]);
    };
  },
});
