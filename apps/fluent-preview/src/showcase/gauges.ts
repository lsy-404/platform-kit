import { defineComponent, h, onBeforeUnmount, reactive, ref } from "vue";
import { FluentButton, FluentGauge, FluentSegmented, FluentSlider, FluentSwitch } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { preferenceLabel, preferenceOptions, preferences } from "../preferences.js";
import { barRows, ringRows } from "./control-motion.js";

const drift = (value: number, spread: number, min: number, max: number) => Math.min(max, Math.max(min, value + (Math.random() - 0.5) * spread));

export const GaugeDashboardCard = defineComponent({
  setup() {
    const stats = reactive({ cpu: 38, memory: 9.6, disk: 412, battery: 76 });
    const target = ref(64);
    const live = ref(true);
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      stats.cpu = drift(stats.cpu, 34, 3, 97);
      stats.memory = drift(stats.memory, 1.6, 4, 15.5);
      stats.disk = drift(stats.disk, 40, 380, 470);
    };
    const run = (on: boolean) => { clearInterval(timer); if (on) timer = setInterval(tick, 1400); };
    run(true);
    onBeforeUnmount(() => clearInterval(timer));

    return () => card("showcase-gauges", "Gauges", "A 270° arc with the value in the middle. Value changes glide along the arc and count up with the theme curve and speed.", [
      h("div", { class: "control-row" }, [
        h(FluentSwitch, { label: "Live values", "data-testid": "showcase-gauge-live", modelValue: live.value, "onUpdate:modelValue": (on: boolean) => { live.value = on; run(on); } }),
        h(FluentButton, { onClick: tick }, () => "Next sample"),
      ]),
      h("div", { class: "gauge-grid" }, [
        h(FluentGauge, { label: "Processor", value: stats.cpu, caption: "% CPU", "data-testid": "showcase-gauge-cpu" }),
        h(FluentGauge, { label: "Memory in use", value: stats.memory, min: 0, max: 16, caption: "GB of 16", formatValue: (value: number) => value.toFixed(1) }),
        h(FluentGauge, { label: "Disk used", value: stats.disk, min: 0, max: 512, caption: "GB of 512", formatValue: (value: number) => `${Math.round(value)}` }),
        h(FluentGauge, { label: "Battery", value: stats.battery, caption: "% battery", formatValue: (value: number) => `${Math.round(value)}` }),
      ]),
      h("div", { class: "gauge-drive" }, [
        h(FluentGauge, { label: "Target", value: target.value, size: 168, caption: "target %", "data-testid": "showcase-gauge-target" }),
        h("div", { class: "gauge-drive__controls" }, [
          h(FluentSlider, { label: "Drag to set the target", modelValue: target.value, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { target.value = value; } }),
          h("div", { class: "control-row" }, [0, 25, 50, 75, 100].map((value) => h(FluentButton, { key: value, tone: "subtle", onClick: () => { target.value = value; } }, () => `${value}%`))),
          h("p", { class: "pref-note" }, "Jump between presets to watch the arc sweep; dragging the slider moves it continuously."),
        ]),
      ]),
    ], true);
  },
});

const picker = (key: "ringMotion" | "barMotion", label: string) => h("div", { class: "motion-picker" }, [
  h("span", { class: "pane-label" }, label),
  h(FluentSegmented, { label, "data-testid": `showcase-pick-${key === "ringMotion" ? "ring" : "bar"}`, modelValue: preferences[key], options: preferenceOptions(key), "onUpdate:modelValue": (value: string | number) => { (preferences as Record<string, string>)[key] = String(value); } }),
]);

export const SpinnerCard = defineComponent({
  setup: () => () => card("showcase-spinners", "Progress rings", `Lines: Stretch lets the arc grow and shrink while it turns, Spin turns a fixed arc at constant speed. Dots orbits five dots. Every style follows the speed preference (now ${preferenceLabel(preferences.speed)}); reduced motion keeps them still.`, [
    picker("ringMotion", "Ring style for the app"),
    ringRows([16, 24, 32, 48]),
  ], true),
});

export const BarCard = defineComponent({
  setup: () => () => card("showcase-waiting", "Indeterminate progress bars", "Dynamic sweeps two segments one after the other, Linear sweeps at constant speed and Bounce glides back and forth.", [
    picker("barMotion", "Bar style for the app"),
    barRows(),
  ], true),
});
