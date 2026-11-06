import { defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch, type PropType, type VNode } from "vue";
import { FluentButton, FluentField, FluentNavigation, FluentSegmented, FluentSwitch, fluentPreferenceOptions, type FluentCorner, type FluentEmphasis, type FluentMotion } from "@platform-kit/fluent/vue";
import { easingPath, parseEasing } from "./curves.js";
import { preferenceLabel, preferences } from "./preferences.js";
import { card } from "./card.js";
import { TransitionsCard } from "./transition-card.js";

export function useMotionDurations() {
  const element = ref<HTMLElement | null>(null);
  const durations = reactive({ faster: 0, fast: 0, normal: 0 });
  const read = () => {
    if (!element.value) return;
    const [faster = 0, fast = 0, normal = 0] = getComputedStyle(element.value).transitionDuration.split(",").map((value) => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000));
    Object.assign(durations, { faster, fast, normal });
  };
  onMounted(read);
  watch(() => [preferences.speed, preferences.reducedMotion], read, { flush: "post" });
  return { durations, probe: () => h("span", { ref: element, class: "motion-probe", "aria-hidden": "true" }) };
}

const formatMs = (value: number) => `${Math.round(value)} ms`;

const plot = { width: 104, height: 64, left: 8, top: 8, min: -0.05, max: 1.15 };
const plotY = (value: number) => plot.top + plot.height * (1 - (value - plot.min) / (plot.max - plot.min));

export const CurvesCard = defineComponent({
  setup() {
    const probes = new Map<string, HTMLElement>();
    const paths = ref<Record<string, string>>({});
    const dot = ref<HTMLElement | null>(null);
    const { durations, probe } = useMotionDurations();
    let animation: Animation | undefined;
    onMounted(() => {
      paths.value = Object.fromEntries(fluentPreferenceOptions.curve.map((name) => {
        const easing = parseEasing(getComputedStyle(probes.get(name)!).getPropertyValue("--fluent-ease"));
        return [name, easingPath(easing, plot.width, plot.height, plot.min, plot.max)];
      }));
    });
    onBeforeUnmount(() => animation?.cancel());
    const play = () => {
      if (!dot.value) return;
      animation?.cancel();
      animation = dot.value.animate({ left: ["0%", "calc(100% - var(--curve-dot))"] }, { duration: durations.normal, easing: getComputedStyle(dot.value).getPropertyValue("--fluent-ease").trim(), fill: "forwards" });
    };
    return () => card("pref-curves", "Curves", "Progress over time for every curve. Select one to apply it everywhere; the track plays the current curve at the normal duration.", [
      h("div", { class: "curve-grid" }, fluentPreferenceOptions.curve.map((name) => h("button", {
        key: name, type: "button", class: ["curve-plot", { "is-active": preferences.curve === name }], "aria-pressed": preferences.curve === name ? "true" : "false", "data-testid": `curve-${name}`, onClick: () => { preferences.curve = name; },
      }, [
        h("svg", { viewBox: "0 0 120 80", class: "curve-svg", "aria-hidden": "true" }, [
          h("line", { class: "curve-axis", x1: plot.left, x2: plot.left + plot.width, y1: plotY(0), y2: plotY(0) }),
          h("line", { class: "curve-axis curve-axis--target", x1: plot.left, x2: plot.left + plot.width, y1: plotY(1), y2: plotY(1) }),
          paths.value[name] ? h("path", { class: "curve-line", d: paths.value[name], transform: `translate(${plot.left} ${plot.top})` }) : null,
        ]),
        h("span", { class: "curve-name" }, preferenceLabel(name)),
        h("span", { class: "curve-probe", "data-fluent-curve": name, "aria-hidden": "true", ref: ((element: Element | null) => { if (element instanceof HTMLElement) probes.set(name, element); }) as never }),
      ]))),
      h("div", { class: "curve-play" }, [
        h(FluentButton, { tone: "primary", "data-testid": "curve-play", onClick: play }, () => "Play"),
        h("div", { class: "curve-track", "aria-hidden": "true" }, h("span", { class: "curve-dot", ref: dot })),
        h("span", { class: "pref-note" }, `${preferenceLabel(preferences.curve)}, ${formatMs(durations.normal)}`),
      ]),
      probe(),
    ], true);
  },
});

const segmentedOptions = ["Day", "Week", "Month", "Year"].map((label) => ({ value: label.toLowerCase(), label }));
const navigationItems = ["Inbox", "Drafts", "Sent", "Archive"].map((label) => ({ key: label.toLowerCase(), label }));

const SelectionDemo = defineComponent({
  props: {
    motion: String as PropType<FluentMotion>,
    emphasis: String as PropType<FluentEmphasis>,
    tick: { type: Number, default: 0 },
  },
  setup(props) {
    const segment = ref("week"), page = ref("drafts");
    const advance = <T extends { value?: string; key?: string }>(items: T[], current: string) => {
      const next = items[(items.findIndex((item) => (item.value ?? item.key) === current) + 1) % items.length]!;
      return (next.value ?? next.key)!;
    };
    watch(() => props.tick, () => {
      segment.value = advance(segmentedOptions, segment.value);
      page.value = advance(navigationItems, page.value);
    });
    return () => h("div", { class: "selection-demo" }, [
      h(FluentSegmented, { label: "View", motion: props.motion, emphasis: props.emphasis, modelValue: segment.value, options: segmentedOptions, "onUpdate:modelValue": (value: string | number) => { segment.value = String(value); } }),
      h(FluentNavigation, { label: "Folders", motion: props.motion, emphasis: props.emphasis, modelValue: page.value, items: navigationItems, "onUpdate:modelValue": (value: string) => { page.value = value; } }),
    ]);
  },
});

const row = (name: string, attribute: string, demo: VNode) => h("div", { class: "selection-row", key: name, "data-testid": `${attribute}-${name}` }, [
  h("div", { class: "selection-row__title" }, [h("strong", preferenceLabel(name)), h("code", `${attribute}="${name}"`)]),
  demo,
]);

export const MotionCard = defineComponent({
  setup() {
    const auto = ref(false), tick = ref(0);
    let timer: ReturnType<typeof setInterval> | undefined;
    watch(auto, (on) => {
      clearInterval(timer);
      if (on) timer = setInterval(() => { tick.value += 1; }, 1200);
    });
    onBeforeUnmount(() => clearInterval(timer));
    return () => card("pref-motion", "Selection motion", "How the selection indicator moves between items.", [
      h(FluentSwitch, { modelValue: auto.value, label: "Auto-play", "data-testid": "motion-autoplay", "onUpdate:modelValue": (value: boolean) => { auto.value = value; } }),
      h("div", { class: "selection-rows" }, fluentPreferenceOptions.motion.map((name) => row(name, "motion", h(SelectionDemo, { motion: name, tick: tick.value })))),
    ], true);
  },
});

export const EmphasisCard = defineComponent({
  setup: () => () => card("pref-emphasis", "Emphasis styles", "Selected-item styling in the current theme and accent.", [
    h("div", { class: "selection-rows" }, fluentPreferenceOptions.emphasis.map((name) => row(name, "emphasis", h(SelectionDemo, { emphasis: name })))),
  ], true),
});

export const CornersCard = defineComponent({
  setup() {
    const { durations, probe } = useMotionDurations();
    const sample = (corner: FluentCorner) => h("div", { class: "corner-sample", key: corner, "data-fluent-corner": corner, "data-testid": `corner-${corner}` }, [
      h("strong", preferenceLabel(corner)),
      h("div", { class: "control-row" }, [h(FluentButton, { tone: "primary" }, () => "Save"), h(FluentButton, { tone: "secondary" }, () => "Cancel")]),
      h(FluentField, { modelValue: "Sample", label: "Name", readonly: true }),
      h(FluentSegmented, { label: `${preferenceLabel(corner)} view`, modelValue: "b", options: [{ value: "a", label: "One" }, { value: "b", label: "Two" }, { value: "c", label: "Three" }] }),
      h("div", { class: "corner-panel" }, "Card surface"),
    ]);
    return () => card("pref-corners", "Corners and speed", "Each column nests a corner preference. Durations are the current scaled values.", [
      h("div", { class: "corner-grid" }, fluentPreferenceOptions.corner.map(sample)),
      h("p", { class: "pref-note", "data-testid": "speed-note" }, `Speed ${preferenceLabel(preferences.speed)}${preferences.reducedMotion === "reduce" ? " (reduced motion)" : ""}: faster ${formatMs(durations.faster)}, fast ${formatMs(durations.fast)}, normal ${formatMs(durations.normal)}`),
      probe(),
    ], true);
  },
});

export const PreferencesSection = defineComponent({
  setup() {
    return () => h("section", { class: "catalog-section", id: "preferences" }, [
      h("h2", "Preferences"),
      h("p", { class: "pref-note" }, "Every style preference of the kit can be switched from the header and previews live. The state is kept in the address bar so a configuration can be shared."),
      h("div", { class: "catalog-grid pref-grid" }, [h(CurvesCard), h(MotionCard), h(EmphasisCard), h(CornersCard), h(TransitionsCard)]),
    ]);
  },
});
