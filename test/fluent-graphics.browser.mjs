import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const require = createRequire(new URL("../apps/fluent-preview/package.json", import.meta.url));
const { createServer } = await import(require.resolve("vite"));
let server, browser, page;
before(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/fixtures/fluent-graphics.html`);
  await page.waitForFunction(() => document.querySelectorAll("[data-status]").length === 4);
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.locator("[data-status]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-status"))), ["estimated", "estimated", "estimated", "empty"]);
  assert.deepEqual(await page.evaluate(() => window.graphicErrors), []);
});
after(async () => { await browser?.close(); await server?.close(); });

test("trimmed SVG keeps stroked paint in the icon slot and exposes only intentional names", async () => {
  const boxes = await page.locator(".fluent-svg-icon").evaluateAll(nodes => nodes.map(node => ({ root: node.getBoundingClientRect().toJSON(), paint: node.querySelector("img").getBoundingClientRect().toJSON() })));
  assert.equal(boxes[0].root.width, 24);
  assert(boxes[0].paint.width >= boxes[0].root.width);
  assert.equal(await page.locator('[role="img"][aria-label="File"]').count(), 1);
  assert.equal(await page.locator(".fluent-svg-icon[aria-hidden=true]").count(), 1);
  assert.equal(await page.locator('.fluent-svg-icon[aria-label="Empty"]').getAttribute("data-status"), "empty");
  const bounds = await page.evaluate(() => window.graphicResults[0]?.bounds);
  assert(bounds && bounds.width > 0 && bounds.height > 0, "stroke-expanded paint bounds should be reported");
  assert.equal(await page.locator(".fluent-icon-text").getAttribute("dir"), "rtl");
  assert.equal(await page.locator(".fluent-icon-text").innerText(), "Save");
});

test("theme, label, source, and font-reference changes are measured without observer loops", async () => {
  const first = await page.locator(".fluent-icon-text__icon").evaluate(node => getComputedStyle(node.parentElement).gap);
  const before = Number(await page.locator("#events").textContent());
  await page.waitForTimeout(300);
  assert.equal(Number(await page.locator("#events").textContent()), before);
  await page.locator("#play").click();
  await page.waitForFunction(() => document.querySelector(".fluent-icon-text__label")?.textContent === "Play");
  const playTransform = await page.locator(".fluent-icon-text__paint").getAttribute("style");
  await page.locator("#gyp").click();
  await page.waitForFunction(() => document.querySelector(".fluent-icon-text__label")?.textContent === "gyp");
  const gypTransform = await page.locator(".fluent-icon-text__paint").getAttribute("style");
  const yOffset = style => /translate\([^,]+, ([^)]+)\)/.exec(style)?.[1];
  assert.equal(yOffset(gypTransform), yOffset(playTransform));
  await page.setViewportSize({ width: 560, height: 720 });
  await page.addStyleTag({ content: ".fluent-icon-text { font-size: 24px; }" });
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector(".fluent-icon-text")).fontSize) === 24);
  await page.locator("#label").click();
  await page.waitForFunction(() => document.querySelector(".fluent-icon-text__label")?.textContent === "保存");
  await page.locator("#source").click();
  await page.waitForFunction(() => document.querySelector(".fluent-svg-icon").getAttribute("data-status") === "estimated" && document.querySelector(".fluent-svg-icon img")?.src.includes("path"));
  await page.locator("#toggle").click();
  await page.waitForFunction(() => document.querySelector(".fluent-theme")?.getAttribute("data-fluent-theme") === "dark");
  assert.equal(await page.locator(".fluent-icon-text__icon").evaluate(node => getComputedStyle(node.parentElement).gap), first);
  assert.equal(await page.locator(".fluent-icon-text__label").innerText(), "保存");
});
