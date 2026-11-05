import { defineComponent, h, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { FluentButton, FluentSegmented, FluentSelect, fluentDefaultPreferences, fluentPreferenceOptions, type FluentPreferences } from "@platform-kit/fluent/vue";

export type PreferenceKey = keyof FluentPreferences;

export const preferenceLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
export const preferenceOptions = (key: PreferenceKey) => fluentPreferenceOptions[key].map((value) => ({ value, label: preferenceLabel(value) }));

const keys = Object.keys(fluentPreferenceOptions) as PreferenceKey[];
const initial = new URLSearchParams(location.search);
const fromQuery = <K extends PreferenceKey>(key: K): FluentPreferences[K] => {
  const value = initial.get(key);
  return ((fluentPreferenceOptions[key] as readonly string[]).includes(value ?? "") ? value : fluentDefaultPreferences[key]) as FluentPreferences[K];
};

export const preferences = reactive<FluentPreferences>(Object.fromEntries(keys.map((key) => [key, fromQuery(key)])) as unknown as FluentPreferences);

export const resetPreferences = () => Object.assign(preferences, fluentDefaultPreferences);

export function syncQuery(extra: () => Record<string, string | undefined>) {
  watch((): Record<string, string | undefined> => ({ ...preferences, ...extra() }), (state) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined || value === "" || value === fluentDefaultPreferences[key as PreferenceKey] || (key === "theme" && value === "system")) params.delete(key);
      else params.set(key, value);
    }
    const search = params.toString();
    history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
  }, { immediate: true });
}

const segmented: { key: PreferenceKey; label: string; testId: string }[] = [
  { key: "motion", label: "Motion", testId: "pref-motion" },
  { key: "speed", label: "Speed", testId: "pref-speed" },
  { key: "reducedMotion", label: "Reduced motion", testId: "pref-reduced-motion" },
  { key: "corner", label: "Corners", testId: "pref-corner" },
];
const selects: { key: PreferenceKey; label: string; testId: string }[] = [
  { key: "curve", label: "Curve", testId: "pref-curve" },
  { key: "emphasis", label: "Emphasis", testId: "pref-emphasis" },
  { key: "pageTransition", label: "Transition", testId: "pref-page-transition" },
];

export const PreferenceBar = defineComponent({
  name: "PreferenceBar",
  setup() {
    let observer: ResizeObserver | undefined;
    // The sidebar and toolbar stick below the header, whose height depends on the viewport.
    onMounted(() => {
      const header = document.querySelector<HTMLElement>(".catalog-header");
      if (!header) return;
      observer = new ResizeObserver(() => document.documentElement.style.setProperty("--catalog-header-height", `${header.offsetHeight}px`));
      observer.observe(header);
    });
    onBeforeUnmount(() => observer?.disconnect());
    const update = (key: PreferenceKey) => (value: string | number) => { (preferences as Record<PreferenceKey, string>)[key] = String(value); };
    return () => h("div", { class: "pref-bar", role: "group", "aria-label": "Style preferences" }, [
      ...segmented.map(({ key, label, testId }) => h("div", { class: "pref-item", key }, [
        h("span", { class: "pref-label" }, label),
        h(FluentSegmented, { label, "data-testid": testId, modelValue: preferences[key], options: preferenceOptions(key), "onUpdate:modelValue": update(key) }),
      ])),
      ...selects.map(({ key, label, testId }) => h(FluentSelect, { key, label, "data-testid": testId, modelValue: preferences[key], options: preferenceOptions(key), "onUpdate:modelValue": update(key) })),
      h(FluentButton, { tone: "secondary", "data-testid": "pref-reset", onClick: resetPreferences }, () => "Reset"),
    ]);
  },
});
