import { defineComponent, h, ref } from "vue";
import { FluentButton, FluentProgressBar, FluentSegmented, FluentSlider, FluentSwitch, fluentPreferenceOptions } from "@platform-kit/fluent/vue";
import { preferenceLabel, preferences, type PreferenceKey } from "../preferences.js";
import { PageFrame } from "./frame.js";
import { applyPreset, isActivePreset, navigate, openCustomize, presets, type PageKey, type ShowcasePreset } from "./state.js";
import { arrowGlyph, tuneGlyph } from "./icons.js";

const preferenceTiles: { key: PreferenceKey; name: string; summary: string; page: PageKey }[] = [
  { key: "motion", name: "Selection motion", summary: "How the indicator travels between menu items and segments.", page: "motion" },
  { key: "curve", name: "Curve", summary: "The easing every control animation and page transition uses.", page: "motion" },
  { key: "speed", name: "Speed", summary: "Scales every duration, from hover fades to page transitions.", page: "motion" },
  { key: "reducedMotion", name: "Reduced motion", summary: "Follows the system setting or turns motion off for this theme.", page: "motion" },
  { key: "emphasis", name: "Emphasis", summary: "How a selected menu item or segment is marked.", page: "emphasis" },
  { key: "corner", name: "Corners", summary: "Control and panel radii, from square to rounded.", page: "emphasis" },
  { key: "pageTransition", name: "Page transition", summary: "How one page replaces another, with shared elements.", page: "transitions" },
];

const chipNames: Record<PreferenceKey, string> = { motion: "Indicator", pageTransition: "Pages", curve: "Curve", speed: "Speed", reducedMotion: "Motion", emphasis: "Selection", corner: "Corners" };

const presetChips = (preset: ShowcasePreset) => {
  const entries = (Object.entries(preset.preferences) as [PreferenceKey, string][]).map(([key, value]) => `${chipNames[key]}: ${preferenceLabel(value)}`);
  return entries.length ? entries : ["Kit defaults"];
};

const HeroSample = defineComponent({
  setup() {
    const view = ref("week"), focus = ref(true), volume = ref(64);
    return () => h("div", { class: "hero-sample", role: "group", "aria-label": "Sample controls" }, [
      h("div", { class: "hero-sample__row" }, [h("strong", "Calendar"), h(FluentSegmented, { label: "Calendar view", modelValue: view.value, options: [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }], "onUpdate:modelValue": (value: string | number) => { view.value = String(value); } })]),
      h(FluentSwitch, { label: "Focus sessions", modelValue: focus.value, "onUpdate:modelValue": (value: boolean) => { focus.value = value; } }),
      h(FluentSlider, { label: "Volume", modelValue: volume.value, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { volume.value = value; } }),
      h(FluentProgressBar, { label: "Sync progress", value: volume.value, showIndicator: true }),
      h("div", { class: "control-row" }, [h(FluentButton, { tone: "primary" }, () => "Save"), h(FluentButton, () => "Cancel")]),
    ]);
  },
});

export const OverviewPage = defineComponent({
  setup() {
    return () => h(PageFrame, { title: "Overview", lead: "A tour of @platform-kit/fluent. Every page reads motion, curve, speed, emphasis, corners and page transitions from one FluentTheme; change them in Customize and the whole app follows." }, () => [
      h("section", { class: "showcase-hero" }, [
        h("div", { class: "showcase-hero__copy" }, [
          h("p", { class: "showcase-kicker" }, "Fluent theme for Vue"),
          h("h3", "One theme, tuned to taste"),
          h("p", "Pick a preset or adjust each preference. The side menu, the segmented controls and the page you land on all animate with the values you choose."),
          h("div", { class: "control-row" }, [
            h(FluentButton, { tone: "primary", "data-testid": "showcase-open-customize", onClick: openCustomize }, () => [tuneGlyph(), "Customize"]),
            h(FluentButton, { onClick: () => navigate("motion") }, () => ["See the motion", arrowGlyph()]),
          ]),
        ]),
        h(HeroSample),
      ]),
      h("section", { class: "showcase-section", "aria-labelledby": "showcase-presets" }, [
        h("h3", { id: "showcase-presets" }, "Presets"),
        h("p", { class: "pref-note" }, "Each preset sets several preferences at once. Anything you change afterwards is kept until you pick another preset or reset."),
        h("div", { class: "preset-grid" }, presets.map((preset) => {
          const active = isActivePreset(preset);
          return h("article", { class: ["preset-card", { "is-active": active }], key: preset.id, "data-testid": `preset-${preset.id}` }, [
            h("div", { class: "preset-card__head" }, [
              h("span", { class: "preset-card__swatch", style: preset.accent ? { background: preset.accent } : undefined, "aria-hidden": "true" }),
              h("h4", preset.name),
            ]),
            h("p", preset.description),
            h("ul", { class: "preset-card__chips", "aria-label": `${preset.name} settings` }, presetChips(preset).map((chip) => h("li", chip))),
            h(FluentButton, { tone: active ? "secondary" : "primary", disabled: active, "aria-label": active ? `${preset.name} applied` : `Apply ${preset.name}`, onClick: () => applyPreset(preset) }, () => active ? "Applied" : "Apply"),
          ]);
        })),
      ]),
      h("section", { class: "showcase-section", "aria-labelledby": "showcase-preferences" }, [
        h("h3", { id: "showcase-preferences" }, "Seven preferences"),
        h("div", { class: "preference-tiles" }, preferenceTiles.map((tile) => h("article", { class: "preference-tile", key: tile.key }, [
          h("span", { class: "preference-tile__name" }, tile.name),
          h("strong", { class: "preference-tile__value" }, preferenceLabel(preferences[tile.key])),
          h("p", tile.summary),
          h("span", { class: "preference-tile__count" }, `${fluentPreferenceOptions[tile.key].length} options`),
          h(FluentButton, { tone: "subtle", "aria-label": `Show ${tile.name.toLowerCase()}`, onClick: () => navigate(tile.page) }, () => ["Show me", arrowGlyph()]),
        ]))),
      ]),
    ]);
  },
});
