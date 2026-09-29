import { h, type VNode } from "vue";
import { iconData } from "./icon-data.js";

export type FluentIconName = keyof typeof iconData;

export function fluentIcon(name: FluentIconName, className?: string): VNode {
  return h("svg", {
    class: ["fluent-icon", className],
    "data-icon": name,
    "aria-hidden": "true",
    xmlns: "http://www.w3.org/2000/svg",
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "currentColor",
    focusable: "false",
  }, iconData[name].map(d => h("path", { d })));
}
