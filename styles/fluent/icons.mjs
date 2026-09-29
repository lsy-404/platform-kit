import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const source = join(dirname(createRequire(import.meta.url).resolve("@fluentui/svg-icons/package.json")), "icons");
const icons = { "check": "checkmark", "chevron-down": "chevron_down", "chevron-up": "chevron_up", "upload": "arrow_upload" };
const data = {};
for (const [name, file] of Object.entries(icons)) {
  const svg = await readFile(join(source, `${file}_16_regular.svg`), "utf8");
  data[name] = [...svg.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
}
const body = Object.entries(data).map(([name, paths]) => `  ${JSON.stringify(name)}: ${JSON.stringify(paths)},`).join("\n");
await writeFile(new URL("src/vue/icon-data.ts", import.meta.url), `export const iconData = {\n${body}\n} as const;\n`);
