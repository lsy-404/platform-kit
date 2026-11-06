import { defineComponent, h, onMounted, ref } from "vue";

// Every page shares one scrolling view, so a newly shown page starts at its top.
export const PageFrame = defineComponent({
  name: "PageFrame",
  props: { title: { type: String, required: true }, lead: String },
  setup(props, { slots }) {
    const root = ref<HTMLElement | null>(null);
    onMounted(() => { if (root.value?.parentElement) root.value.parentElement.scrollTop = 0; });
    return () => h("article", { ref: root, class: "showcase-page" }, [
      h("header", { class: "showcase-page__header" }, [
        h("h2", { class: "showcase-page__title" }, props.title),
        props.lead ? h("p", { class: "showcase-page__lead" }, props.lead) : null,
      ]),
      slots.default?.(),
    ]);
  },
});
