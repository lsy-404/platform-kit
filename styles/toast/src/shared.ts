import { createToastStore } from "./core.js";

/** App-wide store for call sites outside components; hosts use it by default. */
export const toast = createToastStore();
