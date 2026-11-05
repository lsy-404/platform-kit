import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
const names = ["tokens", "controls", "graphics", "overlays", "navigation", "selection", "segmented", "native", "transitions"];
const sheets = await Promise.all(names.map(name => readFile(new URL(`src/styles/${name}.css`, import.meta.url), "utf8")));
await writeFile(new URL("dist/style.css", import.meta.url), sheets.join("\n"));

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
await build({entryPoints:[path("src/behavior/popover.ts")],outfile:path("dist/behavior/popover.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,legalComments:"none"});

await build({entryPoints:[path("src/behavior/visual-center.ts")],outfile:path("dist/behavior/visual-center.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,legalComments:"none"});
const declarations = dirname(fileURLToPath(import.meta.resolve("@platform-kit/visual-center/browser")));
const destination = new URL("dist/behavior/visual-center-types/", import.meta.url);
await mkdir(destination,{recursive:true});
for (const file of ["index.d.ts","browser.d.ts"]) await copyFile(join(declarations,file),new URL(file,destination));
await writeFile(new URL("dist/behavior/visual-center.d.ts", import.meta.url),'export { measureSvg, prepareSvg } from "./visual-center-types/browser.js";\nexport type { SvgMeasurement, SvgOptions } from "./visual-center-types/browser.js";\n');
