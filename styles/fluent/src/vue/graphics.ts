import { defineComponent, h, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { measureSvg } from "../behavior/visual-center.js";
import { fluentThemeKey } from "../theme.js";

type GraphicPoint = { x: number; y: number };
type GraphicBounds = GraphicPoint & { width: number; height: number };
type GraphicMeasurement = { width: number; height: number; bounds: GraphicBounds | null; center: GraphicPoint | null; offset: GraphicPoint | null; status: "estimated" | "empty" | "no-contrast"; svg: string };
type GraphicsResult = { measurement: GraphicMeasurement; referenceMiddle: number };

function resolvedColor(element: HTMLElement, value: string | undefined, property: "color" | "backgroundColor"): string {
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) throw new Error("Canvas 2D is unavailable");
  const pixel = (candidate: string): [number, number, number, number] => {
    if (!CSS.supports("color", candidate)) throw new Error("Expected a CSS color");
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = candidate;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!, a! / 255];
  };
  if (property === "color") {
    const [r,g,b,a] = pixel(value ?? getComputedStyle(element).color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (value !== undefined) {
    const [r,g,b,a] = pixel(value);
    if (a !== 1) throw new Error("An explicit background must be opaque");
    return `rgb(${r}, ${g}, ${b})`;
  }
  let red = 0, green = 0, blue = 0, coverage = 0;
  for (let ancestor: HTMLElement | null = element; ancestor && coverage < 1; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.backgroundImage !== "none") throw new Error("Set background explicitly for gradient or image surfaces");
    const [r,g,b,a] = pixel(style.backgroundColor);
    const contribution = (1 - coverage) * a;
    red += r * contribution; green += g * contribution; blue += b * contribution; coverage += contribution;
  }
  const canvasColor = pixel("Canvas");
  const channels = [red + (1-coverage)*canvasColor[0],green + (1-coverage)*canvasColor[1],blue + (1-coverage)*canvasColor[2]];
  return `rgb(${channels.map(Math.round).join(", ")})`;
}

function fontReference(script: string, font: string): number {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.font = font;
  const metrics = context.measureText(script);
  return (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
}

function useMeasurement(props: { svg: string; size: number; trim: boolean; optical: boolean; foreground?: string; background?: string }, element: () => HTMLElement | null, text: () => string, emit: (event: "ready" | "error", value: GraphicMeasurement | Error) => void) {
  const theme = inject(fluentThemeKey, undefined);
  const result = ref<GraphicsResult>();
  const status = ref<GraphicMeasurement["status"] | "pending" | "error">("pending");
  let alive = true, run = 0, queued = false, lastKey = "";
  const observers: MutationObserver[] = [];
  let resizeObserver: ResizeObserver | undefined;
  let media: MediaQueryList | undefined;
  let interaction: Element | null = null;
  const interactionEvents = ["pointerenter","pointerleave","pointerdown","pointerup","focusin","focusout","keydown","keyup","transitionend"];
  const refresh = async () => {
    const node = element();
    if (!node || !alive || typeof document === "undefined") return;
    const id = ++run;
    try {
      await document.fonts?.ready;
      if (!alive || id !== run) return;
      if (!Number.isFinite(props.size) || props.size <= 0 || props.size > 2048) throw new Error("Icon size must be between 0 and 2048 pixels");
      const fg = resolvedColor(node, props.foreground, "color");
      const bg = resolvedColor(node, props.background, "backgroundColor");
      const font = getComputedStyle(node.querySelector(".fluent-icon-text__label") ?? node).font;
      const script = /[\u2e80-\u9fff\uf900-\ufaff]/u.test(text()) ? "中" : "H";
      const referenceMiddle = fontReference(script, font);
      const key = JSON.stringify([props.svg,props.size,fg,bg,font,referenceMiddle]);
      if (key === lastKey && result.value) { status.value = result.value.measurement.status; return; }
      status.value = "pending";
      const measurement = await measureSvg(props.svg, {width:props.size,height:props.size,background:bg,color:fg});
      if (alive && id === run) { lastKey = key; result.value = {measurement,referenceMiddle}; status.value = measurement.status; emit("ready",measurement); }
    } catch (error) {
      if (alive && id === run) { lastKey = ""; result.value = undefined; status.value = "error"; emit("error",error instanceof Error ? error : new Error("SVG measurement failed")); }
    }
  };
  const schedule = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; void refresh(); });
  };
  onMounted(() => {
    const node = element();
    const label = node?.querySelector(".fluent-icon-text__label");
    if (label) {
      const observer = new MutationObserver(schedule);
      observer.observe(label,{childList:true,characterData:true,subtree:true}); observers.push(observer);
    }
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const observer = new MutationObserver(schedule);
      observer.observe(ancestor,{attributes:true,attributeFilter:["class","style","dir","data-fluent-theme","disabled","aria-disabled","aria-pressed"]}); observers.push(observer);
    }
    if (node && typeof ResizeObserver !== "undefined") { resizeObserver = new ResizeObserver(schedule); resizeObserver.observe(node); }
    interaction = node?.closest("button,a,label,[role=button],[role=link]") ?? node;
    for (const event of interactionEvents) interaction?.addEventListener(event,schedule);
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change",schedule);
    window.addEventListener("resize",schedule);
    document.fonts?.addEventListener("loadingdone",schedule);
    schedule();
  });
  watch(() => [props.svg,props.size,props.foreground,props.background,theme?.value],schedule,{deep:true,flush:"post"});
  onBeforeUnmount(() => {
    alive = false; run++; observers.forEach(observer => observer.disconnect()); resizeObserver?.disconnect();
    for (const event of interactionEvents) interaction?.removeEventListener(event,schedule);
    media?.removeEventListener("change",schedule);
    if (typeof window !== "undefined") window.removeEventListener("resize",schedule);
    if (typeof document !== "undefined") document.fonts?.removeEventListener("loadingdone",schedule);
  });
  return {result,status};
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
      const bounds = data?.bounds;
      const sourceWidth = data?.width ?? size, sourceHeight = data?.height ?? size;
      const center = props.optical && data?.center ? data.center
        : props.trim && bounds ? {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}
        : {x:sourceWidth/2,y:sourceHeight/2};
      const extent = bounds ? Math.max(center.x-bounds.x,bounds.x+bounds.width-center.x,center.y-bounds.y,bounds.y+bounds.height-center.y) : 0;
      const baseScale = size / Math.max(sourceWidth,sourceHeight);
      const containedScale = extent > 0 ? size / (2*extent) : baseScale;
      const scale = props.trim && bounds ? containedScale : Math.min(baseScale,containedScale);
      const dx = size/2-center.x*scale, dy = size/2-center.y*scale;
      return h("span", { ...attrs, ref: root, class: ["fluent-svg-icon", attrs.class], "data-status": status.value, style: [{ "--fluent-graphic-size": `${size}px` }, attrs.style], role: props.label ? "img" : undefined, "aria-label": props.label, "aria-hidden": props.label ? undefined : "true" }, [
        h("span", { class: "fluent-svg-icon__paint", style: { width: `${data?.width ?? size}px`, height: `${data?.height ?? size}px`, transform: `translate(${dx}px, ${dy}px) scale(${scale})` } }, data ? [h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`, alt: "", draggable: false })] : []),
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
      const bounds = data?.bounds;
      const sourceWidth = data?.width ?? size, sourceHeight = data?.height ?? size;
      const center = props.optical && data?.center ? data.center.y
        : props.trim && bounds ? bounds.y + bounds.height / 2 : sourceHeight / 2;
      const extent = bounds ? Math.max(center-bounds.y,bounds.y+bounds.height-center) : sourceHeight/2;
      const paintWidth = props.trim && bounds ? bounds.width : sourceWidth;
      const containedScale = size / Math.max(paintWidth,2*extent);
      const scale = props.trim && bounds ? containedScale : Math.min(size/Math.max(sourceWidth,sourceHeight),containedScale);
      const dx = props.trim && bounds ? -bounds.x * scale : 0;
      const referenceMiddle = result.value?.referenceMiddle ?? size/2;
      const y = size/2 - center * scale;
      const img = h("span", { class: "fluent-icon-text__icon", "aria-hidden": "true", style: { width: `${paintWidth * scale}px`, height: `${size}px`, verticalAlign: `${referenceMiddle-size/2}px` } }, [
        h("span", { class: "fluent-icon-text__paint", style: { width: `${data?.width ?? size}px`, height: `${data?.height ?? size}px`, transform: `translate(${dx}px, ${y}px) scale(${scale})` } }, data ? [h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`, alt: "", draggable: false })] : []),
      ]);
      return h("span", { ...attrs, ref: root, class: ["fluent-icon-text", attrs.class], "data-status": status.value, style: [{ "--fluent-graphic-size": `${size}px` }, attrs.style] }, [img, h("span", { class: "fluent-icon-text__label" }, slots.default?.())]);
    };
  },
});
