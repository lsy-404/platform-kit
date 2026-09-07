import { defineComponent, h, mergeProps, type PropType } from "vue";

export type FluentButtonTone = "primary" | "secondary" | "danger" | "subtle";
export type FluentNoticeTone = "info" | "success" | "warning" | "danger";

export interface FluentSelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export function sliderPercentage(
  value: number,
  min: number,
  max: number,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  )
    return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function numericInputValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

export const FluentButton = defineComponent({
  name: "FluentButton",
  inheritAttrs: false,
  props: {
    tone: { type: String as PropType<FluentButtonTone>, default: "secondary" },
    type: {
      type: String as PropType<"button" | "submit" | "reset">,
      default: "button",
    },
    disabled: Boolean,
    busy: Boolean,
  },
  emits: ["click"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: props.type,
          class: ["fluent-button", `fluent-button--${props.tone}`, attrs.class],
          disabled: props.disabled || props.busy,
          "aria-busy": props.busy || undefined,
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.(),
      );
  },
});

export const FluentField = defineComponent({
  name: "FluentField",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    label: { type: String, required: true },
    disabled: Boolean,
    placeholder: String,
    type: { type: String, default: "text" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", { class: "fluent-field" }, [
        h("span", { class: "fluent-field__label" }, props.label),
        h(
          "input",
          mergeProps(attrs, {
            class: ["fluent-field__input", attrs.class],
            type: props.type,
            value: props.modelValue,
            disabled: props.disabled,
            placeholder: props.placeholder,
            onInput: (event: Event) =>
              emit("update:modelValue", inputValue(event)),
          }),
        ),
      ]);
  },
});

export const FluentSwitch = defineComponent({
  name: "FluentSwitch",
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    label: { type: String, required: true },
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          role: "switch",
          class: [
            "fluent-switch",
            { "fluent-switch--checked": props.modelValue },
            attrs.class,
          ],
          disabled: props.disabled,
          "aria-checked": String(props.modelValue),
          onClick: () => {
            if (props.disabled) return;
            const nextValue = !props.modelValue;
            emit("update:modelValue", nextValue);
            emit("change", nextValue);
          },
        },
        [
          h("span", { class: "fluent-switch__track", "aria-hidden": "true" }, [
            h("span", { class: "fluent-switch__thumb" }),
          ]),
          h("span", { class: "fluent-switch__label" }, props.label),
        ],
      );
  },
});

export const FluentSlider = defineComponent({
  name: "FluentSlider",
  inheritAttrs: false,
  props: {
    modelValue: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    label: { type: String, required: true },
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", { class: "fluent-slider" }, [
        h("span", { class: "fluent-slider__header" }, [
          h("span", { class: "fluent-slider__label" }, props.label),
          h(
            "output",
            { class: "fluent-slider__value" },
            `${sliderPercentage(props.modelValue, props.min, props.max).toFixed(0)}%`,
          ),
        ]),
        h(
          "input",
          mergeProps(attrs, {
            class: ["fluent-slider__input", attrs.class],
            type: "range",
            value: props.modelValue,
            min: props.min,
            max: props.max,
            step: props.step,
            disabled: props.disabled,
            "aria-label": props.label,
            style: {
              "--fluent-slider-position": `${sliderPercentage(props.modelValue, props.min, props.max)}%`,
            },
            onInput: (event: Event) =>
              emit("update:modelValue", numericInputValue(event)),
            onChange: (event: Event) =>
              emit("change", numericInputValue(event)),
          }),
        ),
      ]);
  },
});

export const FluentSelect = defineComponent({
  name: "FluentSelect",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    label: { type: String, required: true },
    options: {
      type: Array as PropType<readonly FluentSelectOption[]>,
      default: () => [],
    },
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", { class: "fluent-select" }, [
        h("span", { class: "fluent-select__label" }, props.label),
        h(
          "select",
          mergeProps(attrs, {
            class: ["fluent-select__control", attrs.class],
            value: props.modelValue,
            disabled: props.disabled,
            onChange: (event: Event) => {
              const nextValue = inputValue(event);
              emit("update:modelValue", nextValue);
              emit("change", nextValue);
            },
          }),
          props.options.map((option) =>
            h(
              "option",
              { value: option.value, disabled: option.disabled },
              option.label,
            ),
          ),
        ),
      ]);
  },
});

export const FluentNotice = defineComponent({
  name: "FluentNotice",
  props: {
    tone: { type: String as PropType<FluentNoticeTone>, default: "info" },
  },
  setup(props, { slots }) {
    return () =>
      h(
        "div",
        {
          class: ["fluent-notice", `fluent-notice--${props.tone}`],
          role: props.tone === "danger" ? "alert" : "status",
          "aria-live": props.tone === "danger" ? "assertive" : "polite",
        },
        slots.default?.(),
      );
  },
});
