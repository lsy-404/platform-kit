import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { appearanceCheck } from "../tooling/appearance-check/dist/vite.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { build, createLogger } = await import(require.resolve("vite"));
const root = await realpath(await mkdtemp(join(tmpdir(), "appearance-build-")));
await writeFile(join(root, "index.html"), `<!doctype html><div style="width:200px;height:150px;padding:4px;border-radius:24px;background:#123"><div id="inner" style="height:100%;border-radius:24px;background:#eee">Surface</div></div><script type="module" src="/main.js"></script>`);
await writeFile(join(root, "main.js"), "document.title = 'Build fixture';");
const warnings = [];
const logger = createLogger("silent");
logger.warn = message => warnings.push(message);
const config = { root, configFile: false, base: "/nested/", customLogger: logger, build: { outDir: "dist", manifest: true } };
async function files(directory) {
  const map = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else map[relative(directory, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
    }
  }
  await walk(directory);
  return map;
}
try {
  await build(config);
  const baseline = await files(join(root, "dist"));
  let report;
  await build({ ...config, plugins: [appearanceCheck({ checks: ["AP003"], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, viewports: [{ width: 800, height: 600 }], onReport(value) { report = value; } })] });
  assert(report.findings.some(f => f.checkId === "AP003" && f.target === "#inner"));
  assert(warnings.some(message => message.includes("[AP003]")));
  assert.deepEqual(await files(join(root, "dist")), baseline, "Every production asset must remain byte-identical");
  assert.equal(report.coverage.length, 0);
  warnings.length = 0;
  await build({ ...config, plugins: [appearanceCheck({ checks: ["AP003"], executablePath: "/missing-browser" })] });
  assert(warnings.some(message => message.includes("incomplete")));
  assert.deepEqual(await files(join(root, "dist")), baseline);
  assert.equal(appearanceCheck().apply, "build");
  console.log("Build warnings, nested base, browser failure and byte-identical output passed.");
} finally { await rm(root, { recursive: true, force: true }); }
