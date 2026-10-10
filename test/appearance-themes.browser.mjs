import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditAppearance, validateOptions } from "../tooling/appearance-check/dist/index.js";

let server, url, temporary;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const markup = `<!doctype html><style>
  body { margin:20px; background:white; color:black }
  .outer { width:240px; height:140px; padding:4px; border-radius:24px; background:#123 }
  .inner { height:100%; border-radius:24px; background:#eee }
  .adaptive .inner { border-radius:20px }
  @media (prefers-color-scheme:dark) { .adaptive .inner { border-radius:24px } }
</style>`;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "appearance-themes-"));
  server = createServer((request, response) => {
    if (request.url === "/missing") { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/html");
    const adaptive = request.url === "/adaptive";
    response.end(markup + `<section class="outer ${adaptive ? "adaptive" : ""}"><div class="inner" id="inner">Surface</div></section>` + (request.url === "/coverage" ? '<iframe title="Embedded content" srcdoc="Embedded"></iframe>' : ""));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (temporary) await rm(temporary, { recursive:true, force:true });
});
const options = path => ({ urls:[url + path], checks:["AP003"], viewports:[{width:800,height:600}], executablePath });
const cli = args => promisify(execFile)(process.execPath, ["tooling/appearance-check/dist/cli.js", ...args], {timeout:30000}).catch(error => error);

test("rejects empty or invalid theme selections instead of a clean uninspected report", () => {
  for (const colorSchemes of [[], ["system"], "dark", null]) {
    assert.throws(() => validateOptions({...options("/"), colorSchemes}), /color scheme/i);
  }
  assert.throws(() => validateOptions({...options("/"), ignores:[{colorScheme:"sepia", reason:"Invalid theme"}]}), /color scheme/i);
});

test("identifies the default theme and emulates both requested themes", async () => {
  const defaultReport = await auditAppearance(options("/"));
  assert.deepEqual(defaultReport.pages.map(page => page.colorScheme), ["light"]);
  assert(defaultReport.findings.length > 0);
  assert(defaultReport.findings.every(finding => finding.colorScheme === "light"));
  const report = await auditAppearance({...options("/adaptive"), colorSchemes:["light","dark"]});
  assert.deepEqual(report.pages.map(page => page.colorScheme), ["light","dark"]);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].target, "#inner");
  assert.equal(report.findings[0].colorScheme, "dark");
});

test("scopes ignores by theme and identifies coverage and suppressed findings", async () => {
  const report = await auditAppearance({...options("/coverage"), colorSchemes:["light","dark"], ignores:[{checkId:"AP003", colorScheme:"dark", reason:"Dark surface exception"}]});
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].colorScheme, "light");
  assert.equal(report.suppressed.length, 1);
  assert.equal(report.suppressed[0].colorScheme, "dark");
  assert.equal(report.suppressed[0].reason, "Dark surface exception");
  assert.deepEqual([...new Set(report.coverage.map(gap => gap.colorScheme))], ["light","dark"]);
  assert(report.coverage.every(gap => gap.reason.includes("iframe")));
  const failures = await auditAppearance({...options("/missing"), colorSchemes:["light","dark"]});
  assert.equal(failures.pages.length, 0);
  assert.deepEqual([...new Set(failures.coverage.map(gap => gap.colorScheme))], ["light","dark"]);
});

test("CLI text and JSON identify themes and invalid config exits with an input error", async () => {
  const config = join(temporary, "themes.json");
  await writeFile(config, JSON.stringify({...options("/"), colorSchemes:["light","dark"]}));
  const text = await cli(["--config",config]);
  assert.equal(text.code, 2);
  assert.match(text.stdout, /800x600 light default #inner/);
  assert.match(text.stdout, /800x600 dark default #inner/);
  const json = await cli(["--config",config,"--color-scheme","dark","--json"]);
  assert.equal(json.code, 2);
  assert.deepEqual(JSON.parse(json.stdout).pages.map(page => page.colorScheme), ["dark"]);
  await writeFile(config, JSON.stringify({...options("/"), colorSchemes:[]}));
  const invalid = await cli(["--config",config,"--warn-only"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /color scheme/i);
});
