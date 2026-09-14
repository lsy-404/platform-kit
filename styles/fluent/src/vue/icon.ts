import { h, type VNode, type VNodeChild } from "vue";

export type FluentIconName = "check" | "chevron-down" | "chevron-up" | "upload";

export function fluentIcon(name: FluentIconName, className?: string): VNode {
  let children: VNodeChild[];
  switch (name) {
    case "check":
      children = [h("path", { d: "m5 12 4 4L19 6" })];
      break;
    case "chevron-down":
      children = [h("path", { d: "m6 9 6 6 6-6" })];
      break;
    case "chevron-up":
      children = [h("path", { d: "m6 15 6-6 6 6" })];
      break;
    case "upload":
      children = [h("path", { d: "M12 16V4m0 0-4 4m4-4 4 4M5 14v4h14v-4" })];
      break;
  }

  return h("svg", {
    class: ["fluent-icon", className],
    "data-icon": name,
    "aria-hidden": "true",
    xmlns: "http://www.w3.org/2000/svg",
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    focusable: "false",
  }, children);
}
