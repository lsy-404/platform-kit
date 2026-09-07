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
    }));
    provide(fluentThemeKey, theme);
    return () =>
      h(
        "div",
        {
          ...attrs,
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
