import { defineComponent, h, onMounted, ref, type VNode } from "vue";
import { pageLabel, pageSection, type PageKey } from "./state.js";

// Every page shares one scrolling view, so a newly shown page starts at its top.
export const PageFrame = defineComponent({
  name: "PageFrame",
  props: { title: { type: String, required: true }, section: String, lead: String },
  setup(props, { slots }) {
    const root = ref<HTMLElement | null>(null);
    onMounted(() => { if (root.value?.parentElement) root.value.parentElement.scrollTop = 0; });
    return () => h("article", { ref: root, class: "showcase-page" }, [
      h("header", { class: "showcase-page__header" }, [
        props.section ? h("p", { class: "showcase-page__section" }, props.section) : null,
        h("h2", { class: "showcase-page__title" }, props.title),
        props.lead ? h("p", { class: "showcase-page__lead" }, props.lead) : null,
      ]),
      slots.default?.(),
    ]);
  },
});

export const pageFrame = (key: PageKey, lead: string, children: () => (VNode | null)[]) =>
  h(PageFrame, { title: pageLabel(key), section: pageSection(key), lead }, children);
