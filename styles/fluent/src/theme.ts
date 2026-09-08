import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
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
    let media: MediaQueryList | undefined;
    const sync = () => {
      systemDark.value = media?.matches ?? false;
    };
    onMounted(() => {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      sync();
      media.addEventListener("change", sync);
    });
    onBeforeUnmount(() => media?.removeEventListener("change", sync));
    const theme = computed<FluentThemeState>(() => ({
      mode:
        props.mode === "system"
          ? systemDark.value
            ? "dark"
            : "light"
          : props.mode,
      ...(props.accent ? { accent: props.accent } : {}),
      ...(props.accentText ? { accentText: props.accentText } : {}),
      resolveTokens: () => {
        if (!element.value) return {};
        const style = getComputedStyle(element.value);
        const values: Record<string, string> = {};
        for (let index = 0; index < style.length; index++) {
          const name = style.item(index);
          if (name.startsWith("--fluent-")) values[name] = style.getPropertyValue(name);
        }
        return values;
      },
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
