import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const dist = join(process.cwd(), "styles/liquid-glass/dist");
const stripes = "repeating-linear-gradient(90deg,#e33 0 10px,#33e 10px 20px)";
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/liquid-glass.css"><script src="/liquid-glass.browser.js"></script></head>
<body style="margin:0;padding:40px;background:${stripes}">
<section id="card" class="pk-glass" style="width:320px;height:180px;padding:16px;box-sizing:border-box">
<input id="inner" class="pk-glass-field" style="width:200px;height:32px">
</section>
<input id="field" class="pk-glass-field" style="display:block;margin-top:24px;width:240px;height:32px;box-sizing:border-box">
<input id="twin" class="pk-glass-field" style="display:block;margin-top:8px;width:240px;height:32px;box-sizing:border-box">
</body></html>`;
const mime = { ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://test").pathname;
  if (pathname === "/") return response.writeHead(200, { "content-type": "text/html" }).end(page);
  const path = normalize(join(dist, pathname));
  if (!path.startsWith(dist)) return response.writeHead(403).end();
  try { response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

try {
  for (const colorScheme of ["light", "dark"]) {
    const tab = await browser.newPage({ viewport: { width: 800, height: 600 }, colorScheme });
    await tab.goto(`http://127.0.0.1:${port}/`);
    await tab.evaluate(async (frameSource) => {
      window.stop = window.PlatformKitLiquidGlass.liquidGlass(document.body);
      await (0, eval)(frameSource)();
    }, `(${frame})`);

    const state = await tab.evaluate(() => {
      const read = (id) => {
        const el = document.getElementById(id);
        return { glass: el.hasAttribute("data-liquid-glass"), lens: el.style.getPropertyValue("--pk-lens"), backdrop: getComputedStyle(el).backdropFilter };
      };
      const filters = [...document.querySelectorAll("svg[data-pk-liquid-glass] filter")].map((f) => ({
        id: f.id, width: f.getAttribute("width"), height: f.getAttribute("height"),
        scale: Number(f.querySelector("feDisplacementMap").getAttribute("scale")),
        map: f.querySelector("feImage").getAttribute("href").slice(0, 22),
      }));
      return { card: read("card"), inner: read("inner"), field: read("field"), twin: read("twin"), filters };
    });
    assert.ok(state.card.glass && state.field.glass && state.twin.glass, `${colorScheme}: top-level surfaces refract`);
    assert.equal(state.inner.glass, false, "a field inside a refracting card stays flat");
    assert.equal(state.inner.backdrop, "none", "a nested field drops its backdrop filter");
    const inherited = await tab.evaluate(() => {
      const probe = document.createElement("span");
      document.getElementById("card").append(probe);
      const value = getComputedStyle(probe).getPropertyValue("--pk-lens");
      probe.remove();
      return value;
    });
    assert.equal(inherited, "", "a lens never reaches the elements inside it");
    assert.match(state.card.backdrop, /url\(.*#pk-lens-\d+.*\)/, "the card's backdrop filter leads with its lens");
    assert.equal(state.field.lens, state.twin.lens, "same-shaped fields share one filter");
    assert.equal(state.filters.length, 2, "one filter per shape");
    const card = state.filters.find((f) => f.width === "320");
    const field = state.filters.find((f) => f.width === "240");
    assert.equal(card.map, "data:image/png;base64,");
    assert.ok(Math.abs(card.scale - 31.5) < 0.01, `card bends like a 180px pane (${card.scale})`);
    assert.ok(field.scale > 0 && field.scale < 6, `a 32px field bends a few pixels (${field.scale})`);

    const fills = await tab.evaluate(() => [getComputedStyle(card).backgroundColor, getComputedStyle(field).backgroundColor]);
    for (const fill of fills) assert.ok(Number(fill.match(/[\d.]+(?=\))/)?.[0] ?? 1) < 0.5, `${colorScheme}: translucent fill ${fill}`);

    // Removing one twin keeps the shared filter; removing both frees it.
    await tab.evaluate(async (frameSource) => { document.getElementById("twin").remove(); await (0, eval)(frameSource)(); }, `(${frame})`);
    assert.equal(await tab.locator("svg[data-pk-liquid-glass] filter").count(), 2);
    await tab.evaluate(async (frameSource) => { document.getElementById("field").remove(); await (0, eval)(frameSource)(); }, `(${frame})`);
    assert.equal(await tab.locator("svg[data-pk-liquid-glass] filter").count(), 1);

    // Late arrivals refract; a resize refits to a new shape.
    await tab.evaluate(async (frameSource) => {
      const late = document.createElement("div");
      late.id = "late";
      late.className = "pk-glass";
      late.style.cssText = "width:100px;height:60px;margin-top:8px";
      document.body.append(late);
      await (0, eval)(frameSource)();
    }, `(${frame})`);
    assert.ok(await tab.locator("#late").getAttribute("data-liquid-glass") !== null);
    await tab.evaluate(() => { document.getElementById("late").style.width = "140px"; });
    // The border counts: a 140px content box is a 142px lens.
    await tab.waitForFunction(() => document.querySelector('svg[data-pk-liquid-glass] filter[width="142"]'));

    // Tuning comes from inherited properties; a refresh refits what is on screen.
    const tuned = await tab.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty("--pk-glass-edge-blur", "3px");
      root.setProperty("--pk-glass-refraction", "2");
      root.setProperty("--pk-glass-blur", "8px");
      window.PlatformKitLiquidGlass.refreshLiquidGlass();
      const late = document.getElementById("late");
      const filter = document.querySelector(late.style.getPropertyValue("--pk-lens").slice(4, -1));
      return {
        blur: filter.querySelector("feGaussianBlur")?.getAttribute("stdDeviation"),
        // The last merge lays the blurred rim over the bent page; an earlier one may assemble a sliced map.
        merged: filter.lastElementChild.querySelectorAll("feMergeNode").length,
        scale: Number(filter.querySelector("feDisplacementMap").getAttribute("scale")),
        backdrop: getComputedStyle(late).backdropFilter,
        filters: document.querySelectorAll("svg[data-pk-liquid-glass] filter").length,
      };
    });
    assert.equal(tuned.blur, "3", "edge blur blurs the rim band");
    assert.equal(tuned.merged, 2);
    assert.ok(Math.abs(tuned.scale - 2 * 2 * 17.5 * 0.31) < 0.01, `refraction doubles the bend (${tuned.scale})`);
    assert.match(tuned.backdrop, /blur\(8px\)/, "background blur follows its token");
    assert.equal(tuned.filters, 2, "refitting releases the untuned filters");
    const highlight = await tab.evaluate(() => {
      document.documentElement.style.setProperty("--pk-glass-highlight", "0.25");
      return getComputedStyle(document.getElementById("card"), "::before").opacity;
    });
    assert.equal(highlight, "0.25", "rim light follows its token");

    await tab.evaluate(() => window.stop());
    assert.equal(await tab.locator("[data-liquid-glass]").count(), 0, "stopping lets every surface go flat");
    assert.equal(await tab.locator("svg[data-pk-liquid-glass] filter").count(), 0);
    await tab.close();
  }

  const contrast = await browser.newPage({ viewport: { width: 800, height: 600 }, forcedColors: "active" });
  await contrast.goto(`http://127.0.0.1:${port}/`);
  const attached = await contrast.evaluate(() => {
    window.PlatformKitLiquidGlass.liquidGlass(document.body);
    return [document.querySelectorAll("[data-liquid-glass]").length, getComputedStyle(document.getElementById("card")).backdropFilter];
  });
  assert.deepEqual(attached, [0, "none"], "forced colors keep every surface flat");
  await contrast.close();

  console.log("Liquid glass: lens sharing, nesting, lifecycle, resize, materials and contrast fallback passed.");
} finally {
  await browser.close();
  server.close();
}
