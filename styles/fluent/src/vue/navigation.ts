import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from "vue";

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
  },
  emits: ["update:modelValue", "select"],
  setup(props, { emit }) {
    const root = ref<HTMLElement | null>(null);
    const itemEls = new Map<string, HTMLElement>();
    const selection = ref({ height: 0, y: 0, visible: false });
    let observer: ResizeObserver | null = null;
    const selectedIndex = computed(() =>
      props.items.findIndex((item) => item.key === props.modelValue),
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
    function updateSelection(): void {
      const rootEl = root.value;
      const selected = itemEls.get(props.modelValue);
      if (!rootEl || !selected) {
        selection.value = { height: 0, y: 0, visible: false };
        return;
      }
      const rootBox = rootEl.getBoundingClientRect();
      const itemBox = selected.getBoundingClientRect();
      selection.value = {
        height: itemBox.height,
        y: itemBox.top - rootBox.top + rootEl.scrollTop,
        visible: true,
      };
    }
    const onScroll = () => updateSelection();
    watch(
      () => props.modelValue,
      () =>
        void nextTick(() => {
          const selected = itemEls.get(props.modelValue);
          selected?.scrollIntoView({ block: "nearest" });
          updateSelection();
        }),
      { immediate: true },
    );
    watch(() => props.items, () => void nextTick(updateSelection), { deep: true });
    onMounted(() => {
      root.value?.addEventListener("scroll", onScroll);
      if (typeof ResizeObserver !== "undefined" && root.value) {
        observer = new ResizeObserver(updateSelection);
        observer.observe(root.value);
      }
      void nextTick(updateSelection);
    });
    onBeforeUnmount(() => {
      root.value?.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    });
    return () =>
      h(
        "nav",
        {
          ref: root,
          class: "fluent-navigation",
          "aria-label": props.label,
          onKeydown,
        },
        [
          h("span", {
            class: "fluent-navigation__selection",
            "aria-hidden": "true",
            style: {
              height: `${selection.value.height}px`,
              opacity: selection.value.visible ? 1 : 0,
              transform: `translateY(${selection.value.y}px)`,
            },
          }),
          ...props.items.map((item) => {
            const selected = item.key === props.modelValue;
            return h(
              "button",
              {
                key: item.key,
                ref: ((element: Element | null) => {
                  if (element instanceof HTMLElement)
                    itemEls.set(item.key, element);
                  else itemEls.delete(item.key);
                }) as never,
                type: "button",
                class: ["fluent-navigation__item", { "is-selected": selected }],
                disabled: item.disabled,
                "aria-current": selected ? "page" : undefined,
                onClick: () => select(item),
              },
              item.label,
            );
          }),
        ],
      );
  },
});
