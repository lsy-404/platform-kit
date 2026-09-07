import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const outputs = join(root, "test/fluent/.output");
await mkdir(outputs, { recursive: true });
const run = await mkdtemp(join(outputs, "package-"));
execFileSync("corepack", ["pnpm@10.17.1", "pack", "--pack-destination", run], {
  cwd: join(root, "styles/fluent"),
  stdio: "pipe",
});
const { readdir } = await import("node:fs/promises");
const archive = (await readdir(run)).find((name) => name.endsWith(".tgz"));
assert(archive, "package archive exists");
const contents = execFileSync("tar", ["-tzf", join(run, archive)], {
  encoding: "utf8",
});
assert(!/(?:^|\/)agents\//m.test(contents));
assert(!/(?:^|\/)node_modules\//m.test(contents));
assert(contents.includes("package/dist/style.css"));
assert(contents.includes("package/dist/vue/index.d.ts"));
assert(contents.includes("package/LICENSE"));
assert(contents.includes("package/NOTICE"));
assert(!contents.includes("package/licenses/"));
const target = join(run, "node_modules/@platform-kit/fluent");
await mkdir(target, { recursive: true });
execFileSync("tar", [
  "-xzf",
  join(run, archive),
  "--strip-components=1",
  "-C",
  target,
]);
await symlink(
  join(root, "node_modules/vue"),
  join(run, "node_modules/vue"),
  "dir",
);
const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
assert.equal(pkg.license, "Apache-2.0");
assert.equal(pkg.private, true);
await writeFile(
  join(run, "consumer.mjs"),
  `
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import * as suite from '@platform-kit/fluent/vue';
for (const name of ['FluentTheme','FluentButton','FluentField','FluentSwitch','FluentSlider','FluentSelect','FluentNotice','FluentDialog','FluentPopover','FluentNavigation']) assert(suite[name], name);
const app = createSSRApp({render:()=>h(suite.FluentTheme,{mode:'dark'},()=>h(suite.FluentButton,{disabled:true,type:'submit'},()=> 'Save'))});
const html = await renderToString(app);
assert(html.includes('data-fluent-theme="dark"'));
assert(html.includes('type="submit"'));
assert(html.includes('disabled'));
const css = await readFile(new URL(import.meta.resolve('@platform-kit/fluent/style.css')), 'utf8');
assert(css.includes('.fluent-navigation'));
assert(css.includes('.fluent-dialog'));
assert(css.includes('--fluent-acrylic'));
console.log('Packed Fluent suite: all module exports, CSS, declarations and SSR passed.');
`,
);
execFileSync(process.execPath, [join(run, "consumer.mjs")], {
  cwd: run,
  stdio: "inherit",
});
console.log(`Release archive verified: ${join(run, archive)}`);
