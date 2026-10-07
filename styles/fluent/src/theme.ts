import {
  computed,
  defineComponent,
  h,
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
export interface FluentThemeState {
  mode: "light" | "dark";
  accent?: string;
  accentText?: string;
  resolveTokens?: () => Record<string, string>;
}
export const fluentThemeKey: InjectionKey<ComputedRef<FluentThemeState>> =
  Symbol("fluent-theme");

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
  },
  setup(props, { slots, attrs }) {
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
      resolveTokens: () => tokens.value,
    }));
    provide(fluentThemeKey, theme);
    return () =>
      h(
        "div",
        {
          ...attrs,
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
