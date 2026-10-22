import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await copyFile(here("src/liquid-glass.css"), here("dist/liquid-glass.css"));
await build({
  entryPoints: [here("src/browser.ts")],
  outfile: here("dist/liquid-glass.browser.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  banner: { js: "/* @platform-kit/liquid-glass | Apache-2.0; rim lens adapted from Shu Ding's Liquid Glass (MIT) */" },
});
