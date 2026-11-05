import {
  computed,
  defineComponent,
  h,
  nextTick,
  ref,
  watch,
  type PropType,
} from "vue";
import type { FluentEmphasis, FluentMotion } from "../theme.js";
import { animateSelectionIndicator, captureSelectionIndicator } from "../behavior/selectionIndicator.js";

export interface FluentNavigationItem {
  key: string;
  label: string;
  disabled?: boolean;
}

export const FluentNavigation = defineComponent({
  name: "FluentNavigation",
  props: {
    items: { type: Array as PropType<FluentNavigationItem[]>, required: true },
    modelValue: { type: String, required: true },
    label: { type: String, default: "Navigation" },
    motion: { type: String as PropType<FluentMotion>, default: undefined },
    emphasis: { type: String as PropType<FluentEmphasis>, default: undefined },
  },
  emits: ["update:modelValue", "select"],
  setup(props, { emit }) {
    const itemEls = new Map<string, HTMLElement>();
    const root = ref<HTMLElement | null>(null);
    let previousRect: DOMRect | null = null;
    const findIndicator = () => root.value?.querySelector<HTMLElement>(".fluent-navigation__indicator");
    watch(() => props.modelValue, () => { previousRect = captureSelectionIndicator(findIndicator()); }, { flush: "pre" });
    watch(
      () => props.modelValue,
      () => {
        animateSelectionIndicator(findIndicator(), "y", previousRect);
        previousRect = null;
      },
      { flush: "post" },
    );
    const selectedIndex = computed(() =>
      props.items.findIndex((item) => item.key === props.modelValue),
    );
    // Scrolls only the navigation's own list, so selecting an item never moves the page around it.
    function reveal(key: string): void {
      const list = root.value;
      const item = itemEls.get(key);
      if (!list || !item || list.scrollHeight <= list.clientHeight) return;
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
    watch(
      () => props.modelValue,
      (value) => void nextTick(() => reveal(value)),
      { immediate: true },
    );
    function select(item: FluentNavigationItem): void {
      if (item.disabled || item.key === props.modelValue) return;
      emit("update:modelValue", item.key);
      emit("select", item.key);
      void nextTick(() =>
        itemEls.get(item.key)?.focus({ preventScroll: true }),
      );
    }
    function move(direction: 1 | -1): void {
      if (!props.items.length) return;
      let index = selectedIndex.value < 0 ? (direction === 1 ? -1 : 0) : selectedIndex.value;
      for (let attempts = 0; attempts < props.items.length; attempts += 1) {
        index = (index + direction + props.items.length) % props.items.length;
        const item = props.items[index];
        if (item && !item.disabled) {
          select(item);
          return;
        }
      }
    }
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        const item = props.items.find((candidate) => !candidate.disabled);
        if (item) select(item);
      }
      if (event.key === "End") {
        event.preventDefault();
        const item = [...props.items]
          .reverse()
          .find((candidate) => !candidate.disabled);
        if (item) select(item);
      }
    }
    return () =>
      h(
        "nav",
        {
          ref: root,
          class: "fluent-navigation",
          "data-fluent-motion": props.motion,
          "data-fluent-emphasis": props.emphasis,
          "aria-label": props.label,
          onKeydown,
        },
        props.items.map((item) => {
          const selected = item.key === props.modelValue;
          return h(
            "button",
            {
              key: item.key,
              ref: ((element: Element | null) => {
                if (element instanceof HTMLElement) itemEls.set(item.key, element);
                else itemEls.delete(item.key);
              }) as never,
              type: "button",
              class: ["fluent-navigation__item", { "is-selected": selected }],
              disabled: item.disabled,
              "aria-current": selected ? "page" : undefined,
              onClick: () => select(item),
            },
            [
              selected ? h("span", { class: "fluent-navigation__indicator", "aria-hidden": "true" }) : null,
              h("span", { class: "fluent-navigation__label" }, item.label),
            ],
          );
        }),
      );
  },
});
