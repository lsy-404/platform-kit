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
  if (request.url === "/missing.woff2") { response.writeHead(404); response.end("Not found"); return; }
  if (request.url === "/nf") { response.writeHead(404, { "Content-Type": "text/html" }); response.end("<p>Not found</p>"); return; }
  if (request.url === "/missing.css") { response.writeHead(404); response.end("Not found"); return; }
  response.setHeader("Content-Type", "text/html");
  if (request.url === "/wide") { response.end('<!doctype html><body style="margin:0"><div id="wide" style="width:600px;font:16px Arial">wide text</div>'); return; }
  if (request.url === "/motion") { response.end('<!doctype html><style>@keyframes slide{to{transform:translateX(100px)}}</style><div id="mover" style="width:50px;height:20px;background:#357;animation:slide 2s infinite"></div>'); return; }
  if (request.url === "/dead-css") { response.end('<!doctype html><link rel="stylesheet" href="http://127.0.0.1:1/app.css"><p style="color:#111;background:#fff">Plain text</p>'); return; }
  if (request.url === "/font") { response.end('<!doctype html><style>@font-face{font-family:Missing;src:url(/missing.woff2)} p{font-family:Missing,sans-serif;color:#111;background:#fff}</style><p id="t">Hello there</p>'); return; }
  if (request.url === "/spacing") { response.end('<!doctype html><style>body{margin:8px;font:14px Arial}</style><div id="chip" style="width:84px;height:20px;line-height:20px;overflow:hidden;white-space:nowrap">Short label</div>'); return; }
  if (request.url === "/gap") { response.end(html + '<button id="second">Second</button>'); return; }
  if (request.url === "/clean-css") { response.end('<!doctype html><link rel="stylesheet" href="/missing.css"><p style="color:#111;background:#fff">Plain text</p>'); return; }
  response.end(html + (request.url === "/broken" ? '<script>fetch("/api-missing")</script>' : ""));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const dir = await mkdtemp(join(tmpdir(), "appearance-runner-"));
const cli = "tooling/appearance-check/dist/cli.js";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const options = { urls: [url + "/bad"], checks: ["AP002", "AP003"], viewports: [{ width: 800, height: 600 }], executablePath };
const run = (args) => promisify(execFile)(process.execPath, [cli, ...args], { timeout: 120000 }).then(r => ({ ...r, code: 0 }), error => error);
try {
  assert.deepEqual(checks.map(c => c.id), Array.from({ length: 34 }, (_, i) => "AP" + String(i + 1).padStart(3, "0")));
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
  assert.equal(result.code, 0);
  const advisory = JSON.parse(result.stdout);
  assert.equal(advisory.findings[0].checkId, "AP003");
  assert.equal(advisory.verdict, "warn");
  assert.equal(advisory.summary.length, 4);
  assert.deepEqual(advisory.summary.map(row => row.dimension), ["accessibility", "color", "layout", "typography"]);
  assert.deepEqual(Object.keys(advisory).slice(0, 2), ["verdict", "summary"]);
  assert.equal((await run(["--config", config, "--fail-on", "warn", "--json"])).code, 2);
  assert.equal((await run(["--config", config, "--fail-on", "bogus"])).code, 1);
  const text = await run(["--config", config]);
  assert.match(text.stdout, /^Appearance review: /);
  assert.match(text.stdout, /^  accessibility\s+(FAIL|WARN|INCOMPLETE|PASS|NOT-RUN)/m);
  const disabled = await run(["--config", config, "--ignore-check", "AP003", "--json"]);
  assert.equal(JSON.parse(disabled.stdout).findings.length, 0);
  assert.equal(disabled.code, 0);
  const listed = (await run(["--list"])).stdout.trim().split("\n");
  assert.equal(listed.length, 34);
  assert(listed.some(line => line.startsWith("AP033 design-tokens") && line.endsWith("(requires --design)")));
  assert(listed.some(line => line.startsWith("AP034 theme-text-parity") && line.endsWith("(requires --color-scheme light --color-scheme dark)")));
  for (const line of listed) assert.match(line, /^AP\d{3} \S+ \[[a-z,]+; (normative|advisory)\] — /);
  const normativeConfig = join(dir, "normative.json");
  await writeFile(normativeConfig, JSON.stringify({ ...options, checks: ["AP002"] }));
  assert.equal((await run(["--config", normativeConfig, "--json"])).code, 2);
  const gapConfig = join(dir, "gap.json");
  await writeFile(gapConfig, JSON.stringify({ ...options, urls: [url + "/gap"], checks: ["AP002"], maxControls: 1 }));
  const gapRun = await run(["--config", gapConfig, "--json"]);
  const gapReport = JSON.parse(gapRun.stdout);
  assert(gapReport.findings.some(f => f.checkId === "AP002") && gapReport.coverage.some(g => g.level === "check" && g.checkId === "AP002"));
  assert.equal(gapRun.code, 2);
  const blockingConfig = join(dir, "blocking.json");
  await writeFile(blockingConfig, JSON.stringify({ ...options, urls: [url + "/clean-css"], checks: ["AP003"] }));
  const blockingRun = await run(["--config", blockingConfig, "--json"]);
  assert(JSON.parse(blockingRun.stdout).coverage.some(g => g.level === "blocking" && g.reason.includes("/missing.css")));
  assert.equal(blockingRun.code, 1);
  assert.equal((await run(["--config", blockingConfig, "--warn-only"])).code, 0);
  const brokenConfig = join(dir, "broken.json");
  await writeFile(brokenConfig, JSON.stringify({ ...options, urls: [url + "/broken"], checks: ["AP001"] }));
  const brokenRun = await run(["--config", brokenConfig, "--json"]);
  const brokenReport = JSON.parse(brokenRun.stdout);
  assert(brokenReport.coverage.some(g => g.level === "info" && g.reason.startsWith("HTTP 501:")));
  assert.equal(brokenReport.findings.length, 0);
  assert.equal(brokenRun.code, 0);
  const invalid = await run(["--checks", "AP999", "--url", url]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Unknown check ID/);
  const warn = await run(["--config", config, "--warn-only"]);
  assert.equal(warn.code, 0);
  assert.match(warn.stdout, /\[AP003 advisory\]/);
  assert.equal((await run(["--config", normativeConfig, "--warn-only"])).code, 0);
  const unavailable = await auditAppearance({ ...options, urls: ["http://127.0.0.1:1"], checks: ["AP003"], timeoutMs: 1000 });
  assert.equal(unavailable.pages.length, 0);
  assert(unavailable.coverage.some(g => g.level === "blocking"));
  await assert.rejects(() => auditAppearance({ ...options, checks: ["AP999"] }), /Unknown check ID/);
  await assert.rejects(() => auditAppearance({ ...options, ignores: [{ checkId: "AP003", reason: "" }] }), /reason/);
  await assert.rejects(() => auditAppearance({ ...options, checks: ["AP033"] }), /design baseline/);
  const designFile = join(dir, "DESIGN.md");
  await writeFile(designFile, '---\ndescription: |\n  Example baseline\ncolors:\n  ink: "#111111"   # body text\n  canvas: "#ffffff"\ncomponents:\n  button:\n    backgroundColor: "{colors.ink}"\n---\n\n# Design\n');
  const offToken = await auditAppearance({ ...options, checks: ["AP033"], design: designFile });
  assert(offToken.findings.some(f => f.checkId === "AP033" && f.evidence.kind === "color" && f.evidence.value === "#112233"), "an undeclared surface color is reported");
  assert(!offToken.findings.some(f => f.evidence.value === "#111111" || f.evidence.value === "#ffffff"), "declared colors pass");
  const inline = await auditAppearance({ ...options, checks: ["AP033"], design: { colors: { ink: "#111", canvas: "#fff", surface: "#123", inner: "#eee" } } });
  assert(!inline.findings.some(f => f.evidence.kind === "color"), "a token object works like a file");
  const designConfig = join(dir, "design.json");
  await writeFile(designConfig, JSON.stringify({ ...options, checks: ["AP033"], design: "DESIGN.md" }));
  assert(JSON.parse((await run(["--config", designConfig, "--json"])).stdout).findings.some(f => f.checkId === "AP033"), "a config design path is relative to the config file");
  const missingDesign = await run(["--url", url, "--design", join(dir, "absent.md")]);
  assert.equal(missingDesign.code, 1);
  assert.match(missingDesign.stderr, /absent\.md/);
  const ids = report => report.findings.map(f => f.checkId);
  const probeOn = await auditAppearance({ ...options, urls: [url + "/wide"], checks: ["AP014"] });
  assert(probeOn.findings.some(f => f.checkId === "AP014" && f.target.includes("#wide")));
  assert(probeOn.pages.some(p => p.kind === "reflow"));
  const probeOff = await auditAppearance({ ...options, urls: [url + "/wide"], checks: ["AP003"] });
  assert(!ids(probeOff).includes("AP014") && !probeOff.pages.some(p => p.kind === "reflow"), "disabled AP014 runs no probe");
  const probeIgnored = await auditAppearance({ ...options, urls: [url + "/wide"], checks: ["AP014"], ignores: [{ checkId: "AP014", selector: "#wide", reason: "Known overflow" }] });
  assert.equal(probeIgnored.findings.length, 0);
  assert(probeIgnored.suppressed.some(f => f.checkId === "AP014"));
  const probeBadIgnore = await auditAppearance({ ...options, urls: [url + "/wide"], checks: ["AP014"], timeoutMs: 2000, ignores: [{ checkId: "AP014", selector: ".never", reason: "Does not match" }] });
  assert(probeBadIgnore.findings.some(f => f.checkId === "AP014"), "a non-matching selector ignore leaves the finding");
  const motionOn = await auditAppearance({ ...options, urls: [url + "/motion"], checks: ["AP017"] });
  assert(motionOn.findings.some(f => f.checkId === "AP017" && f.target.includes("#mover")));
  assert(motionOn.pages.some(p => p.kind === "motion"));
  const motionOff = await auditAppearance({ ...options, urls: [url + "/motion"], checks: ["AP003"] });
  assert(!ids(motionOff).includes("AP017") && !motionOff.pages.some(p => p.kind === "motion"));
  const motionIgnored = await auditAppearance({ ...options, urls: [url + "/motion"], checks: ["AP017"], ignores: [{ checkId: "AP017", selector: "#mover", reason: "Known motion" }] });
  assert.equal(motionIgnored.findings.length, 0);
  assert(motionIgnored.suppressed.some(f => f.checkId === "AP017"));
  const twoSchemes = await auditAppearance({ ...options, urls: [url + "/spacing"], checks: ["AP015"], colorSchemes: ["light", "dark"] });
  assert.equal(twoSchemes.findings.filter(f => f.checkId === "AP015").length, 1, "AP015 runs for the first scheme only");
  assert.equal(twoSchemes.pages.filter(p => p.kind === "scan").length, 2);
  const deadCss = await auditAppearance({ ...options, urls: [url + "/dead-css"], checks: ["AP001"] });
  assert(deadCss.coverage.some(g => g.level === "blocking" && g.reason.includes("app.css")), "a stylesheet that never loads is blocking");
  const notFound = await auditAppearance({ ...options, urls: [url + "/nf"], checks: ["AP001"] });
  assert.equal(notFound.coverage.filter(g => g.level === "blocking").length, 1);
  assert.equal(notFound.coverage.filter(g => g.level === "info" && /HTTP 404/.test(g.reason)).length, 0, "a main document error is one blocking gap only");
  const font = await auditAppearance({ ...options, urls: [url + "/font"], checks: ["AP023"] });
  assert(font.findings.some(f => f.checkId === "AP023"));
  assert(font.coverage.some(g => g.level === "info" && /^HTTP 404: .*\/missing\.woff2$/.test(g.reason)), "the missing font is an info gap");
  assert.equal(font.coverage.filter(g => g.level === "blocking").length, 0);
  console.log("Appearance IDs, state discovery, CLI exits and scoped suppressions passed.");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
