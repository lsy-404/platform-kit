import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await copyFile(here("src/toast.css"), here("dist/toast.css"));
await build({
  entryPoints: [here("src/browser.ts")],
  outfile: here("dist/toast.browser.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  banner: { js: "/* @platform-kit/toast | Apache-2.0 */" },
});
