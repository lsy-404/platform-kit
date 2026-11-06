import { defineComponent, h, onBeforeUnmount, ref } from "vue";
import { FluentButton, FluentCheckbox, FluentProgressBar, FluentProgressRing, FluentRadio, FluentSegmented, FluentSlider, FluentSwitch, FluentToggleButton, fluentPreferenceOptions, type FluentPageTransition } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { CornersCard, CurvesCard, EmphasisCard, MotionCard, useMotionDurations } from "../preference-cards.js";
import { preferenceLabel, preferences } from "../preferences.js";
import { TransitionsCard } from "../transition-card.js";
import { PageFrame } from "./frame.js";
import { navigate, pageLabel, pageOrder } from "./state.js";
import { arrowGlyph } from "./icons.js";

const ms = (value: number) => `${Math.round(value)} ms`;
const stat = (label: string, value: string) => h("div", { class: "stat" }, [h("span", { class: "stat__label" }, label), h("strong", { class: "stat__value" }, value)]);

const DurationStats = defineComponent({
  setup() {
    const { durations, probe } = useMotionDurations();
    return () => h("div", { class: "stat-row", "data-testid": "showcase-durations" }, [
      stat("Faster", ms(durations.faster)),
      stat("Fast", ms(durations.fast)),
      stat("Normal", ms(durations.normal)),
      stat("Speed", preferenceLabel(preferences.speed) + (preferences.reducedMotion === "reduce" ? ", reduced" : "")),
      stat("Curve", preferenceLabel(preferences.curve)),
      probe(),
    ]);
  },
});

const CurveRace = defineComponent({
  setup() {
    const dots = new Map<string, HTMLElement>();
    const { durations, probe } = useMotionDurations();
    let running: Animation[] = [];
    onBeforeUnmount(() => running.forEach((animation) => animation.cancel()));
    const race = () => {
      running.forEach((animation) => animation.cancel());
      running = fluentPreferenceOptions.curve.map((name) => {
        const dot = dots.get(name)!;
        return dot.animate({ left: ["0%", "calc(100% - var(--curve-dot))"] }, { duration: durations.normal * 4, easing: getComputedStyle(dot).getPropertyValue("--fluent-ease").trim(), fill: "forwards" });
      });
    };
    return () => card("showcase-race", "Curve race", `Every curve at once, at four times the normal duration (${ms(durations.normal * 4)}). Select a row to use that curve everywhere.`, [
      h("div", { class: "race" }, fluentPreferenceOptions.curve.map((name) => h("button", {
        type: "button", key: name, class: ["race-row", { "is-active": preferences.curve === name }], "aria-pressed": String(preferences.curve === name), onClick: () => { preferences.curve = name; },
      }, [
        h("span", { class: "race-row__name" }, preferenceLabel(name)),
        h("span", { class: "curve-track", "aria-hidden": "true" }, h("span", { class: "curve-dot", "data-fluent-curve": name, ref: ((element: Element | null) => { if (element instanceof HTMLElement) dots.set(name, element); }) as never })),
      ]))),
      h("div", { class: "control-row" }, [h(FluentButton, { tone: "primary", "data-testid": "showcase-race", onClick: race }, () => "Race")]),
      probe(),
    ], true);
  },
});

export const MotionPage = defineComponent({
  setup: () => () => h(PageFrame, { title: "Motion", lead: "Durations come from the speed preference, easing from the curve preference, and the selection indicator from the motion preference. Everything here re-reads them live." }, () => [
    h(DurationStats),
    h("div", { class: "showcase-stack" }, [h(CurveRace), h(CurvesCard), h(MotionCard)]),
  ]),
});

const AccentCard = defineComponent({
  setup() {
    const pinned = ref(true), on = ref(true), checked = ref(true), radio = ref("week"), level = ref(68), view = ref("list");
    return () => card("showcase-accent-card", "Accent across controls", "Primary actions, checked states, sliders and progress all take the accent from Customize.", [
      h("div", { class: "accent-demo" }, [
        h("div", { class: "control-row" }, [
          h(FluentButton, { tone: "primary" }, () => "Primary"),
          h(FluentToggleButton, { modelValue: pinned.value, "onUpdate:modelValue": (value: boolean) => { pinned.value = value; } }, () => pinned.value ? "Pinned" : "Pin"),
          h(FluentSegmented, { label: "Layout", emphasis: "filled", modelValue: view.value, options: [{ value: "list", label: "List" }, { value: "grid", label: "Grid" }], "onUpdate:modelValue": (value: string | number) => { view.value = String(value); } }),
        ]),
        h("div", { class: "control-row" }, [
          h(FluentSwitch, { label: "Switch", modelValue: on.value, "onUpdate:modelValue": (value: boolean) => { on.value = value; } }),
          h(FluentCheckbox, { label: "Checkbox", modelValue: checked.value, "onUpdate:modelValue": (value: boolean) => { checked.value = value; } }),
          h(FluentRadio, { label: "Week", value: "week", modelValue: radio.value, "onUpdate:modelValue": (value: string) => { radio.value = value; } }),
          h(FluentRadio, { label: "Month", value: "month", modelValue: radio.value, "onUpdate:modelValue": (value: string) => { radio.value = value; } }),
        ]),
        h(FluentSlider, { label: "Level", modelValue: level.value, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { level.value = value; } }),
        h("div", { class: "progress-row" }, [h(FluentProgressBar, { label: "Level progress", value: level.value }), h(FluentProgressRing, { label: "Level ring", value: level.value, indeterminate: false, size: 32 })]),
      ]),
    ], true);
  },
});

export const EmphasisPage = defineComponent({
  setup: () => () => h(PageFrame, { title: "Emphasis and shape", lead: "Emphasis decides how a selected segment or menu item is marked; corners set the radius of controls and panels. Both nest, so one region can differ from the rest." }, () => [
    h("div", { class: "showcase-stack" }, [h(AccentCard), h(EmphasisCard), h(CornersCard)]),
  ]),
});

const transitionNotes: Record<FluentPageTransition, string> = {
  entrance: "The new page rises into place and fades in while the old one fades out quickly.",
  fade: "A straight cross-fade between the two pages.",
  slide: "Pages slide sideways; going back up the menu reverses the direction.",
  scale: "Drill in: the new page grows into place, and going back shrinks it away.",
  wipe: "An accent sweep covers the old page and then reveals the new one.",
  none: "Pages switch instantly.",
};

export const TransitionsPage = defineComponent({
  setup() {
    const index = pageOrder.indexOf("transitions");
    const previous = pageOrder[index - 1]!, next = pageOrder[index + 1]!;
    return () => h(PageFrame, { title: "Page transitions", lead: "This app switches pages with the View Transition API. Pick a style, then move through the side menu: pages further down slide or drill forward, pages further up go back." }, () => [
      h("div", { class: "showcase-stack" }, [
        card("showcase-transition-styles", "App navigation", null, [
          h("div", { class: "transition-styles" }, fluentPreferenceOptions.pageTransition.map((style) => h("button", {
            type: "button", key: style, class: ["transition-style", { "is-active": preferences.pageTransition === style }], "aria-pressed": String(preferences.pageTransition === style), "data-testid": `showcase-transition-${style}`, onClick: () => { preferences.pageTransition = style; },
          }, [h("strong", preferenceLabel(style)), h("span", transitionNotes[style])]))),
          h("div", { class: "control-row" }, [
            h(FluentButton, { "data-testid": "showcase-previous-page", onClick: () => navigate(previous) }, () => `Back to ${pageLabel(previous)}`),
            h(FluentButton, { tone: "primary", "data-testid": "showcase-next-page", onClick: () => navigate(next) }, () => [`Forward to ${pageLabel(next)}`, arrowGlyph()]),
          ]),
        ], true),
        h(TransitionsCard),
      ]),
    ]);
  },
});
