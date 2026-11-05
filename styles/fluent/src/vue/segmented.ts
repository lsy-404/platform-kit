import { computed, defineComponent, h, ref, watch, type PropType } from "vue";
import type { FluentEmphasis, FluentMotion } from "../theme.js";
import { animateSelectionIndicator, captureSelectionIndicator } from "../behavior/selectionIndicator.js";

export interface FluentSegmentedOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export const FluentSegmented = defineComponent({
  name: "FluentSegmented",
  props: {
    modelValue: { type: [String, Number] as PropType<string | number>, default: undefined },
    options: { type: Array as PropType<readonly FluentSegmentedOption[]>, required: true },
    label: { type: String, default: undefined },
    disabled: { type: Boolean, default: false },
    motion: { type: String as PropType<FluentMotion>, default: undefined },
    emphasis: { type: String as PropType<FluentEmphasis>, default: undefined },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const root = ref<HTMLElement | null>(null);
    const itemEls = new Map<string | number, HTMLElement>();
    let previousRect: DOMRect | null = null;
    const findIndicator = () => root.value?.querySelector<HTMLElement>(".fluent-segmented__indicator");
    watch(() => props.modelValue, () => { previousRect = captureSelectionIndicator(findIndicator()); }, { flush: "pre" });
    watch(
      () => props.modelValue,
      () => {
        animateSelectionIndicator(findIndicator(), "x", previousRect);
        previousRect = null;
      },
      { flush: "post" },
    );

    const isDisabled = (option: FluentSegmentedOption) => props.disabled || !!option.disabled;
    const tabbableValue = computed(() => {
      const selected = props.options.find((option) => option.value === props.modelValue);
      if (selected && !isDisabled(selected)) return selected.value;
      return props.options.find((option) => !isDisabled(option))?.value;
    });

    function select(option: FluentSegmentedOption): void {
      if (isDisabled(option) || option.value === props.modelValue) return;
      emit("update:modelValue", option.value);
      emit("change", option.value);
    }
    function onKeydown(event: KeyboardEvent): void {
      const { options } = props;
      const rtl = root.value ? getComputedStyle(root.value).direction === "rtl" : false;
      let step = 0;
      if (event.key === "ArrowRight") step = rtl ? -1 : 1;
      else if (event.key === "ArrowLeft") step = rtl ? 1 : -1;
      else if (event.key === "ArrowDown") step = 1;
      else if (event.key === "ArrowUp") step = -1;
      else if (event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const enabled = options.filter((option) => !isDisabled(option));
      if (!enabled.length) return;
      let target: FluentSegmentedOption | undefined;
      if (event.key === "Home") target = enabled[0];
      else if (event.key === "End") target = enabled[enabled.length - 1];
      else {
        const focused = [...itemEls].find(([, element]) => element === document.activeElement)?.[0];
        const from = options.findIndex((option) => option.value === (focused ?? props.modelValue));
        let index = from < 0 ? (step === 1 ? -1 : 0) : from;
        for (let attempts = 0; attempts < options.length; attempts += 1) {
          index = (index + step + options.length) % options.length;
          const candidate = options[index];
          if (candidate && !isDisabled(candidate)) {
            target = candidate;
            break;
          }
        }
      }
      if (!target) return;
      itemEls.get(target.value)?.focus();
      select(target);
    }

    return () =>
      h(
        "div",
        {
          ref: root,
          class: "fluent-segmented",
          role: "radiogroup",
          "aria-label": props.label,
          "aria-disabled": props.disabled ? "true" : undefined,
          "data-fluent-motion": props.motion,
          "data-fluent-emphasis": props.emphasis,
          onKeydown,
        },
        props.options.map((option) => {
          const checked = option.value === props.modelValue;
          return h(
            "button",
            {
              key: option.value,
              ref: ((element: Element | null) => {
                if (element instanceof HTMLElement) itemEls.set(option.value, element);
                else itemEls.delete(option.value);
              }) as never,
              type: "button",
              class: "fluent-segmented__item",
              role: "radio",
              "aria-checked": checked ? "true" : "false",
              tabindex: option.value === tabbableValue.value ? 0 : -1,
              disabled: isDisabled(option),
              onClick: () => select(option),
            },
            [
              checked ? h("span", { class: "fluent-segmented__indicator", "aria-hidden": "true" }) : null,
              h("span", { class: "fluent-segmented__label" }, option.label),
            ],
          );
        }),
      );
  },
});
