import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runAxe } from "../tooling/appearance-check/dist/axe.js";
import { auditAppearance } from "../tooling/appearance-check/dist/runner.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");
const { version } = require("axe-core/package.json");
const html = body => `<!doctype html><html lang="en"><head><title>Audit</title><style>body{font:16px Arial;color:#111;background:#fff}</style></head><body>${body}</body></html>`;
const pages = new Map([
  ["/first", html(`<h1>Heading</h1><h3>Skipped level</h3>
    <div id="scope"><p id="inside" style="color:#aaa">Low contrast inside</p></div>
    <p id="outside" style="color:#aaa">Low contrast outside</p>
    <div id="sizes" style="display:flex"><button id="tiny" aria-label="One" style="width:16px;height:16px;padding:0;margin:1px"></button><button aria-label="Two" style="width:16px;height:16px;padding:0;margin:1px"></button></div>`)],
  ["/next", html(`<p id="next" style="color:#aaa">Next document</p>`)],
  ["/host", html(`<p id="host-text" style="color:#aaa">Host page</p>
    <script>const axe={version:"host",run(){throw new Error("Host axe must not run")}};window.axe=axe;window.hostAxe=axe;</script>`)],
  ["/frames", html(`<p id="parent" style="color:#aaa">Parent text</p>
    <iframe title="Outside inspection scope" src="/child"></iframe>`)],
  ["/child", html(`<p id="child" style="color:#aaa">Child text</p><script src="/axe.min.js"></script>`)],
  ["/axe.min.js", await readFile(require.resolve("axe-core/axe.min.js"), "utf8")],
]);
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const body = pages.get(path);
  response.writeHead(body === undefined ? 404 : 200, { "content-type": path.endsWith(".js") ? "application/javascript" : "text/html" });
  response.end(body ?? "");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const ruleIds = result => [...new Set([result.violations, result.passes, result.incomplete, result.inapplicable].flat().map(rule => rule.id))].sort();
const contrastTargets = result => result.violations.filter(rule => rule.id === "color-contrast").flatMap(rule => rule.nodes.flatMap(node => node.target)).sort();

test("runAxe injects once per document, keeps rule and selector scope, and reinjects after navigation", async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.addInitScript(() => {
    let engine;
    window.axeAssignments = 0;
    Object.defineProperty(window, "axe", {
      configurable: true,
      get: () => engine,
      set: value => { engine = value; window.axeAssignments++; },
    });
  });
  const page = await context.newPage();
  let helperPages = 0;
  context.on("page", () => helperPages++);
  await page.goto(origin + "/first");
  const whole = await runAxe(page, ["color-contrast"]);
  assert.deepEqual(ruleIds(whole), ["color-contrast"]);
  assert.deepEqual(contrastTargets(whole), ["#inside", "#outside"]);
  const scoped = await runAxe(page, ["color-contrast"], "#scope");
  assert.deepEqual(contrastTargets(scoped), ["#inside"]);
  const sizes = await runAxe(page, ["target-size"], "#sizes");
  assert.deepEqual(ruleIds(sizes), ["target-size"]);
  assert.ok(sizes.violations.some(rule => rule.id === "target-size"));
  const headings = await runAxe(page, ["heading-order", "empty-heading"]);
  assert.deepEqual(ruleIds(headings), ["empty-heading", "heading-order"]);
  assert.ok(headings.violations.some(rule => rule.id === "heading-order"));
  assert.equal(await page.evaluate(() => window.axeAssignments), 1);
  assert.equal(helperPages, 0);
  await page.goto(origin + "/next");
  assert.equal(await page.evaluate(() => window.axeAssignments), 0);
  const next = await runAxe(page, ["color-contrast"]);
  assert.equal(next.testEngine.version, version);
  assert.deepEqual(contrastTargets(next), ["#next"]);
  assert.equal(await page.evaluate(() => window.axeAssignments), 1);
  assert.equal(helperPages, 0);
});

test("runAxe uses its pinned engine despite host axe bindings and later global replacement", async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin + "/host");
  const first = await runAxe(page, ["color-contrast"]);
  assert.equal(first.testEngine.version, version);
  assert.deepEqual(contrastTargets(first), ["#host-text"]);
  await page.evaluate(() => { window.axe = window.hostAxe; });
  const again = await runAxe(page, ["color-contrast"], "#host-text");
  assert.equal(again.testEngine.version, version);
  assert.deepEqual(contrastTargets(again), ["#host-text"]);
});

test("iframe contents remain outside the inspected document with a visible coverage gap", async () => {
  const report = await auditAppearance({
    urls: [origin + "/frames"], checks: ["AP001"], viewports: [{ width: 800, height: 600 }],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  assert.deepEqual(report.findings.map(finding => finding.target), ["#parent"]);
  assert.equal(report.findings[0].checkId, "AP001");
  assert.equal(report.coverage.filter(gap => gap.level === "check" || gap.level === "blocking").length, 0);
  assert.ok(report.coverage.some(gap => gap.target === "iframe" && gap.level === "info" && /outside the inspected document/.test(gap.reason)));
});

after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
