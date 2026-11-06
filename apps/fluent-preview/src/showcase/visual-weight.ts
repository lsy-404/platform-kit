import { computed, defineComponent, h, reactive, ref, type PropType } from "vue";
import { FluentSvgIcon } from "@platform-kit/fluent/vue";
import { card } from "../card.js";

type Point = { x: number; y: number };
type Measurement = { bounds: (Point & { width: number; height: number }) | null; center: Point | null; status: "estimated" | "empty" | "no-contrast" };
interface Pair { left: string; right: string; background: string }

const size = 88;
const blocks = ({ left, right }: Pair) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="8" width="8" height="16" fill="${left}"/><rect x="19" y="8" width="8" height="16" fill="${right}"/></svg>`;

const examples: (Pair & { name: string; note: string })[] = [
  { name: "Same colour", note: "Equal weight, so both centres agree.", left: "#1b1b1b", right: "#1b1b1b", background: "#ffffff" },
  { name: "Dark and light grey", note: "On white the dark block is heavier.", left: "#1b1b1b", right: "#c8c8c8", background: "#ffffff" },
  { name: "The same pair on dark", note: "On a dark surface the light block is heavier, so the centre flips side.", left: "#1b1b1b", right: "#c8c8c8", background: "#202020" },
  { name: "Red and yellow", note: "Yellow is close to white, so red carries the weight.", left: "#e81123", right: "#ffb900", background: "#ffffff" },
  { name: "Red and yellow on dark", note: "Against dark grey the bright yellow wins.", left: "#e81123", right: "#ffb900", background: "#202020" },
  { name: "Accent and its tint", note: "A pale tint weighs little next to the full accent.", left: "#0078d4", right: "#99c9ef", background: "#ffffff" },
];

const shiftText = (measurement: Measurement | undefined) => {
  if (!measurement) return "Measuring…";
  if (measurement.status !== "estimated" || !measurement.center || !measurement.bounds) return "No contrast against this background";
  const shift = measurement.center.x - (measurement.bounds.x + measurement.bounds.width / 2);
  if (Math.abs(shift) < 0.05) return "Weighted centre matches the geometric centre";
  return `Weighted centre ${Math.abs(shift).toFixed(1)} px ${shift < 0 ? "left" : "right"} of the geometric centre`;
};

const WeightSample = defineComponent({
  props: { pair: { type: Object as PropType<Pair>, required: true }, name: String },
  setup(props) {
    const measurement = ref<Measurement>();
    const svg = computed(() => blocks(props.pair));
    const markers = () => {
      const data = measurement.value;
      if (!data?.bounds) return null;
      const middle = data.bounds.x + data.bounds.width / 2;
      return h("svg", { class: "weight-overlay", viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" }, [
        h("line", { class: "weight-overlay__geometric", x1: middle, x2: middle, y1: 4, y2: size - 4 }),
        data.center ? h("line", { class: "weight-overlay__shift", x1: middle, x2: data.center.x, y1: data.center.y, y2: data.center.y }) : null,
        data.center ? h("circle", { class: "weight-overlay__halo", cx: data.center.x, cy: data.center.y, r: 5 }) : null,
        data.center ? h("circle", { class: "weight-overlay__center", cx: data.center.x, cy: data.center.y, r: 3.2 }) : null,
      ]);
    };
    return () => h("div", { class: "weight-sample" }, [
      h("div", { class: "weight-sample__boxes" }, [
        h("figure", { class: "weight-box" }, [
          h("div", { class: "weight-box__surface", style: { background: props.pair.background } }, [
            h(FluentSvgIcon, { svg: svg.value, size, trim: false, optical: false, background: props.pair.background, label: `${props.name ?? "Custom"} as drawn`, onReady: (value: Measurement) => { measurement.value = value; } }),
            markers(),
          ]),
          h("figcaption", "Measured"),
        ]),
        h("figure", { class: "weight-box" }, [
          h("div", { class: "weight-box__surface weight-box__surface--target", style: { background: props.pair.background } }, [
            h(FluentSvgIcon, { svg: svg.value, size, background: props.pair.background, label: `${props.name ?? "Custom"} aligned to its weighted centre` }),
          ]),
          h("figcaption", "Aligned"),
        ]),
      ]),
      h("p", { class: "weight-sample__result", "aria-live": "polite" }, shiftText(measurement.value)),
    ]);
  },
});

const chip = (color: string, label: string) => h("span", { class: "weight-chip" }, [h("span", { class: "weight-chip__swatch", style: { background: color } }), label]);

export const VisualWeightCard = defineComponent({
  setup() {
    const custom = reactive<Pair>({ left: "#744da9", right: "#ffb900", background: "#ffffff" });
    const picker = (key: keyof Pair, label: string) => h("label", { class: "weight-picker" }, [
      h("input", { type: "color", value: custom[key], onInput: (event: Event) => { custom[key] = (event.target as HTMLInputElement).value; } }),
      label,
    ]);
    return () => card("showcase-visual-weight", "Visual weight depends on colour", "The visual centre is the centroid of every pixel weighted by its Oklab distance from the background. Two identical blocks therefore balance differently as their colours or the surface change. The dashed line is the geometric centre, the dot the weighted centre, and Aligned shows the icon moved so the dot sits in the middle.", [
      h("div", { class: "weight-grid" }, [
        ...examples.map((example) => h("article", { class: "weight-card", key: example.name }, [
          h("div", { class: "weight-card__head" }, [h("strong", example.name), h("div", { class: "weight-card__chips" }, [chip(example.left, "Left"), chip(example.right, "Right"), chip(example.background, "Surface")])]),
          h(WeightSample, { pair: example, name: example.name }),
          h("p", { class: "pref-note" }, example.note),
        ])),
        h("article", { class: "weight-card weight-card--custom", "data-testid": "showcase-weight-custom" }, [
          h("div", { class: "weight-card__head" }, [h("strong", "Try your own"), h("div", { class: "weight-card__chips" }, [picker("left", "Left"), picker("right", "Right"), picker("background", "Surface")])]),
          h(WeightSample, { pair: custom }),
          h("p", { class: "pref-note" }, "Pick colours to watch the weighted centre move."),
        ]),
      ]),
    ], true);
  },
});
