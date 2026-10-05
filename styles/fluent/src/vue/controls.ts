import { computed, defineComponent, h, mergeProps, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { fluentIcon } from "./icon.js";

export type FluentButtonTone = "primary" | "secondary" | "danger" | "subtle";
export type FluentNoticeTone = "info" | "success" | "warning" | "danger";
export type FluentSliderSnap = "none" | "integer" | "available";
export type FluentSliderOrientation = "horizontal" | "vertical";
export type FluentSliderTickPlacement = "start" | "end" | "outside";
export type FluentSliderTone = "accent" | "neutral";

export interface FluentSliderStop {
  readonly value: number;
  readonly label?: string;
  readonly disabled?: boolean;
}

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

function sliderAvailableValues(values: readonly number[] | undefined, min: number, max: number): number[] {
  return [...new Set((values ?? []).filter((value) => Number.isFinite(value) && value >= min && value <= max))]
    .sort((a, b) => a - b);
}

function sliderValue(value: number, min: number, max: number, snap: FluentSliderSnap | undefined, available: readonly number[]): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  const bounded = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  if (snap === "available" && available.length) {
    return available.reduce((closest, candidate) =>
      Math.abs(candidate - bounded) < Math.abs(closest - bounded) ? candidate : closest,
    );
  }
  if (snap === "integer" && Math.ceil(min) <= Math.floor(max)) {
    return Math.min(Math.floor(max), Math.max(Math.ceil(min), Math.round(bounded)));
  }
  return bounded;
}

function sliderTicks(min: number, max: number, frequency: number | undefined, available: readonly number[]): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const ticks = [...available];
  if (typeof frequency === "number" && Number.isFinite(frequency) && frequency > 0) {
    const count = Math.floor((max - min) / frequency);
    if (!Number.isFinite(count)) return [...new Set(ticks)];
    const stride = Math.max(1, Math.ceil(count / 100));
    for (let index = 0; index <= count; index += stride) {
      ticks.push(Number((min + index * frequency).toPrecision(12)));
    }
    ticks.push(max);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
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
    step: Number,
    tickFrequency: Number,
    majorTickFrequency: Number,
    availableValues: { type: Array as PropType<readonly number[]>, default: () => [] },
    stops: Array as PropType<readonly FluentSliderStop[]>,
    tone: { type: String as PropType<FluentSliderTone>, default: "accent" },
    snap: String as PropType<FluentSliderSnap>,
    orientation: { type: String as PropType<FluentSliderOrientation>, default: "horizontal" },
    tickPlacement: { type: String as PropType<FluentSliderTickPlacement>, default: "outside" },
    formatValue: Function as PropType<(value: number) => string>,
    label: String,
    disabled: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { attrs, emit }) {
    const snapMode = (): FluentSliderSnap | undefined => props.snap ?? (props.stops?.length ? "available" : undefined);
    const enabledValues = () => sliderAvailableValues(
      props.stops ? props.stops.filter((stop) => !stop.disabled).map((stop) => stop.value) : props.availableValues,
      props.min, props.max,
    );
    const stopValues = () => sliderAvailableValues(props.stops?.map((stop) => stop.value) ?? props.availableValues, props.min, props.max);
    const targetValue = computed(() => sliderValue(props.modelValue, props.min, props.max, snapMode(), enabledValues()));
    const shown = ref(targetValue.value);
    const dragging = ref(false);
    let frame = 0;
    const stopAnimation = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    watch(targetValue, (to, from) => {
      stopAnimation();
      const animate = !dragging.value && typeof requestAnimationFrame === "function"
        && !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (!animate) { shown.value = to; return; }
      const start = performance.now();
      const duration = 180;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        shown.value = from + (to - from) * (1 - (1 - t) ** 3);
        frame = t < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    });
    onBeforeUnmount(stopAnimation);
    const updateFromInput = (event: Event, final = false) => {
      const input = event.target as HTMLInputElement;
      const available = enabledValues();
      const next = sliderValue(Number(input.value), props.min, props.max, snapMode(), available);
      input.value = String(next);
      emit(final ? "change" : "update:modelValue", next);
    };
    const onKeydown = (event: KeyboardEvent) => {
      const available = enabledValues();
      const snap = snapMode();
      if (props.disabled || !snap || snap === "none" || (snap === "available" && !available.length)) return;
      const values = snap === "available" ? available : [];
      const first = snap === "available" ? values[0] : Math.ceil(props.min);
      const last = snap === "available" ? values.at(-1) : Math.floor(props.max);
      if (first === undefined || last === undefined || !Number.isFinite(first) || !Number.isFinite(last) || first > last) return;
      const input = event.target as HTMLInputElement;
      const current = sliderValue(Number(input.value), props.min, props.max, snap, available);
      const rtl = getComputedStyle(input).direction === "rtl";
      const direction = event.key === "ArrowUp" || event.key === "PageUp" || event.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1
        : event.key === "ArrowDown" || event.key === "PageDown" || event.key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : 0;
      let next: number | undefined;
      if (event.key === "Home") next = first;
      else if (event.key === "End") next = last;
      else if (direction) {
        const distance = event.key === "PageUp" || event.key === "PageDown" ? 10 : 1;
        if (snap === "available") {
          const index = values.indexOf(current);
          next = values[Math.min(values.length - 1, Math.max(0, index + direction * distance))];
        } else next = Math.min(last, Math.max(first, current + direction * distance));
      }
      if (next === undefined) return;
      event.preventDefault();
      if (next === current) return;
      input.value = String(next);
      emit("update:modelValue", next);
      emit("change", next);
    };
    return () => {
      const available = stopValues();
      const value = shown.value;
      const disabledStops = new Set(props.stops?.filter((stop) => stop.disabled).map((stop) => stop.value));
      const labelled = (props.stops ?? []).filter((stop) => stop.label !== undefined && stop.value >= props.min && stop.value <= props.max);
      const majorTicks = sliderTicks(props.min, props.max, props.majorTickFrequency, []);
      const ticks = sliderTicks(props.min, props.max, props.tickFrequency, [...available, ...majorTicks]);
      const majorValues = new Set(majorTicks);
      const hasStartTicks = ticks.length > 0 && props.tickPlacement !== "end";
      const hasEndTicks = ticks.length > 0 && props.tickPlacement !== "start";
      const markPosition = (mark: number) => props.orientation === "vertical"
        ? { bottom: `${sliderPercentage(mark, props.min, props.max)}%` }
        : { insetInlineStart: `${sliderPercentage(mark, props.min, props.max)}%` };
      const renderTicks = (side: "start" | "end") => h("span", {
        class: ["fluent-slider__ticks", `fluent-slider__ticks--${side}`], "aria-hidden": "true",
      }, ticks.map((tick) => h("span", {
        key: tick,
        class: ["fluent-slider__tick", {
          "fluent-slider__tick--major": majorValues.has(tick),
          "fluent-slider__tick--disabled": disabledStops.has(tick),
        }],
        "data-value": tick,
        style: markPosition(tick),
      })));
      return h("label", { class: ["fluent-slider", {
        "fluent-slider--disabled": props.disabled,
        "fluent-slider--vertical": props.orientation === "vertical",
        "fluent-slider--neutral": props.tone === "neutral",
        "fluent-slider--labelled": labelled.length > 0,
      }] }, [
        props.label ? h("span", { class: "fluent-slider__header" }, [
          h("span", { class: "fluent-slider__label" }, props.label),
          h(
            "output",
            { class: "fluent-slider__value" },
            props.formatValue?.(targetValue.value) ?? String(targetValue.value),
          ),
        ]) : null,
        h("span", { class: ["fluent-slider__rail", {
          "fluent-slider__rail--marked": ticks.length > 0,
          "fluent-slider__rail--start": hasStartTicks,
          "fluent-slider__rail--end": hasEndTicks,
        }] }, [
          h("input", mergeProps(attrs, {
            class: ["fluent-slider__input", attrs.class],
            type: "range",
            value,
            min: props.min,
            max: props.max,
            step: snapMode() === undefined && typeof props.step === "number" && Number.isFinite(props.step) && props.step > 0
              ? props.step : "any",
            disabled: props.disabled,
            "aria-label": attrs["aria-label"] ?? props.label,
            "aria-orientation": props.orientation === "vertical" ? "vertical" : undefined,
            style: {
              "--fluent-slider-position": `${sliderPercentage(value, props.min, props.max)}%`,
            },
            onPointerdown: () => { dragging.value = true; },
            onPointerup: () => { dragging.value = false; },
            onPointercancel: () => { dragging.value = false; },
            onBlur: () => { dragging.value = false; },
            onInput: (event: Event) => updateFromInput(event),
            onChange: (event: Event) => updateFromInput(event, true),
            onKeydown,
          })),
          hasStartTicks ? renderTicks("start") : null,
          hasEndTicks ? renderTicks("end") : null,
        ]),
        labelled.length ? h("span", { class: "fluent-slider__labels", "aria-hidden": "true" }, labelled.map((stop) => h("span", {
          key: stop.value,
          class: ["fluent-slider__stop-label", {
            "fluent-slider__stop-label--active": stop.value === targetValue.value,
            "fluent-slider__stop-label--disabled": stop.disabled,
          }],
          style: markPosition(stop.value),
        }, stop.label))) : null,
      ]);
    };
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
