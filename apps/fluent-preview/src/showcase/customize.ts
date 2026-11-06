import { defineComponent, h, onMounted, ref, watch, type VNode } from "vue";
import { FluentButton, FluentSegmented, FluentSelect, FluentSlider, FluentSwitch, fluentPreferenceOptions, type FluentSpeed, type FluentThemeMode } from "@platform-kit/fluent/vue";
import { easingPath, parseEasing } from "../curves.js";
import { preferenceLabel, preferenceOptions, preferences, type PreferenceKey } from "../preferences.js";
import { accents, appearance, resetShowcase, ui } from "./state.js";
import { closeGlyph } from "./icons.js";

const field = (label: string, control: VNode) => h("div", { class: "pane-field" }, [h("span", { class: "pane-label" }, label), control]);

const group = (title: string, children: (VNode | null)[]) => h("section", { class: "pane-group" }, [h("h3", title), ...children]);

const update = (key: PreferenceKey) => (value: string | number) => { (preferences as Record<PreferenceKey, string>)[key] = String(value); };

const AccentPicker = defineComponent({
  setup() {
    const swatch = (value: string, label: string, chip: Record<string, string>) => h("label", { class: "swatch", title: label, key: value || "default" }, [
      h("input", { type: "radio", name: "showcase-accent", value, checked: (appearance.accent ?? "") === value, onChange: () => { appearance.accent = value || undefined; } }),
      h("span", { class: "swatch__chip", style: chip }),
      h("span", { class: "visually-hidden" }, label),
    ]);
    return () => {
      const custom = appearance.accent !== undefined && !accents.some((accent) => accent.value === appearance.accent);
      return h("fieldset", { class: "swatches", "data-testid": "showcase-accent" }, [
        h("legend", { class: "pane-label" }, "Accent color"),
        swatch("", "Default", { background: "linear-gradient(135deg, #0067c0 50%, #4cc2ff 50%)" }),
        ...accents.map((accent) => swatch(accent.value, accent.label, { background: accent.value })),
        h("label", { class: ["swatch", "swatch--custom", { "is-active": custom }], title: "Custom color" }, [
          h("input", { type: "color", value: appearance.accent ?? "#0067c0", onInput: (event: Event) => { appearance.accent = (event.target as HTMLInputElement).value; } }),
          h("span", { class: "visually-hidden" }, "Custom accent color"),
        ]),
      ]);
    };
  },
});

const CurvePreview = defineComponent({
  setup() {
    const probe = ref<HTMLElement | null>(null);
    const path = ref("");
    const read = () => {
      if (probe.value) path.value = easingPath(parseEasing(getComputedStyle(probe.value).getPropertyValue("--fluent-ease")), 96, 40, -0.05, 1.15);
    };
    onMounted(read);
    watch(() => preferences.curve, read, { flush: "post" });
    return () => h("div", { class: "pane-curve", "aria-hidden": "true" }, [
      h("svg", { viewBox: "0 0 104 48" }, [
        h("line", { class: "curve-axis curve-axis--target", x1: 4, x2: 100, y1: 4 + 40 * (1 - 1.05 / 1.2), y2: 4 + 40 * (1 - 1.05 / 1.2) }),
        path.value ? h("path", { class: "curve-line", d: path.value, transform: "translate(4 4)" }) : null,
      ]),
      h("span", { ref: probe, class: "curve-probe" }),
    ]);
  },
});

const speeds = fluentPreferenceOptions.speed;

export const CustomizePane = defineComponent({
  setup() {
    return () => h("aside", { id: "showcase-customize", class: "showcase-pane", "aria-labelledby": "showcase-customize-title", "data-testid": "showcase-customize" }, [
      h("div", { class: "pane-header" }, [
        h("h2", { id: "showcase-customize-title" }, "Customize"),
        h(FluentButton, { tone: "subtle", "data-testid": "showcase-reset", onClick: resetShowcase }, () => "Reset"),
        h(FluentButton, { tone: "subtle", iconOnly: true, class: "pane-close", "aria-label": "Close Customize", onClick: () => { ui.paneOpen = false; } }, closeGlyph),
      ]),
      group("Appearance", [
        field("Theme", h(FluentSegmented, { label: "Theme", "data-testid": "showcase-theme", modelValue: appearance.mode, options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }], "onUpdate:modelValue": (value: string | number) => { appearance.mode = value as FluentThemeMode; } })),
        h(AccentPicker),
      ]),
      group("Motion", [
        field("Selection motion", h(FluentSegmented, { label: "Selection motion", "data-testid": "showcase-motion", modelValue: preferences.motion, options: preferenceOptions("motion"), "onUpdate:modelValue": update("motion") })),
        h(FluentSelect, { label: "Page transition", "data-testid": "showcase-page-transition", modelValue: preferences.pageTransition, options: preferenceOptions("pageTransition"), "onUpdate:modelValue": update("pageTransition") }),
        h("div", { class: "pane-row" }, [
          h(FluentSelect, { label: "Curve", "data-testid": "showcase-curve", modelValue: preferences.curve, options: preferenceOptions("curve"), "onUpdate:modelValue": update("curve") }),
          h(CurvePreview),
        ]),
        h(FluentSlider, {
          label: "Speed", "data-testid": "showcase-speed", min: 0, max: speeds.length - 1, snap: "available",
          stops: speeds.map((speed, value) => ({ value, label: preferenceLabel(speed) })),
          modelValue: speeds.indexOf(preferences.speed),
          "onUpdate:modelValue": (value: number) => { preferences.speed = speeds[Math.round(value)] as FluentSpeed; },
        }),
        h(FluentSwitch, { label: "Reduce motion", "data-testid": "showcase-reduced-motion", modelValue: preferences.reducedMotion === "reduce", "onUpdate:modelValue": (on: boolean) => { preferences.reducedMotion = on ? "reduce" : "system"; } }),
      ]),
      group("Emphasis and shape", [
        h(FluentSelect, { label: "Selected item", "data-testid": "showcase-emphasis", modelValue: preferences.emphasis, options: preferenceOptions("emphasis"), "onUpdate:modelValue": update("emphasis") }),
        field("Corners", h(FluentSegmented, { label: "Corners", "data-testid": "showcase-corner", modelValue: preferences.corner, options: preferenceOptions("corner"), "onUpdate:modelValue": update("corner") })),
      ]),
      h("p", { class: "pane-hint" }, "Every page reads these values from one FluentTheme, so the menu, the controls and the page transitions change together."),
    ]);
  },
});
