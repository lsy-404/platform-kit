import * as core from "./index.js";
import { mountToastHost } from "./dom.js";

/** Single-file build for pages without a bundler: `window.PlatformKitToast`. */
const api = { ...core, mountToastHost };
(globalThis as typeof globalThis & { PlatformKitToast?: typeof api }).PlatformKitToast = api;
