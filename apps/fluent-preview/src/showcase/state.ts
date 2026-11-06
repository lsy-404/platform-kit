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
  { id: "snappy", name: "Snappy", description: "Short durations, a strong decelerate, plain toggles and quick fading dropdowns.", preferences: { pageTransition: "slide", toggleMotion: "slide", menuMotion: "fade", curve: "decelerate-max", speed: "fast", corner: "small" } },
  { id: "calm", name: "Calm", description: "Cross-fades everywhere, an even curve, slower timing and a tinted selection.", preferences: { motion: "fade", pageTransition: "fade", checkMotion: "fade", menuMotion: "fade", curve: "easy-ease", speed: "slow", emphasis: "tinted", corner: "large" }, accent: "#038387" },
  { id: "playful", name: "Playful", description: "A stretching indicator, drill-in pages, scaling dropdowns and a spring that overshoots.", preferences: { motion: "stretch", pageTransition: "scale", menuMotion: "scale", curve: "spring", emphasis: "filled", corner: "large" }, accent: "#b146c2" },
  { id: "editorial", name: "Editorial", description: "Underlined selection, square corners and an accent wipe between pages.", preferences: { pageTransition: "wipe", curve: "easy-ease-max", emphasis: "underline", corner: "none" }, accent: "#ca5010" },
  { id: "still", name: "Still", description: "Reduced motion: indicators jump, controls change instantly and pages switch without animating.", preferences: { reducedMotion: "reduce" } },
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
  { key: "motion-curves", label: "Curves and speed", section: "Motion" },
  { key: "motion-selection", label: "Selection motion", section: "Motion" },
  { key: "motion-controls", label: "Control motion", section: "Motion" },
  { key: "appearance-accent", label: "Accent", section: "Appearance" },
  { key: "appearance-emphasis", label: "Emphasis", section: "Appearance" },
  { key: "appearance-corners", label: "Corners", section: "Appearance" },
  { key: "transitions", label: "Page transitions" },
  { key: "controls-forms", label: "Forms", section: "Controls" },
  { key: "controls-actions", label: "Actions and overlays", section: "Controls" },
  { key: "sliders-panels", label: "Sound and display", section: "Sliders" },
  { key: "sliders-equalizer", label: "Equalizer", section: "Sliders" },
  { key: "feedback-progress", label: "Notices and progress", section: "Feedback" },
  { key: "feedback-activity", label: "Activity and graphics", section: "Feedback" },
] as const satisfies readonly { key: string; label: string; section?: string }[];

export type PageKey = (typeof pages)[number]["key"];
export const pageOrder: readonly PageKey[] = pages.map((page) => page.key);
const pageOf = (key: PageKey) => pages.find((page) => page.key === key)!;
export const pageLabel = (key: PageKey) => pageOf(key).label;
export const pageSection = (key: PageKey): string | undefined => {
  const page = pageOf(key);
  return "section" in page ? page.section : undefined;
};

export interface NavigationEntry { key: string; label: string; children?: NavigationEntry[] }

// Consecutive pages of one section become the children of a group header.
export const navigation: NavigationEntry[] = pages.reduce<NavigationEntry[]>((tree, page) => {
  const entry = { key: page.key, label: page.label };
  const last = tree.at(-1);
  if (!("section" in page)) tree.push(entry);
  else if (last?.label === page.section && last.children) last.children.push(entry);
  else tree.push({ key: page.section.toLowerCase(), label: page.section, children: [entry] });
  return tree;
}, []);

const pageFromHash = (): PageKey => pageOrder.find((key) => location.hash === `#${key}`) ?? "overview";

export const ui = reactive({ page: pageFromHash(), paneOpen: false, navOpen: false });

addEventListener("hashchange", () => { ui.page = pageFromHash(); });

export function navigate(key: PageKey) {
  ui.navOpen = false;
  ui.page = key;
  if (location.hash !== `#${key}`) location.hash = key;
}

export const openCustomize = () => { ui.paneOpen = true; };
