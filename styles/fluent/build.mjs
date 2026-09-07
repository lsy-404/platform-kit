import { readFile, writeFile } from "node:fs/promises";
const names = ["tokens", "controls", "overlays", "navigation"];
const sheets = await Promise.all(names.map(name => readFile(new URL(`src/styles/${name}.css`, import.meta.url), "utf8")));
await writeFile(new URL("dist/style.css", import.meta.url), sheets.join("\n"));
