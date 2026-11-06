import { defineComponent, h, onBeforeUnmount, reactive, ref, watch, type VNode } from "vue";
import { FluentCheckbox, FluentRadio, FluentSelect, FluentSwitch, FluentTheme, FluentToggleButton, fluentPreferenceOptions } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { preferenceLabel, preferences } from "../preferences.js";
import { pageFrame } from "./frame.js";
import { appearance } from "./state.js";

type Family = "toggleMotion" | "checkMotion" | "menuMotion";
const testIds: Record<Family, string> = { toggleMotion: "toggle-motion", checkMotion: "check-motion", menuMotion: "menu-motion" };
const folders = ["Inbox", "Drafts", "Sent", "Archive"].map((label) => ({ value: label.toLowerCase(), label }));

// Each row nests a FluentTheme that sets only this family, so speed, curve and the other preferences still come from Customize.
const row = (family: Family, value: string, demo: VNode[]) => h(FluentTheme, {
  key: value, mode: appearance.mode, accent: appearance.accent, [family]: value,
  class: ["selection-row", { "is-current": preferences[family] === value }], "data-testid": `${testIds[family]}-${value}`,
}, () => [
  h("div", { class: "selection-row__title" }, [
    h("strong", preferenceLabel(value)),
    h("code", `${family}="${value}"`),
    preferences[family] === value ? h("span", { class: "row-badge" }, "In use") : null,
  ]),
  h("div", { class: "control-row" }, demo),
]);

export const ControlMotionPage = defineComponent({
  setup() {
    const state = reactive({ on: true, pinned: false, checked: true, partial: false, choice: "week" });
    const folder = reactive<Record<string, string>>(Object.fromEntries(fluentPreferenceOptions.menuMotion.map((value) => [value, "inbox"])));
    const auto = ref(false);
    let timer: ReturnType<typeof setInterval> | undefined;
    const flip = () => {
      state.on = !state.on;
      state.pinned = !state.pinned;
      state.checked = !state.checked;
      state.choice = state.choice === "week" ? "month" : "week";
    };
    watch(auto, (on) => { clearInterval(timer); if (on) timer = setInterval(flip, 1400); });
    onBeforeUnmount(() => clearInterval(timer));

    return () => pageFrame("motion-controls", "Toggles, check controls and dropdowns each have their own motion preference. Every row below pins one value; Customize decides the value the rest of the app uses.", () => [
      h(FluentSwitch, { label: "Auto-play toggles and checks", "data-testid": "control-motion-autoplay", modelValue: auto.value, "onUpdate:modelValue": (value: boolean) => { auto.value = value; } }),
      card("showcase-toggle-motion", "Toggles", "Switches and toggle buttons. Hold the pointer down on a switch to see the stretch.", [
        h("div", { class: "selection-rows" }, fluentPreferenceOptions.toggleMotion.map((value) => row("toggleMotion", value, [
          h(FluentSwitch, { label: "Wi-Fi", modelValue: state.on, "onUpdate:modelValue": (next: boolean) => { state.on = next; } }),
          h(FluentToggleButton, { modelValue: state.pinned, "onUpdate:modelValue": (next: boolean) => { state.pinned = next; } }, () => state.pinned ? "Pinned" : "Pin"),
        ]))),
      ], true),
      card("showcase-check-motion", "Check controls", "Checkboxes, the indeterminate state and radio buttons.", [
        h("div", { class: "selection-rows" }, fluentPreferenceOptions.checkMotion.map((value) => row("checkMotion", value, [
          h(FluentCheckbox, { label: "Remember me", modelValue: state.checked, "onUpdate:modelValue": (next: boolean) => { state.checked = next; } }),
          h(FluentCheckbox, { label: "Some", modelValue: false, indeterminate: !state.checked, "onUpdate:modelValue": (next: boolean) => { state.checked = next; } }),
          h(FluentRadio, { label: "Week", value: "week", modelValue: state.choice, "onUpdate:modelValue": (next: string) => { state.choice = next; } }),
          h(FluentRadio, { label: "Month", value: "month", modelValue: state.choice, "onUpdate:modelValue": (next: string) => { state.choice = next; } }),
        ]))),
      ], true),
      card("showcase-menu-motion", "Dropdowns", "Open each dropdown to compare how the list arrives from its anchor.", [
        h("div", { class: "selection-rows" }, fluentPreferenceOptions.menuMotion.map((value) => row("menuMotion", value, [
          h(FluentSelect, { label: `${preferenceLabel(value)} folder`, modelValue: folder[value], options: folders, "onUpdate:modelValue": (next: string) => { folder[value] = next; } }),
        ]))),
      ], true),
    ]);
  },
});
