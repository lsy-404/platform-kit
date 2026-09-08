import { defineComponent, h, mergeProps, ref } from "vue";

export const FluentCheckbox = defineComponent({
  name: "FluentCheckbox",
  inheritAttrs: false,
  props: { modelValue: Boolean, disabled: Boolean, label: String },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit, slots }) {
    return () => {
      const { class: className, style, ...inputAttrs } = attrs;
      return h("label", { class: ["fluent-checkbox", className], style }, [
        h("input", mergeProps(inputAttrs, {
          class: "fluent-checkbox__input",
          type: "checkbox",
          checked: props.modelValue,
          disabled: props.disabled,
          onChange: (event: Event) => {
            const checked = (event.target as HTMLInputElement).checked;
            emit("update:modelValue", checked);
            emit("change", checked);
          },
        })),
        slots.default || props.label
          ? h("span", { class: "fluent-checkbox__label" }, slots.default?.() ?? props.label)
          : null,
      ]);
    };
  },
});

export const FluentRadio = defineComponent({
  name: "FluentRadio",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    value: { type: String, required: true },
    disabled: Boolean,
    label: String,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit, slots }) {
    return () => {
      const { class: className, style, ...inputAttrs } = attrs;
      return h("label", { class: ["fluent-radio", className], style }, [
        h("input", mergeProps(inputAttrs, {
          class: "fluent-radio__input",
          type: "radio",
          value: props.value,
          checked: props.modelValue === props.value,
          disabled: props.disabled,
          onChange: (event: Event) => {
            if (!(event.target as HTMLInputElement).checked) return;
            emit("update:modelValue", props.value);
            emit("change", props.value);
          },
        })),
        slots.default || props.label
          ? h("span", { class: "fluent-radio__label" }, slots.default?.() ?? props.label)
          : null,
      ]);
    };
  },
});

const progressProps = {
  value: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  label: String,
};
function progressValues(value: number, max: number) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100;
  return { max: limit, value: Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : 0 };
}

export const FluentProgressBar = defineComponent({
  name: "FluentProgressBar",
  inheritAttrs: false,
  props: { ...progressProps, indeterminate: Boolean },
  setup(props, { attrs }) {
    return () => {
      const state = progressValues(props.value, props.max);
      return h("progress", {
        ...attrs,
        class: ["fluent-progress-bar", attrs.class],
        max: state.max,
        value: props.indeterminate ? undefined : state.value,
        "aria-label": attrs["aria-label"] ?? props.label,
      });
    };
  },
});

export const FluentProgressRing = defineComponent({
  name: "FluentProgressRing",
  inheritAttrs: false,
  props: {
    ...progressProps,
    size: { type: Number, default: 20 },
    active: { type: Boolean, default: true },
    indeterminate: { type: Boolean, default: true },
  },
  setup(props, { attrs }) {
    return () => {
      if (!props.active) return null;
      const state = progressValues(props.value, props.max);
      const size = Number.isFinite(props.size) && props.size > 0 ? props.size : 20;
      return h("span", {
        ...attrs,
        class: ["fluent-progress-ring", { "fluent-progress-ring--indeterminate": props.indeterminate }, attrs.class],
        style: [attrs.style, { width: `${size}px`, height: `${size}px` }],
        role: "progressbar",
        "aria-label": attrs["aria-label"] ?? props.label,
        "aria-valuemin": 0,
        "aria-valuemax": state.max,
        "aria-valuenow": props.indeterminate ? undefined : state.value,
      }, [h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
        h("circle", { class: "fluent-progress-ring__track", cx: 12, cy: 12, r: 10 }),
        h("circle", {
          class: "fluent-progress-ring__value", cx: 12, cy: 12, r: 10, pathLength: 100,
          "stroke-dasharray": `${props.indeterminate ? 72 : state.value / state.max * 100} 100`,
        }),
      ])]);
    };
  },
});

export interface FluentScrollViewerHandle {
  element(): HTMLDivElement | null;
  scrollTo(options: ScrollToOptions): void;
}

export const FluentScrollViewer = defineComponent({
  name: "FluentScrollViewer",
  props: { horizontal: Boolean, focusable: { type: Boolean, default: true } },
  setup(props, { expose, slots }) {
    const viewport = ref<HTMLDivElement | null>(null);
    expose({
      element: () => viewport.value,
      scrollTo: (options: ScrollToOptions) => viewport.value?.scrollTo(options),
    } satisfies FluentScrollViewerHandle);
    return () => h("div", {
      ref: viewport,
      class: ["fluent-scroll-viewer", { "fluent-scroll-viewer--horizontal": props.horizontal }],
      tabindex: props.focusable ? 0 : undefined,
    }, slots.default?.());
  },
});
