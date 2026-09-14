import { defineComponent, h, mergeProps, ref, type PropType } from "vue";
import { fluentIcon } from "./icon.js";

export type FluentButtonTone = "primary" | "secondary" | "danger" | "subtle";
export type FluentNoticeTone = "info" | "success" | "warning" | "danger";

export interface FluentSelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface FluentFile {
  readonly name: string;
  readonly size?: number;
  readonly type?: string;
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

let nextFilePickerId = 1;

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
    toggle: Boolean,
    pressed: Boolean,
    iconOnly: Boolean,
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
          "aria-pressed": props.toggle ? String(props.pressed) : undefined,
          "data-icon-only": props.iconOnly || undefined,
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.(),
      );
  },
});

export const FluentToggleButton = defineComponent({
  name: "FluentToggleButton",
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    tone: { type: String as PropType<FluentButtonTone>, default: "secondary" },
    disabled: Boolean,
    iconOnly: Boolean,
  },
  emits: ["update:modelValue", "change", "click"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h("button", {
        ...attrs,
        type: "button",
        class: ["fluent-button", "fluent-toggle-button", `fluent-button--${props.tone}`, attrs.class],
        disabled: props.disabled,
        "aria-pressed": String(props.modelValue),
        "data-icon-only": props.iconOnly || undefined,
        onClick: (event: MouseEvent) => {
          if (props.disabled) return;
          const nextValue = !props.modelValue;
          emit("update:modelValue", nextValue);
          emit("change", nextValue);
          emit("click", event);
        },
      }, slots.default?.());
  },
});

export const FluentField = defineComponent({
  name: "FluentField",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    label: { type: String, required: true },
    disabled: Boolean,
    readonly: Boolean,
    invalid: Boolean,
    multiline: Boolean,
    placeholder: String,
    type: { type: String, default: "text" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", { class: "fluent-field" }, [
        h("span", { class: "fluent-field__label" }, props.label),
        h(
          props.multiline ? "textarea" : "input",
          mergeProps(attrs, {
            class: ["fluent-field__input", attrs.class],
            type: props.multiline ? undefined : props.type,
            value: props.modelValue,
            disabled: props.disabled,
            readonly: props.readonly,
            placeholder: props.placeholder,
            "aria-invalid": props.invalid || undefined,
            "data-invalid": props.invalid || undefined,
            onInput: (event: Event) =>
              emit("update:modelValue", inputValue(event)),
          }),
        ),
      ]);
  },
});

function stringFieldVariant(name: string, type: "password" | "text", multiline = false) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      modelValue: { type: String, default: "" },
      label: { type: String, required: true },
      disabled: Boolean,
      readonly: Boolean,
      invalid: Boolean,
      placeholder: String,
    },
    emits: ["update:modelValue"],
    setup(props, { attrs, emit }) {
      return () => h(FluentField as any, mergeProps(attrs, {
        ...props,
        type,
        multiline,
        "onUpdate:modelValue": (value: string) => emit("update:modelValue", value),
      }));
    },
  });
}

export const FluentTextArea = stringFieldVariant("FluentTextArea", "text", true);
export const FluentPasswordField = stringFieldVariant("FluentPasswordField", "password");

export const FluentNumberField = defineComponent({
  name: "FluentNumberField",
  inheritAttrs: false,
  props: {
    modelValue: { type: Number as PropType<number | null>, default: null },
    label: { type: String, required: true },
    disabled: Boolean,
    readonly: Boolean,
    invalid: Boolean,
    placeholder: String,
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () => h(FluentField as any, mergeProps(attrs, {
      ...props,
      type: "number",
      modelValue: props.modelValue === null ? "" : String(props.modelValue),
      "onUpdate:modelValue": (value: string) => emit("update:modelValue", value === "" ? null : Number(value)),
    }));
  },
});

export const FluentFilePicker = defineComponent({
  name: "FluentFilePicker",
  inheritAttrs: false,
  props: {
    modelValue: { type: Array as PropType<readonly FluentFile[]>, default: () => [] },
    label: { type: String, required: true },
    selectLabel: { type: String, default: "Choose files" },
    emptyLabel: { type: String, default: "No files selected" },
    clearLabel: { type: String, default: "Clear" },
    accept: String,
    multiple: Boolean,
    disabled: Boolean,
    required: Boolean,
    name: String,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    const input = ref<HTMLInputElement | null>(null);
    const inputId = `${typeof attrs.id === "string" ? attrs.id : `fluent-file-picker-${nextFilePickerId++}`}-input`;
    const statusId = inputId ? `${inputId}-status` : undefined;
    const open = () => {
      if (!props.disabled) input.value?.click();
    };
    const updateFiles = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const files = Array.from(target.files ?? []);
      emit("update:modelValue", files);
      emit("change", files);
      target.value = "";
    };
    const clear = () => {
      emit("update:modelValue", []);
      emit("change", []);
      if (input.value) input.value.value = "";
    };
    return () => {
      const { class: className, style, id, ...rootAttrs } = attrs;
      const files = props.modelValue ?? [];
      return h("div", {
        ...rootAttrs,
        id,
        class: ["fluent-file-picker", className],
        style,
      }, [
        h("span", { class: "fluent-file-picker__label" }, props.label),
        h("div", { class: "fluent-file-picker__actions" }, [
          h("input", {
            ref: input,
            id: inputId,
            class: "fluent-file-picker__input",
            type: "file",
            accept: props.accept,
            multiple: props.multiple,
            disabled: props.disabled,
            required: props.required,
            name: props.name,
            tabindex: -1,
            "aria-hidden": "true",
            "aria-describedby": statusId,
            onChange: updateFiles,
          }),
          h("button", {
            type: "button",
            class: "fluent-button fluent-file-picker__button",
            disabled: props.disabled,
            "aria-label": props.selectLabel,
            "aria-describedby": statusId,
            onClick: open,
          }, [fluentIcon("upload", "fluent-file-picker__icon"), h("span", props.selectLabel)]),
          files.length
            ? h("button", {
              type: "button",
              class: "fluent-button fluent-button--subtle fluent-file-picker__clear",
              disabled: props.disabled,
              onClick: clear,
            }, props.clearLabel)
            : null,
        ]),
        files.length
          ? h("ul", { id: statusId, class: "fluent-file-picker__list", "aria-label": props.label }, files.map((file, index) =>
            h("li", { key: `${file.name}-${index}`, class: "fluent-file-picker__file" }, file.name),
          ))
          : h("p", { id: statusId, class: "fluent-file-picker__status" }, props.emptyLabel),
      ]);
    };
  },
});

export const FluentSwitch = defineComponent({
  name: "FluentSwitch",
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    label: String,
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
          props.label ? h("span", { class: "fluent-switch__label" }, props.label) : null,
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
    label: String,
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", { class: "fluent-slider" }, [
        props.label ? h("span", { class: "fluent-slider__header" }, [
          h("span", { class: "fluent-slider__label" }, props.label),
          h(
            "output",
            { class: "fluent-slider__value" },
            `${sliderPercentage(props.modelValue, props.min, props.max).toFixed(0)}%`,
          ),
        ]) : null,
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
            "aria-label": attrs["aria-label"] ?? props.label,
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
