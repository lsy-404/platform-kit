import type { ObjectDirective } from "vue";
import { attachLiquidGlass, detachLiquidGlass } from "./lens.js";

/** `v-liquid-glass` (or `v-liquid-glass="condition"`): refract the page behind the element's rim. */
export const vLiquidGlass: ObjectDirective<HTMLElement, boolean | undefined> = {
  mounted(el, { value }) { if (value !== false) attachLiquidGlass(el); },
  updated(el, { value }) { if (value === false) detachLiquidGlass(el); else attachLiquidGlass(el); },
  beforeUnmount(el) { detachLiquidGlass(el); },
};
