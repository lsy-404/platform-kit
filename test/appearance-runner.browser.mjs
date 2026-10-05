import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditAppearance, checks } from "../tooling/appearance-check/dist/index.js";

const html = `<!doctype html><style>
 body {margin:20px;color:#111;background:#fff}
 .outer {width:240px;height:140px;padding:4px;box-sizing:border-box;border-radius:24px;background:#123}
 .inner {height:100%;background:#eee;border-radius:24px}
 button{background:#123;color:#fff;border:0;padding:10px}
 button:hover, button:focus-visible {color:#123;background:#123}
 </style><section class="outer"><div id="inner" class="inner">Surface</div></section><button id="control">Action</button>`;
const server = createServer((request, response) => {
  if (request.url === "/api-missing") { response.writeHead(501); response.end("Unavailable fixture"); return; }
  response.setHeader("Content-Type", "text/html");
  response.end(html + (request.url === "/broken" ? '<script>fetch("/api-missing")</script>' : ""));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const dir = await mkdtemp(join(tmpdir(), "appearance-runner-"));
const cli = "tooling/appearance-check/dist/cli.js";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const options = { urls: [url + "/bad"], checks: ["AP002", "AP003"], viewports: [{ width: 800, height: 600 }], executablePath };
const run = (args) => promisify(execFile)(process.execPath, [cli, ...args], { timeout: 60000 }).catch(error => error);
try {
  assert.deepEqual(checks.map(c => c.id), ["AP001", "AP002", "AP003", "AP004", "AP005", "AP006", "AP007", "AP008"]);
  const report = await auditAppearance(options);
  assert(report.findings.some(f => f.checkId === "AP003" && f.target === "#inner"));
  assert(report.findings.some(f => f.checkId === "AP002" && f.state === "hover"));
  assert(report.findings.some(f => f.checkId === "AP002" && f.state === "focus"));
  const ignores = [{ checkId: "AP003", page: "/bad", selector: "#inner", reason: "Known geometry" }, { checkId: "AP002", page: "/bad", state: "hover", reason: "Known hover" }];
  const suppressed = await auditAppearance({ ...options, urls: [url + "/bad", url + "/other"], ignores });
  assert(suppressed.suppressed.some(f => f.checkId === "AP003" && f.reason === "Known geometry"));
  assert(suppressed.findings.some(f => f.checkId === "AP003" && f.page.endsWith("/other")));
  assert(suppressed.findings.some(f => f.checkId === "AP002" && f.state === "focus" && f.page.endsWith("/bad")));
  assert(!suppressed.findings.some(f => f.checkId === "AP002" && f.state === "hover" && f.page.endsWith("/bad")));
  const hashRoute = await auditAppearance({ ...options, urls: [url + "/#/settings"], checks: ["AP003"], ignores: [{ checkId: "AP003", page: "/settings", reason: "Hash route exception" }] });
  assert.equal(hashRoute.findings.length, 0);
  assert.equal(hashRoute.suppressed.length, 1);
  const incompleteResponse = await auditAppearance({ ...options, urls: [url + "/broken"], checks: ["AP003"] });
  assert(incompleteResponse.coverage.some(g => g.reason.startsWith("HTTP 501:")));
  const config = join(dir, "config.json");
  await writeFile(config, JSON.stringify({ ...options, checks: ["AP003"] }));
  const result = await run(["--config", config, "--json"]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).findings[0].checkId, "AP003");
  const disabled = await run(["--config", config, "--ignore-check", "AP003", "--json"]);
  assert.equal(JSON.parse(disabled.stdout).findings.length, 0);
  assert.equal(disabled.code, undefined);
  const invalid = await run(["--checks", "AP999", "--url", url]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Unknown check ID/);
  const warn = await run(["--config", config, "--warn-only"]);
  assert.equal(warn.code, undefined);
  assert.match(warn.stdout, /\[AP003\]/);
  const unavailable = await auditAppearance({ ...options, urls: ["http://127.0.0.1:1"], checks: ["AP003"], timeoutMs: 1000 });
  assert.equal(unavailable.pages.length, 0);
  assert(unavailable.coverage.length > 0);
  await assert.rejects(() => auditAppearance({ ...options, checks: ["AP999"] }), /Unknown check ID/);
  await assert.rejects(() => auditAppearance({ ...options, ignores: [{ checkId: "AP003", reason: "" }] }), /reason/);
  console.log("Appearance IDs, state discovery, CLI exits and scoped suppressions passed.");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
