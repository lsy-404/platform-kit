import {
  computed,
  defineComponent,
  h,
  nextTick,
  ref,
  watch,
  type PropType,
  type VNode,
} from "vue";
import type { FluentEmphasis, FluentMotion } from "../theme.js";
import { animateSelectionIndicator, captureSelectionIndicator } from "../behavior/selectionIndicator.js";
import { fluentIcon } from "./icon.js";

export interface FluentNavigationItem {
  key: string;
  label: string;
  disabled?: boolean;
  children?: readonly FluentNavigationItem[];
}

interface NavigationNode {
  item: FluentNavigationItem;
  depth: number;
  parent: string | null;
}

let instanceCount = 0;

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
    instanceCount += 1;
    const uid = instanceCount;
    const itemEls = new Map<string, HTMLElement>();
    const root = ref<HTMLElement | null>(null);
    const expanded = ref<ReadonlySet<string>>(new Set());
    let previousRect: DOMRect | null = null;

    const nodes = computed(() => {
      const all = new Map<string, NavigationNode>();
      const walk = (items: readonly FluentNavigationItem[], depth: number, parent: string | null) => {
        for (const item of items) {
          all.set(item.key, { item, depth, parent });
          if (item.children?.length) walk(item.children, depth + 1, item.key);
        }
      };
      walk(props.items, 0, null);
      return all;
    });
    const isGroup = (item: FluentNavigationItem) => Boolean(item.children?.length);
    const ancestorsOf = (key: string): string[] => {
      const chain: string[] = [];
      for (let parent = nodes.value.get(key)?.parent ?? null; parent; parent = nodes.value.get(parent)?.parent ?? null) {
        chain.unshift(parent);
      }
      return chain;
    };
    const visible = computed(() => {
      const list: NavigationNode[] = [];
      const walk = (items: readonly FluentNavigationItem[]) => {
        for (const item of items) {
          const node = nodes.value.get(item.key);
          if (node) list.push(node);
          if (item.children?.length && expanded.value.has(item.key)) walk(item.children);
        }
      };
      walk(props.items);
      return list;
    });
    // The selected leaf, or the outermost collapsed ancestor that hides it.
    const indicatorKey = computed(
      () => ancestorsOf(props.modelValue).find((key) => !expanded.value.has(key)) ?? props.modelValue,
    );

    watch(
      () => props.modelValue,
      (value) => {
        const hidden = ancestorsOf(value).filter((key) => !expanded.value.has(key));
        if (hidden.length) expanded.value = new Set([...expanded.value, ...hidden]);
      },
      { immediate: true, flush: "pre" },
    );
    function toggle(key: string): void {
      const next = new Set(expanded.value);
      if (!next.delete(key)) next.add(key);
      expanded.value = next;
    }

    const findIndicator = () => root.value?.querySelector<HTMLElement>(".fluent-navigation__indicator");
    watch(indicatorKey, () => { previousRect = captureSelectionIndicator(findIndicator()); }, { flush: "pre" });
    watch(
      indicatorKey,
      () => {
        animateSelectionIndicator(findIndicator(), "y", previousRect);
        previousRect = null;
      },
      { flush: "post" },
    );
    // Scrolls only the navigation's own list, so selecting an item never moves the page around it.
    function reveal(key: string): void {
      const list = root.value;
      const item = itemEls.get(key);
      if (!list || !item || list.scrollHeight <= list.clientHeight) return;
      const listRect = list.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      if (rect.top < listRect.top) list.scrollTop += rect.top - listRect.top;
      else if (rect.bottom > listRect.bottom) list.scrollTop += rect.bottom - listRect.bottom;
    }
    watch(
      indicatorKey,
      (value) => void nextTick(() => reveal(value)),
      { immediate: true },
    );
    const focusItem = (key: string) => itemEls.get(key)?.focus({ preventScroll: true });
    function select(item: FluentNavigationItem): void {
      if (item.disabled) return;
      if (item.key !== props.modelValue) {
        emit("update:modelValue", item.key);
        emit("select", item.key);
      }
      void nextTick(() => focusItem(item.key));
    }
    function land(node: NavigationNode | undefined): void {
      if (!node) return;
      if (isGroup(node.item)) focusItem(node.item.key);
      else select(node.item);
    }
    function onKeydown(node: NavigationNode, event: KeyboardEvent): void {
      const list = visible.value;
      const enabled = list.filter((candidate) => !candidate.item.disabled);
      const key = node.item.key;
      const rtl = root.value ? getComputedStyle(root.value).direction === "rtl" : false;
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      const group = isGroup(node.item);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const index = list.indexOf(node);
        for (let attempts = 1; attempts <= list.length; attempts += 1) {
          const candidate = list[(index + step * attempts + list.length * attempts) % list.length];
          if (candidate && !candidate.item.disabled) {
            land(candidate);
            return;
          }
        }
      } else if (event.key === "Home") {
        event.preventDefault();
        land(enabled[0]);
      } else if (event.key === "End") {
        event.preventDefault();
        land(enabled[enabled.length - 1]);
      } else if (event.key === forward && group && !node.item.disabled) {
        event.preventDefault();
        if (!expanded.value.has(key)) toggle(key);
        else land(node.item.children?.map((child) => nodes.value.get(child.key)).find((child) => child && !child.item.disabled));
      } else if (event.key === back) {
        if (group && expanded.value.has(key) && !node.item.disabled) {
          event.preventDefault();
          toggle(key);
        } else if (node.parent) {
          event.preventDefault();
          focusItem(node.parent);
        }
      }
    }
    const groupIds = new Map<string, number>();
    const idFor = (key: string, part: string) => {
      if (!groupIds.has(key)) groupIds.set(key, groupIds.size);
      return `fluent-navigation-${uid}-${groupIds.get(key)}-${part}`;
    };

    function renderItem(item: FluentNavigationItem, depth: number): VNode {
      const group = isGroup(item);
      const open = expanded.value.has(item.key);
      const marked = item.key === indicatorKey.value;
      const button = h(
        "button",
        {
          key: group ? undefined : item.key,
          ref: ((element: Element | null) => {
            if (element instanceof HTMLElement) itemEls.set(item.key, element);
            else itemEls.delete(item.key);
          }) as never,
          type: "button",
          id: group ? idFor(item.key, "header") : undefined,
          class: ["fluent-navigation__item", { "is-selected": marked, "is-group": group }],
          style: depth ? { "--fluent-navigation-depth": depth } : undefined,
          disabled: item.disabled,
          "aria-current": !group && item.key === props.modelValue ? "page" : undefined,
          "aria-expanded": group ? String(open) : undefined,
          "aria-controls": group ? idFor(item.key, "group") : undefined,
          onClick: () => (group ? toggle(item.key) : select(item)),
          onKeydown: (event: KeyboardEvent) => {
            const node = nodes.value.get(item.key);
            if (node) onKeydown(node, event);
          },
        },
        [
          marked ? h("span", { class: "fluent-navigation__indicator", "aria-hidden": "true" }) : null,
          h("span", { class: "fluent-navigation__label" }, item.label),
          group ? fluentIcon("chevron-down", "fluent-navigation__chevron") : null,
        ],
      );
      if (!group) return button;
      return h("div", { key: item.key, class: "fluent-navigation__branch" }, [
        button,
        h(
          "div",
          {
            id: idFor(item.key, "group"),
            class: ["fluent-navigation__group", { "is-expanded": open }],
            role: "group",
            "aria-labelledby": idFor(item.key, "header"),
          },
          [h("div", { class: "fluent-navigation__children" }, item.children?.map((child) => renderItem(child, depth + 1)))],
        ),
      ]);
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
        },
        props.items.map((item) => renderItem(item, 0)),
      );
  },
});
