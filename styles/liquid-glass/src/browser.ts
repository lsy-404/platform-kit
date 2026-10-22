import * as api from "./index.js";

/** Single-file build for pages without a bundler: `window.PlatformKitLiquidGlass`. */
(globalThis as typeof globalThis & { PlatformKitLiquidGlass?: typeof api }).PlatformKitLiquidGlass = api;
