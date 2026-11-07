import { computed, defineComponent, h, nextTick, reactive, ref, watch, type PropType } from "vue";
import { FluentSegmented, FluentSlider, FluentSvgIcon, type FluentGraphicScale } from "@platform-kit/fluent/vue";
import { card } from "../card.js";

type Point = { x: number; y: number };
type Measurement = { bounds: (Point & { width: number; height: number }) | null; center: Point | null; status: "estimated" | "empty" | "no-contrast" };
interface Pair { left: string; right: string; background: string }
interface Markers { geometric: Point; weighted: Point }

const size = 88;
const blocks = ({ left, right }: Pair) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="8" width="8" height="16" fill="${left}"/><rect x="19" y="8" width="8" height="16" fill="${right}"/></svg>`;

const examples: (Pair & { name: string; note: string })[] = [
  { name: "Dark and light grey on white", note: "On white the dark block is heavier.", left: "#1b1b1b", right: "#c8c8c8", background: "#ffffff" },
  { name: "The same pair on dark", note: "On a dark surface the light block is heavier, so the centre moves to the other side.", left: "#1b1b1b", right: "#c8c8c8", background: "#202020" },
  { name: "Red and yellow on white", note: "Yellow is close to white, so red carries the weight.", left: "#e81123", right: "#ffb900", background: "#ffffff" },
];

const scaleOptions: { value: FluentGraphicScale; label: string; note: string }[] = [
  { value: "fill", label: "Fill", note: "Grows the icon to the largest size that keeps every pixel in the slot after centring." },
  { value: "fit", label: "Fit", note: "Keeps the drawn size and only shrinks when the shift would push paint out of the slot." },
  { value: "none", label: "None", note: "Keeps the drawn size even if centring clips the edge." },
];

const geometricOf = (data: Measurement) => data.bounds ? { x: data.bounds.x + data.bounds.width / 2, y: data.bounds.y + data.bounds.height / 2 } : null;

const shiftText = (measurement: Measurement | undefined) => {
  if (!measurement) return "Measuring…";
  const geometric = geometricOf(measurement);
  if (measurement.status !== "estimated" || !measurement.center || !geometric) return "No contrast against this surface";
  const shift = measurement.center.x - geometric.x;
  if (Math.abs(shift) < 0.05) return "The weighted centre matches the geometric centre";
  return `Weighted centre ${Math.abs(shift).toFixed(1)} px ${shift < 0 ? "left" : "right"} of the geometric centre`;
};

// Circle = geometric centre of the painted bounds, dot = colour-weighted centre.
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.4;
};

const overlay = (markers: Markers | null, surface: string) => markers ? h("svg", { class: ["weight-overlay", { "is-on-dark": isDark(surface) }], viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" }, [
  h("line", { class: "weight-overlay__shift", x1: markers.geometric.x, y1: markers.geometric.y, x2: markers.weighted.x, y2: markers.weighted.y }),
  h("circle", { class: "weight-overlay__geometric", cx: markers.geometric.x, cy: markers.geometric.y, r: 6 }),
  h("circle", { class: "weight-overlay__weighted", cx: markers.weighted.x, cy: markers.weighted.y, r: 3 }),
]) : null;

const paintTransform = (element: HTMLElement | null) => {
  const style = element?.querySelector<HTMLElement>(".fluent-svg-icon__paint")?.style.transform ?? "";
  const match = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(style);
  return match ? { dx: Number(match[1]), dy: Number(match[2]), scale: Number(match[3]) } : null;
};

const WeightSample = defineComponent({
  props: { pair: { type: Object as PropType<Pair>, required: true }, scale: { type: String as PropType<FluentGraphicScale>, required: true }, strength: { type: Number, required: true }, name: String },
  setup(props) {
    const measurement = ref<Measurement>();
    const aligned = ref<HTMLElement | null>(null);
    const alignedMarkers = ref<Markers | null>(null);
    const svg = computed(() => blocks(props.pair));
    const measured = computed<Markers | null>(() => {
      const data = measurement.value, geometric = data && geometricOf(data);
      return data?.center && geometric ? { geometric, weighted: data.center } : null;
    });
    const placeAligned = async () => {
      await nextTick();
      const transform = paintTransform(aligned.value), markers = measured.value;
      if (!transform || !markers) { alignedMarkers.value = null; return; }
      const place = (point: Point) => ({ x: transform.dx + point.x * transform.scale, y: transform.dy + point.y * transform.scale });
      alignedMarkers.value = { geometric: place(markers.geometric), weighted: place(markers.weighted) };
    };
    watch(() => [props.scale, props.strength, measured.value], placeAligned);
    const box = (caption: string, children: unknown[], target = false) => h("figure", { class: "weight-box" }, [
      h("div", { class: ["weight-box__surface", { "weight-box__surface--target": target }], style: { background: props.pair.background } }, children as never),
      h("figcaption", caption),
    ]);
    return () => h("div", { class: "weight-sample" }, [
      h("div", { class: "weight-sample__boxes" }, [
        box("As drawn", [
          h(FluentSvgIcon, { svg: svg.value, size, trim: false, optical: false, scale: "none", background: props.pair.background, label: `${props.name ?? "Custom"} as drawn`, onReady: (value: Measurement) => { measurement.value = value; } }),
          overlay(measured.value, props.pair.background),
        ]),
        box("Centred", [
          h("div", { ref: aligned, class: "weight-box__icon" }, h(FluentSvgIcon, { svg: svg.value, size, scale: props.scale, opticalStrength: props.strength, background: props.pair.background, label: `${props.name ?? "Custom"} centred on its weighted centre`, onReady: placeAligned })),
          overlay(alignedMarkers.value, props.pair.background),
        ], true),
      ]),
      h("p", { class: "weight-sample__result", "aria-live": "polite" }, shiftText(measurement.value)),
    ]);
  },
});

const chip = (color: string, label: string) => h("span", { class: "weight-chip" }, [h("span", { class: "weight-chip__swatch", style: { background: color } }), label]);

export const VisualWeightCard = defineComponent({
  setup() {
    const custom = reactive<Pair>({ left: "#744da9", right: "#ffb900", background: "#ffffff" });
    const scale = ref<FluentGraphicScale>("fill");
    const strength = ref(100);
    const picker = (key: keyof Pair, label: string) => h("label", { class: "weight-picker" }, [
      h("input", { type: "color", value: custom[key], onInput: (event: Event) => { custom[key] = (event.target as HTMLInputElement).value; } }),
      label,
    ]);
    return () => card("showcase-visual-weight", "Visual weight depends on colour", "The visual centre is the centroid of every pixel weighted by its Oklab distance from the surface, so the same two blocks balance differently as their colours or the surface change.", [
      h("div", { class: "weight-toolbar" }, [
        h("div", { class: "weight-legend", "aria-hidden": "true" }, [
          h("span", [h("svg", { viewBox: "0 0 16 16", width: 16, height: 16 }, h("circle", { class: "weight-overlay__geometric", cx: 8, cy: 8, r: 6 })), "Geometric centre"]),
          h("span", [h("svg", { viewBox: "0 0 16 16", width: 16, height: 16 }, h("circle", { class: "weight-overlay__weighted", cx: 8, cy: 8, r: 3 })), "Weighted centre"]),
        ]),
        h("div", { class: "weight-strength" }, [
          h(FluentSlider, { label: "Adjustment strength", "data-testid": "showcase-weight-strength", min: 0, max: 100, tickFrequency: 25, modelValue: strength.value, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { strength.value = value; } }),
        ]),
        h("div", { class: "weight-scale" }, [
          h("span", { class: "pane-label" }, "Centred scale"),
          h(FluentSegmented, { label: "Centred scale", "data-testid": "showcase-weight-scale", modelValue: scale.value, options: scaleOptions.map(({ value, label }) => ({ value, label })), "onUpdate:modelValue": (value: string | number) => { scale.value = value as FluentGraphicScale; } }),
        ]),
      ]),
      h("p", { class: "pref-note" }, `${scaleOptions.find((option) => option.value === scale.value)!.note} At 100% strength the dot lands in the middle of the Centred slot; 0% keeps the geometric centre there and values in between stop part of the way.`),
      h("div", { class: "weight-grid" }, [
        ...examples.map((example) => h("article", { class: "weight-card", key: example.name }, [
          h("div", { class: "weight-card__head" }, [h("strong", example.name), h("div", { class: "weight-card__chips" }, [chip(example.left, "Left"), chip(example.right, "Right"), chip(example.background, "Surface")])]),
          h(WeightSample, { pair: example, scale: scale.value, strength: strength.value / 100, name: example.name }),
          h("p", { class: "pref-note" }, example.note),
        ])),
        h("article", { class: "weight-card weight-card--custom", "data-testid": "showcase-weight-custom" }, [
          h("div", { class: "weight-card__head" }, [h("strong", "Try your own"), h("div", { class: "weight-card__chips" }, [picker("left", "Left"), picker("right", "Right"), picker("background", "Surface")])]),
          h(WeightSample, { pair: custom, scale: scale.value, strength: strength.value / 100 }),
          h("p", { class: "pref-note" }, "Pick colours to watch the weighted centre move."),
        ]),
      ]),
    ], true);
  },
});
