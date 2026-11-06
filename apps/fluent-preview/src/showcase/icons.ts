import { h } from "vue";

const stroke = (d: string, extra: ReturnType<typeof h>[] = []) => () => h("svg", {
  class: "showcase-glyph", viewBox: "0 0 20 20", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "aria-hidden": "true",
}, [h("path", { d }), ...extra]);

export const menuGlyph = stroke("M3 5h14M3 10h14M3 15h14");
export const closeGlyph = stroke("M5 5l10 10M15 5L5 15");
export const tuneGlyph = () => h("svg", {
  class: "showcase-glyph", viewBox: "0 0 20 20", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "aria-hidden": "true",
}, [
  h("path", { d: "M3 5h14M3 10h14M3 15h14" }),
  ...[[7, 5], [13, 10], [9, 15]].map(([cx, cy]) => h("circle", { cx, cy, r: 2.2, fill: "currentColor", stroke: "none" })),
]);
export const arrowGlyph = stroke("M4 10h12M11 5l5 5-5 5");
