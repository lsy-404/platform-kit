import { computed, defineComponent, h, mergeProps, onBeforeUnmount, ref, watch, type PropType } from "vue";

const GAUGE_ARC = "M 20.3 79.7 A 42 42 0 1 1 79.7 79.7";

function countDuration(element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const scale = Number.parseFloat(getComputedStyle(element).getPropertyValue("--fluent-motion-scale"));
  return Number.isFinite(scale) && scale > 0 ? 250 * scale : 0;
}

export const FluentGauge = defineComponent({
  name: "FluentGauge",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    label: { type: String, required: true },
    formatValue: Function as PropType<(value: number) => string>,
    caption: String,
    size: { type: Number, default: 120 },
  },
  setup(props, { attrs }) {
    const upper = computed(() => (props.max > props.min ? props.max : props.min + 100));
    const target = computed(() => (Number.isFinite(props.value) ? Math.min(upper.value, Math.max(props.min, props.value)) : props.min));
    const fraction = computed(() => (target.value - props.min) / (upper.value - props.min));
    const shown = ref(target.value);
    const rootRef = ref<HTMLElement | null>(null);
    let frame = 0;
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    watch(target, (to) => {
      stop();
      const from = shown.value;
      const duration = typeof requestAnimationFrame === "function" ? countDuration(rootRef.value) : 0;
      if (!duration || from === to) { shown.value = to; return; }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        shown.value = from + (to - from) * (1 - (1 - t) ** 3);
        frame = t < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    });
    onBeforeUnmount(stop);
    const format = (value: number) => (props.formatValue ? props.formatValue(value) : Math.round(value).toString());
    return () => {
      const { class: className, style, ...rest } = attrs;
      const valueText = props.caption ? `${format(target.value)} ${props.caption}` : format(target.value);
      return h("div", mergeProps(rest, {
        ref: rootRef,
        class: ["fluent-gauge", className],
        style: [{ "--fluent-gauge-size": `${props.size}px` }, style as never],
        role: "meter",
        "aria-label": props.label,
        "aria-valuemin": props.min,
        "aria-valuemax": upper.value,
        "aria-valuenow": target.value,
        "aria-valuetext": valueText,
      }), [
        h("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" }, [
          h("path", { class: "fluent-gauge__track", d: GAUGE_ARC, pathLength: 100 }),
          h("path", {
            class: "fluent-gauge__value",
            d: GAUGE_ARC,
            pathLength: 100,
            style: { strokeDasharray: "100 100", strokeDashoffset: 100 - fraction.value * 100 },
            hidden: fraction.value <= 0 ? true : undefined,
          }),
        ]),
        h("div", { class: "fluent-gauge__content" }, [
          h("span", { class: "fluent-gauge__number" }, format(shown.value)),
          props.caption ? h("span", { class: "fluent-gauge__caption" }, props.caption) : null,
        ]),
      ]);
    };
  },
});
