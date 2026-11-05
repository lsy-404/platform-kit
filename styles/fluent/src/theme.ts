import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  shallowRef,
  provide,
  ref,
  type ComputedRef,
  type InjectionKey,
  type PropType,
} from "vue";

export type FluentThemeMode = "light" | "dark" | "system";

export const fluentPreferenceOptions = {
  motion: ["slide", "stretch", "fade", "none"],
  pageTransition: ["entrance", "fade", "slide", "scale", "wipe", "none"],
  curve: ["decelerate-max", "decelerate-mid", "decelerate-min", "easy-ease", "easy-ease-max", "ease", "linear", "spring"],
  speed: ["faster", "fast", "normal", "slow", "slower"],
  reducedMotion: ["system", "reduce"],
  emphasis: ["indicator", "neutral", "tinted", "filled", "underline"],
  corner: ["none", "small", "medium", "large"],
} as const;

export type FluentMotion = (typeof fluentPreferenceOptions.motion)[number];
export type FluentPageTransition = (typeof fluentPreferenceOptions.pageTransition)[number];
export type FluentCurve = (typeof fluentPreferenceOptions.curve)[number];
export type FluentSpeed = (typeof fluentPreferenceOptions.speed)[number];
export type FluentReducedMotion = (typeof fluentPreferenceOptions.reducedMotion)[number];
export type FluentEmphasis = (typeof fluentPreferenceOptions.emphasis)[number];
export type FluentCorner = (typeof fluentPreferenceOptions.corner)[number];

export interface FluentPreferences {
  motion: FluentMotion;
  pageTransition: FluentPageTransition;
  curve: FluentCurve;
  speed: FluentSpeed;
  reducedMotion: FluentReducedMotion;
  emphasis: FluentEmphasis;
  corner: FluentCorner;
}

export const fluentDefaultPreferences: Readonly<FluentPreferences> = {
  motion: "slide",
  pageTransition: "entrance",
  curve: "decelerate-mid",
  speed: "normal",
  reducedMotion: "system",
  emphasis: "indicator",
  corner: "medium",
};

export interface FluentThemeState {
  mode: "light" | "dark";
  accent?: string;
  accentText?: string;
  preferences: FluentPreferences;
  resolveTokens?: () => Record<string, string>;
}
export const fluentThemeKey: InjectionKey<ComputedRef<FluentThemeState>> =
  Symbol("fluent-theme");

const preferenceAttributes: Record<keyof FluentPreferences, string> = {
  motion: "data-fluent-motion",
  pageTransition: "data-fluent-page-transition",
  curve: "data-fluent-curve",
  speed: "data-fluent-speed",
  reducedMotion: "data-fluent-reduced-motion",
  emphasis: "data-fluent-emphasis",
  corner: "data-fluent-corner",
};

function accentTextFor(color: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#000";
  context.fillStyle = color.trim();
  const resolved = context.fillStyle;
  const hex = /^#([0-9a-f]{6})$/i.exec(resolved)?.[1];
  const rgb = hex
    ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    : /^rgba?\((\d+), (\d+), (\d+)/.exec(resolved)?.slice(1, 4).map(Number);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.179 ? "#fff" : "#000";
}

export const FluentTheme = defineComponent({
  name: "FluentTheme",
  inheritAttrs: false,
  props: {
    mode: { type: String as PropType<FluentThemeMode>, default: "system" },
    accent: String,
    accentText: String,
    motion: String as PropType<FluentMotion>,
    pageTransition: String as PropType<FluentPageTransition>,
    curve: String as PropType<FluentCurve>,
    speed: String as PropType<FluentSpeed>,
    reducedMotion: String as PropType<FluentReducedMotion>,
    emphasis: String as PropType<FluentEmphasis>,
    corner: String as PropType<FluentCorner>,
  },
  setup(props, { slots, attrs }) {
    const parent = inject(fluentThemeKey, undefined);
    const preferences = computed<FluentPreferences>(() => {
      const inherited = parent?.value.preferences ?? fluentDefaultPreferences;
      return {
        motion: props.motion ?? inherited.motion,
        pageTransition: props.pageTransition ?? inherited.pageTransition,
        curve: props.curve ?? inherited.curve,
        speed: props.speed ?? inherited.speed,
        reducedMotion: props.reducedMotion ?? inherited.reducedMotion,
        emphasis: props.emphasis ?? inherited.emphasis,
        corner: props.corner ?? inherited.corner,
      };
    });
    const element = ref<HTMLElement | null>(null);
    const systemDark = ref(false);
    const tokens = shallowRef<Record<string, string>>({});
    const syncTokens = () => {
      if (!element.value) return;
      const style = getComputedStyle(element.value);
      const values: Record<string, string> = {};
      for (let index = 0; index < style.length; index++) {
        const name = style.item(index);
        if (name.startsWith("--fluent-")) values[name] = style.getPropertyValue(name);
      }
      if (Object.keys(values).length !== Object.keys(tokens.value).length
        || Object.entries(values).some(([name, value]) => tokens.value[name] !== value)) tokens.value = values;
    };
    onUpdated(syncTokens);
    let media: MediaQueryList | undefined;
    const sync = () => {
      systemDark.value = media?.matches ?? false;
    };
    onMounted(() => {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      sync();
      syncTokens();
      media.addEventListener("change", sync);
    });
    onBeforeUnmount(() => media?.removeEventListener("change", sync));
    const accentText = computed(() => props.accentText ?? (props.accent ? accentTextFor(props.accent) : undefined));
    const theme = computed<FluentThemeState>(() => ({
      mode:
        props.mode === "system"
          ? systemDark.value
            ? "dark"
            : "light"
          : props.mode,
      ...(props.accent ? { accent: props.accent } : {}),
      ...(accentText.value ? { accentText: accentText.value } : {}),
      preferences: preferences.value,
      resolveTokens: () => tokens.value,
    }));
    provide(fluentThemeKey, theme);
    // Only explicit props become attributes, so an unset preference keeps inheriting through CSS.
    const preferenceAttrs = () => Object.fromEntries(
      (Object.keys(preferenceAttributes) as (keyof FluentPreferences)[])
        .filter((key) => props[key] !== undefined)
        .map((key) => [preferenceAttributes[key], props[key]]),
    );
    return () =>
      h(
        "div",
        {
          ...attrs,
          ...preferenceAttrs(),
          ref: element,
          class: ["fluent-theme", attrs.class],
          "data-fluent-theme": theme.value.mode,
          style: [
            attrs.style,
            {
              ...(theme.value.accent
                ? { "--fluent-accent": theme.value.accent }
                : {}),
              ...(theme.value.accentText
                ? { "--fluent-accent-text": theme.value.accentText }
                : {}),
            },
          ],
        },
        slots.default?.(),
      );
  },
});
