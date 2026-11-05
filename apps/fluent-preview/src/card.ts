import { h, type VNode } from "vue";

export const card = (id: string, title: string, note: string | null, children: (VNode | VNode[])[], wide = false) => h("section", { class: ["catalog-card", { "pref-wide": wide }], id, "aria-labelledby": `${id}-title` }, [
  h("h3", { id: `${id}-title` }, title),
  note ? h("p", { class: "pref-note" }, note) : null,
  ...children,
]);
