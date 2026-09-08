import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  mergeProps,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from "vue";
import { FluentPopover } from "./overlays.js";
import type { FluentSelectOption } from "./controls.js";

export type FluentMenuItem = {
  readonly value?: string;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly separator?: boolean;
};

let nextSelectionId = 1;

function enabledIndex<T>(items: readonly T[], start: number, direction: 1 | -1, enabled: (item: T) => boolean): number {
  if (!items.length) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (start + direction * offset + items.length) % items.length;
    const item = items[index];
    if (item !== undefined && enabled(item)) return index;
  }
  return -1;
}

function firstEnabled<T>(items: readonly T[], enabled: (item: T) => boolean): number {
  return items.findIndex(enabled);
}

function lastEnabled<T>(items: readonly T[], enabled: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && enabled(item)) return index;
  }
  return -1;
}

export const FluentSelect = defineComponent({
  name: "FluentSelect",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    label: String,
    options: {
      type: Array as PropType<readonly FluentSelectOption[]>,
      default: () => [],
    },
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    const trigger = ref<HTMLElement | null>(null);
    const activeIndex = ref(-1);
    const open = ref(false);
    const restoreFocus = ref(true);
    const id = typeof attrs.id === "string" ? attrs.id : `fluent-select-${nextSelectionId++}`;
    let typeahead = "";
    let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;
    const selected = computed(
      () => props.options.find((option) => option.value === props.modelValue) ?? null,
    );
    const activeId = computed(() =>
      activeIndex.value >= 0 ? `${id}-option-${activeIndex.value}` : undefined,
    );
    const enabled = (option: FluentSelectOption) => !option.disabled;
    const setActive = (index: number) => {
      activeIndex.value = index;
      if (typeof document !== "undefined")
        void nextTick(() =>
          document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" }),
        );
    };
    const close = () => {
      open.value = false;
      activeIndex.value = -1;
    };
    const show = (preferred?: number) => {
      if (props.disabled) return;
      restoreFocus.value = true;
      const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue && enabled(option));
      const index = preferred ?? (selectedIndex >= 0 ? selectedIndex : firstEnabled(props.options, enabled));
      if (index < 0) return;
      open.value = true;
      setActive(index);
    };
    const commit = (index = activeIndex.value) => {
      const option = props.options[index];
      if (!option || option.disabled) return;
      emit("update:modelValue", option.value);
      emit("change", option.value);
      close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (props.disabled) return;
      const key = event.key;
      if (key === "Tab" && open.value) {
        restoreFocus.value = false;
        close();
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        if (!open.value) return show(key === "ArrowDown" ? firstEnabled(props.options, enabled) : lastEnabled(props.options, enabled));
        const next = enabledIndex(props.options, activeIndex.value, key === "ArrowDown" ? 1 : -1, enabled);
        if (next >= 0) setActive(next);
        return;
      }
      if (key === "Home" || key === "End") {
        event.preventDefault();
        if (!open.value) show(key === "Home" ? firstEnabled(props.options, enabled) : lastEnabled(props.options, enabled));
        else setActive(key === "Home" ? firstEnabled(props.options, enabled) : lastEnabled(props.options, enabled));
        return;
      }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        if (open.value) commit();
        else show();
        return;
      }
      if (key === "Escape" && open.value) {
        event.preventDefault();
        close();
        return;
      }
      if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      typeahead += key.toLocaleLowerCase();
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => { typeahead = ""; }, 600);
      const start = activeIndex.value >= 0 ? activeIndex.value : -1;
      for (let offset = 1; offset <= props.options.length; offset += 1) {
        const index = (start + offset + props.options.length) % props.options.length;
        const option = props.options[index];
        if (option && enabled(option) && option.label.toLocaleLowerCase().startsWith(typeahead)) {
          event.preventDefault();
          if (!open.value) open.value = true;
          setActive(index);
          break;
        }
      }
    };
    if (getCurrentInstance())
      onBeforeUnmount(() => { if (typeaheadTimer) clearTimeout(typeaheadTimer); });
    return () =>
      h("div", { class: ["fluent-select", { "fluent-select--open": open.value, "fluent-select--disabled": props.disabled }] }, [
        props.label ? h("span", { id: `${id}-label`, class: "fluent-select__label" }, props.label) : null,
        h("button", mergeProps(attrs, {
          ref: trigger,
          id,
          type: "button",
          role: "combobox",
          class: ["fluent-select__control", attrs.class],
          disabled: props.disabled,
          "aria-labelledby": props.label ? `${id}-label` : attrs["aria-labelledby"],
          "aria-haspopup": "listbox",
          "aria-expanded": String(open.value),
          "aria-controls": open.value ? `${id}-listbox` : undefined,
          "aria-activedescendant": open.value ? activeId.value : undefined,
          onClick: () => (open.value ? close() : show()),
          onKeydown,
        }), [
          h("span", { class: "fluent-select__value" }, selected.value?.label ?? ""),
          h("span", { class: "fluent-select__chevron", "aria-hidden": "true" }),
        ]),
        h(FluentPopover, {
          open: open.value,
          label: props.label ?? String(attrs["aria-label"] ?? ""),
          anchor: trigger.value,
          role: "presentation",
          focusOnOpen: false,
          restoreFocusOnClose: restoreFocus.value,
          "onUpdate:open": (next: boolean) => { if (!next) close(); },
        }, {
          default: () => h("div", {
            id: `${id}-listbox`,
            class: "fluent-select__listbox",
            role: "listbox",
            "aria-labelledby": props.label ? `${id}-label` : attrs["aria-labelledby"],
          }, props.options.map((option, index) => h("button", {
            id: `${id}-option-${index}`,
            key: option.value,
            type: "button",
            role: "option",
            tabindex: -1,
            class: ["fluent-select__option", { "is-active": activeIndex.value === index, "is-selected": option.value === props.modelValue }],
            disabled: option.disabled,
            "aria-selected": String(option.value === props.modelValue),
            onMousedown: (event: MouseEvent) => event.preventDefault(),
            onMousemove: () => { if (!option.disabled) setActive(index); },
            onClick: () => commit(index),
          }, option.label))),
        }),
      ]);
  },
});

export const FluentMenu = defineComponent({
  name: "FluentMenu",
  props: {
    open: Boolean,
    label: { type: String, required: true },
    anchor: { type: Object as PropType<HTMLElement | null>, default: null },
    portal: { type: Object as PropType<HTMLElement | null>, default: null },
    items: { type: Array as PropType<readonly FluentMenuItem[]>, default: () => [] },
    modelValue: { type: [String, Array] as PropType<string | readonly string[] | undefined>, default: undefined },
    multiple: Boolean,
    closeOnSelect: { type: Boolean, default: undefined },
  },
  emits: ["update:open", "close", "select", "update:modelValue", "change"],
  setup(props, { emit }) {
    const activeIndex = ref(-1);
    const restoreFocus = ref(true);
    let typeahead = "";
    let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
    const id = `fluent-menu-${nextSelectionId++}`;
    const enabled = (item: FluentMenuItem) => !item.separator && !item.disabled && Boolean(item.value);
    const selected = (item: FluentMenuItem) => Array.isArray(props.modelValue)
      ? props.modelValue.includes(item.value ?? "")
      : props.modelValue === item.value;
    const setActive = (index: number) => {
      activeIndex.value = index;
      if (typeof document !== "undefined")
        void nextTick(() => document.getElementById(`${id}-item-${index}`)?.scrollIntoView({ block: "nearest" }));
    };
    const close = () => {
      activeIndex.value = -1;
      emit("update:open", false);
      emit("close");
    };
    const choose = (index = activeIndex.value) => {
      const item = props.items[index];
      if (!item || !enabled(item)) return;
      let nextValue: string | string[] | undefined = item.value;
      if (props.multiple) {
        const values = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
        const valueIndex = values.indexOf(item.value!);
        if (valueIndex >= 0) values.splice(valueIndex, 1);
        else values.push(item.value!);
        nextValue = values;
      }
      emit("select", item.value, item);
      emit("update:modelValue", nextValue);
      emit("change", nextValue);
      if (props.closeOnSelect ?? !props.multiple) close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (!props.open || !(event.target instanceof Node) || (!props.anchor?.contains(event.target) && !document.getElementById(id)?.contains(event.target))) return;
      if (event.key === "Tab") {
        restoreFocus.value = false;
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = enabledIndex(props.items, activeIndex.value, event.key === "ArrowDown" ? 1 : -1, enabled);
        if (next >= 0) setActive(next);
      } else if (event.key === "Home") {
        event.preventDefault(); setActive(firstEnabled(props.items, enabled));
      } else if (event.key === "End") {
        event.preventDefault(); setActive(lastEnabled(props.items, enabled));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); choose();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        typeahead += event.key.toLocaleLowerCase();
        if (typeaheadTimer) clearTimeout(typeaheadTimer);
        typeaheadTimer = setTimeout(() => { typeahead = ""; }, 600);
        for (let offset = 1; offset <= props.items.length; offset++) {
          const index = (activeIndex.value + offset + props.items.length) % props.items.length;
          const item = props.items[index];
          if (item && enabled(item) && item.label?.toLocaleLowerCase().startsWith(typeahead)) {
            event.preventDefault();
            setActive(index);
            break;
          }
        }
      }
    };
    const syncActive = () => {
      if (props.open) { restoreFocus.value = true; setActive(firstEnabled(props.items, enabled)); }
      else activeIndex.value = -1;
    };
    watch(() => props.open, syncActive, { immediate: true });
    if (getCurrentInstance()) {
      onMounted(() => document.addEventListener("keydown", onKeydown, true));
      onBeforeUnmount(() => {
        document.removeEventListener("keydown", onKeydown, true);
        if (typeaheadTimer) clearTimeout(typeaheadTimer);
      });
    }
    return () => h(FluentPopover, {
      open: props.open,
      label: props.label,
      anchor: props.anchor,
      portal: props.portal,
      role: "presentation",
      focusOnOpen: false,
      restoreFocusOnClose: restoreFocus.value,
      "onUpdate:open": (next: boolean) => { if (!next) close(); },
    }, {
      default: () => h("div", { id, class: "fluent-menu", role: "menu", "aria-label": props.label }, props.items.map((item, index) => item.separator
        ? h("div", { key: `separator-${index}`, class: "fluent-menu__separator", role: "separator" })
        : h("button", {
          id: `${id}-item-${index}`,
          key: item.value ?? index,
          type: "button",
          tabindex: -1,
          role: props.multiple ? "menuitemcheckbox" : "menuitem",
          class: ["fluent-menu__item", { "is-active": activeIndex.value === index, "is-selected": selected(item) }],
          disabled: item.disabled,
          "aria-checked": props.multiple ? String(selected(item)) : undefined,
          onMousedown: (event: MouseEvent) => event.preventDefault(),
          onMousemove: () => { if (enabled(item)) setActive(index); },
          onClick: () => choose(index),
        }, [
          props.multiple ? h("span", { class: "fluent-menu__check", "aria-hidden": "true" }, selected(item) ? "✓" : "") : null,
          h("span", { class: "fluent-menu__item-label" }, item.label),
        ]))),
    });
  },
});
