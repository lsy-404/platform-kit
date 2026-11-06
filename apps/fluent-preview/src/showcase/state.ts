import { reactive } from "vue";
import { fluentDefaultPreferences, fluentPreferenceOptions, type FluentPreferences, type FluentThemeMode } from "@platform-kit/fluent/vue";
import { preferences, resetPreferences, syncQuery, type PreferenceKey } from "../preferences.js";

const query = new URLSearchParams(location.search);
const modes: readonly FluentThemeMode[] = ["light", "dark", "system"];
const initialMode = query.get("theme") as FluentThemeMode;

export const appearance = reactive<{ mode: FluentThemeMode; accent: string | undefined }>({
  mode: modes.includes(initialMode) ? initialMode : "system",
  accent: query.get("accent") ?? undefined,
});

export const syncShowcaseQuery = () => syncQuery(() => ({ theme: appearance.mode, accent: appearance.accent }));

export const accents = [
  { value: "#0078d4", label: "Blue" },
  { value: "#0063b1", label: "Navy" },
  { value: "#744da9", label: "Purple" },
  { value: "#b146c2", label: "Orchid" },
  { value: "#e81123", label: "Red" },
  { value: "#ca5010", label: "Orange" },
  { value: "#107c10", label: "Green" },
  { value: "#038387", label: "Teal" },
];

export interface ShowcasePreset {
  id: string;
  name: string;
  description: string;
  preferences: Partial<FluentPreferences>;
  accent?: string;
}

export const presets: ShowcasePreset[] = [
  { id: "default", name: "Default", description: "The kit defaults: a sliding indicator, the page entrance and the mid decelerate curve.", preferences: {} },
  { id: "snappy", name: "Snappy", description: "Short durations, a strong decelerate and sliding pages for keyboard-heavy tools.", preferences: { pageTransition: "slide", curve: "decelerate-max", speed: "fast", corner: "small" } },
  { id: "calm", name: "Calm", description: "Cross-fades, an even curve, slower timing and a tinted selection.", preferences: { motion: "fade", pageTransition: "fade", curve: "easy-ease", speed: "slow", emphasis: "tinted", corner: "large" }, accent: "#038387" },
  { id: "playful", name: "Playful", description: "A stretching indicator, drill-in pages and a spring that overshoots.", preferences: { motion: "stretch", pageTransition: "scale", curve: "spring", emphasis: "filled", corner: "large" }, accent: "#b146c2" },
  { id: "editorial", name: "Editorial", description: "Underlined selection, square corners and an accent wipe between pages.", preferences: { pageTransition: "wipe", curve: "easy-ease-max", emphasis: "underline", corner: "none" }, accent: "#ca5010" },
  { id: "still", name: "Still", description: "Reduced motion: indicators jump and pages switch without animating.", preferences: { reducedMotion: "reduce" } },
];

const keys = Object.keys(fluentPreferenceOptions) as PreferenceKey[];
const presetValue = (preset: ShowcasePreset, key: PreferenceKey) => preset.preferences[key] ?? fluentDefaultPreferences[key];

export const isActivePreset = (preset: ShowcasePreset) =>
  keys.every((key) => preferences[key] === presetValue(preset, key)) && appearance.accent === preset.accent;

export function applyPreset(preset: ShowcasePreset) {
  Object.assign(preferences, fluentDefaultPreferences, preset.preferences);
  appearance.accent = preset.accent;
}

export function resetShowcase() {
  resetPreferences();
  appearance.accent = undefined;
}

export const pages = [
  { key: "overview", label: "Overview" },
  { key: "motion", label: "Motion" },
  { key: "emphasis", label: "Emphasis and shape" },
  { key: "transitions", label: "Page transitions" },
  { key: "controls", label: "Controls" },
  { key: "sliders", label: "Sliders" },
  { key: "feedback", label: "Feedback and graphics" },
] as const;

export type PageKey = (typeof pages)[number]["key"];
export const pageOrder: readonly PageKey[] = pages.map((page) => page.key);
export const pageLabel = (key: PageKey) => pages.find((page) => page.key === key)!.label;

const pageFromHash = (): PageKey => pageOrder.find((key) => location.hash === `#${key}`) ?? "overview";

export const ui = reactive({ page: pageFromHash(), paneOpen: false, navOpen: false });

addEventListener("hashchange", () => { ui.page = pageFromHash(); });

export function navigate(key: PageKey) {
  ui.navOpen = false;
  ui.page = key;
  if (location.hash !== `#${key}`) location.hash = key;
}

export const openCustomize = () => { ui.paneOpen = true; };
