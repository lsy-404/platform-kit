import { computed, defineComponent, h, reactive, ref } from "vue";
import { FluentSegmented, FluentSlider, FluentSwitch } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { pageFrame } from "./frame.js";

const bands = ["60 Hz", "150 Hz", "400 Hz", "1 kHz", "2.4 kHz", "6 kHz", "15 kHz"];
const equalizerPresets: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0],
  bass: [7, 5, 2, 0, 0, 0, 0],
  vocal: [-2, -1, 2, 5, 4, 1, 0],
  treble: [0, 0, 0, 1, 3, 6, 8],
  loudness: [6, 3, 0, -2, 0, 3, 6],
};
const equalizerOptions = [{ value: "flat", label: "Flat" }, { value: "bass", label: "Bass" }, { value: "vocal", label: "Vocal" }, { value: "treble", label: "Treble" }, { value: "loudness", label: "Loudness" }];
const signedDb = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)} dB`;
const bitrates = [64, 96, 128, 192, 256, 320];

export const SoundDisplayPage = defineComponent({
  setup() {
    const sound = reactive({ volume: 64, balance: 0, bitrate: 192 });
    const display = reactive({ brightness: 70, nightLight: false, warmth: 40, scale: 1 });
    const power = ref(1), quality = ref(2);

    return () => pageFrame("sliders-panels", "Thin WinUI tracks with a round thumb, ticks, snapping and labelled stops.", () => [
      h("div", { class: "showcase-columns" }, [
        card("showcase-sound", "Sound", null, [
          h(FluentSlider, { label: "Volume", modelValue: sound.volume, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { sound.volume = value; } }),
          h(FluentSlider, { label: "Balance", min: -50, max: 50, tickFrequency: 10, majorTickFrequency: 50, snap: "integer", modelValue: sound.balance, formatValue: (value: number) => value === 0 ? "Centered" : value < 0 ? `Left ${-Math.round(value)}` : `Right ${Math.round(value)}`, "onUpdate:modelValue": (value: number) => { sound.balance = value; } }),
          h(FluentSlider, { label: "Bitrate", min: 64, max: 320, availableValues: bitrates, snap: "available", modelValue: sound.bitrate, formatValue: (value: number) => `${Math.round(value)} kbps`, "onUpdate:modelValue": (value: number) => { sound.bitrate = value; } }),
        ]),
        card("showcase-display", "Display", null, [
          h(FluentSlider, { label: "Brightness", tickFrequency: 10, majorTickFrequency: 50, tickPlacement: "end", modelValue: display.brightness, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { display.brightness = value; } }),
          h(FluentSwitch, { label: "Night light", modelValue: display.nightLight, "onUpdate:modelValue": (value: boolean) => { display.nightLight = value; } }),
          h(FluentSlider, { label: "Night light strength", disabled: !display.nightLight, modelValue: display.warmth, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { display.warmth = value; } }),
          h(FluentSlider, { label: "Scale", min: 1, max: 2, step: 0.25, tickFrequency: 0.25, modelValue: display.scale, formatValue: (value: number) => `${Math.round(value * 100)}%`, "onUpdate:modelValue": (value: number) => { display.scale = value; } }),
        ]),
        card("showcase-modes", "Labelled stops", null, [
          h(FluentSlider, { label: "Power mode", min: 0, max: 2, snap: "available", stops: ["Best efficiency", "Balanced", "Best performance"].map((label, value) => ({ value, label })), modelValue: power.value, "onUpdate:modelValue": (value: number) => { power.value = value; } }),
          h(FluentSlider, { label: "Render quality", min: 0, max: 3, snap: "available", stops: ["Low", "Medium", "High", "Ultra"].map((label, value) => ({ value, label })), modelValue: quality.value, "onUpdate:modelValue": (value: number) => { quality.value = value; } }),
        ]),
      ]),
    ]);
  },
});

export const EqualizerPage = defineComponent({
  setup() {
    const gains = ref([...equalizerPresets.flat!]);
    const preset = computed(() => Object.entries(equalizerPresets).find(([, values]) => values.every((value, index) => value === gains.value[index]))?.[0]);
    const setGain = (index: number, value: number) => { gains.value = gains.value.map((gain, at) => at === index ? value : gain); };

    return () => pageFrame("sliders-equalizer", "Changing a value from code glides the thumb with the current curve and speed.", () => [
      card("showcase-equalizer", "Equalizer", "Vertical sliders with major ticks at the ends and the centre. Pick a preset to watch every thumb glide to its new value.", [
        h(FluentSegmented, { label: "Equalizer preset", "data-testid": "showcase-eq-preset", modelValue: preset.value ?? "", options: equalizerOptions, "onUpdate:modelValue": (value: string | number) => { gains.value = [...equalizerPresets[String(value)]!]; } }),
        h("div", { class: "equalizer" }, bands.map((band, index) => h("div", { class: "equalizer__band", key: band }, [
          h(FluentSlider, { label: band, orientation: "vertical", min: -12, max: 12, tickFrequency: 3, majorTickFrequency: 12, snap: "integer", modelValue: gains.value[index], formatValue: signedDb, "data-testid": `showcase-eq-${index}`, "onUpdate:modelValue": (value: number) => setGain(index, value) }),
        ]))),
        h("p", { class: "pref-note" }, preset.value ? `Preset: ${equalizerOptions.find((option) => option.value === preset.value)!.label}` : "Custom curve"),
      ], true),
    ]);
  },
});
