import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const dist = join(root, "apps/fluent-preview/dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  const requested = new URL(request.url, "http://test").pathname;
  const pathname = requested === "/" ? "/index.html" : requested;
  const path = normalize(join(dist, pathname));
  if (!path.startsWith(dist)) return response.writeHead(403).end();
  try { response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const artifact = join(root, "test/artifacts");
await mkdir(artifact, { recursive: true });
const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgb = value => { const parts = value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return value.startsWith("color(") ? parts.map(part => part * 255) : parts; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", reducedMotion: "no-preference" });
  await page.goto(`http://127.0.0.1:${port}/?theme=dark&accent=%230067c0`, { waitUntil: "networkidle" });

  const primary = page.getByTestId("button-primary");
  const { color, background } = await primary.evaluate(el => { const style = getComputedStyle(el); return { color: style.color, background: style.backgroundColor }; });
  assert.ok(contrast(rgb(color), rgb(background)) >= 4.5, `primary text ${color} on ${background}`);

  const shadows = await page.locator(".fluent-button").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).boxShadow));
  assert.ok(shadows.every(shadow => !shadow.includes("28px")), "buttons must not carry the flyout shadow");

  const selectControl = page.getByTestId("fluent-select");
  const [selectBox, buttonBox] = [await selectControl.boundingBox(), await primary.boundingBox()];
  assert.equal(selectBox.height, 32);
  assert.equal(selectBox.height, buttonBox.height);

  await selectControl.click();
  const popoverWidth = await page.locator(".fluent-popover").evaluate(el => el.offsetWidth);
  assert.ok(popoverWidth >= selectBox.width - 0.5, `popover ${popoverWidth} narrower than control ${selectBox.width}`);
  await page.keyboard.press("Escape");

  await page.getByTestId("menu-trigger").click();
  const labelX = await page.locator(".fluent-menu__item-label").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
  assert.ok(labelX.length > 1 && labelX.every(x => x === labelX[0]), `menu labels misaligned: ${labelX}`);
  await page.keyboard.press("Escape");

  const labels = await page.getByTestId("slider-labelled").locator("xpath=ancestor::label[1]").locator(".fluent-slider__stop-label").evaluateAll(nodes => nodes.map(node => { const { left, right, top, bottom } = node.getBoundingClientRect(); return { left, right, top, bottom }; }));
  assert.equal(labels.length, 5);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `slider labels ${i} and ${j} intersect`);
  }

  for (const id of ["slider-labelled", "slider-edge-labels", "slider-wrapped-labels", "slider-uneven-labels"]) {
    const geometry = await page.getByTestId(id).locator("xpath=ancestor::label[1]").evaluate(slider => {
      const box = slider.getBoundingClientRect();
      const centre = node => { const r = node.getBoundingClientRect(); return (r.left + r.right) / 2; };
      const ticks = new Map([...slider.querySelectorAll(".fluent-slider__ticks--end .fluent-slider__tick")].map(tick => [tick.dataset.value, centre(tick)]));
      const row = slider.querySelector(".fluent-slider__labels").getBoundingClientRect();
      return { left: box.left, right: box.right, rowBottom: row.bottom, ticks: Object.fromEntries(ticks), labels: [...slider.querySelectorAll(".fluent-slider__stop-label")].map(node => {
        const r = node.getBoundingClientRect();
        return { value: node.dataset.value, centre: centre(node), left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipped: node.scrollWidth > node.clientWidth };
      }) };
    });
    for (const label of geometry.labels) {
      assert.ok(Math.abs(label.centre - geometry.ticks[label.value]) <= 1, `${id} label ${label.value} centred at ${label.centre}, stop at ${geometry.ticks[label.value]}`);
      assert.ok(label.left >= geometry.left - 0.5 && label.right <= geometry.right + 0.5, `${id} label ${label.value} leaves the slider box`);
      assert.ok(label.bottom <= geometry.rowBottom + 0.5, `${id} label ${label.value} spills below its row`);
      assert.ok(!label.clipped, `${id} label ${label.value} is truncated`);
    }
    geometry.labels.forEach((a, i) => geometry.labels.slice(i + 1).forEach(b => {
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${id} labels ${a.value} and ${b.value} intersect`);
    }));
  }

  const bar = page.locator(".fluent-progress-bar--indeterminate .fluent-progress-bar__value");
  const first = await bar.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(300);
  assert.notEqual(await bar.evaluate(el => getComputedStyle(el).transform), first, "indeterminate progress must move");

  await page.evaluate(() => {
    const link = Object.assign(document.createElement("a"), { href: "#probe", textContent: "probe", id: "probe-link" });
    document.querySelector(".fluent-theme").append(link);
  });
  const link = page.locator("#probe-link");
  const surface = await page.evaluate(() => { const probe = document.createElement("i"); probe.style.color = "var(--fluent-bg)"; document.querySelector(".fluent-theme").append(probe); return getComputedStyle(probe).color; });
  await link.hover();
  const hoverColor = await link.evaluate(el => getComputedStyle(el).color);
  assert.ok(contrast(rgb(hoverColor), rgb(surface)) >= 4.5, `link hover ${hoverColor} on ${surface}`);
  await page.mouse.down();
  const pressedColor = await link.evaluate(el => getComputedStyle(el).color);
  await page.mouse.up();
  assert.ok(contrast(rgb(pressedColor), rgb(surface)) >= 4.5, `link pressed ${pressedColor} on ${surface}`);

  await page.screenshot({ path: join(artifact, "fluent-dark-custom-accent.png"), fullPage: true });
  console.log("Fluent dark browser checks passed");
} finally {
  await browser.close();
  server.close();
}
