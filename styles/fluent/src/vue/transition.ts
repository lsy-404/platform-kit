import { defineComponent, h, nextTick, ref, watch, type Directive, type PropType } from "vue";
import { fluentViewTransition } from "../behavior/viewTransition.js";
import type { FluentViewDirection, FluentViewTransitionOptions } from "../behavior/viewTransition.js";
import type { FluentPageTransition } from "../theme.js";

export { fluentViewTransition };
export type { FluentViewDirection, FluentViewTransitionOptions };

export const FluentTransitionView = defineComponent({
  name: "FluentTransitionView",
  props: {
    viewKey: { type: [String, Number] as PropType<string | number>, required: true },
    transition: String as PropType<FluentPageTransition>,
    direction: String as PropType<FluentViewDirection>,
    order: Array as PropType<readonly (string | number)[]>,
  },
  setup(props, { slots }) {
    const shown = ref(props.viewKey);
    const root = ref<HTMLElement | null>(null);
    let last = props.viewKey;
    let runs = 0;

    function direction(from: string | number, to: string | number): FluentViewDirection {
      if (props.direction) return props.direction;
      const a = props.order?.indexOf(from) ?? -1;
      const b = props.order?.indexOf(to) ?? -1;
      return a >= 0 && b >= 0 && b < a ? "back" : "forward";
    }

    async function run(from: string | number, to: string | number) {
      const el = root.value;
      const id = ++runs;
      el?.style.setProperty("view-transition-name", "fluent-view");
      await fluentViewTransition(
        async () => {
          shown.value = last;
          await nextTick();
        },
        {
          element: el,
          transition: props.transition,
          direction: direction(from, to),
          onFinish: () => { if (id === runs) el?.style.removeProperty("view-transition-name"); },
        },
      );
    }

    watch(() => props.viewKey, key => {
      const previous = last;
      last = key;
      void run(previous, key);
    });

    return () => {
      return h(
        "div",
        { class: "fluent-transition-view", ref: root, "data-fluent-page-transition": props.transition },
        slots.default?.({ viewKey: shown.value }),
      );
    };
  },
});

/** The name must be unique within each view; an empty value clears it. */
export const vFluentShared: Directive<HTMLElement, string | null | undefined> = {
  mounted: (el, { value }) => { el.style.viewTransitionName = value || ""; },
  updated: (el, { value }) => { el.style.viewTransitionName = value || ""; },
  unmounted: el => { el.style.viewTransitionName = ""; },
};
