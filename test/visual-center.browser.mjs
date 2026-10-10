import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
const require = createRequire(new URL("../apps/fluent-preview/package.json", import.meta.url));
const { createServer } = await import(require.resolve("vite"));
let server, browser, page;
before(async () => {
  server = await createServer({configFile:false,root:process.cwd(),logLevel:"silent",server:{host:"127.0.0.1",port:0}});
  await server.listen();
  browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/fixtures/visual-center.html`);
  await page.waitForFunction(() => window.kit);
});
after(async () => { await browser?.close(); await server?.close(); });
const measure = (svg,options={}) => page.evaluate(async ({svg,options}) => window.kit.measureSvg(svg,{background:"white",width:32,height:32,...options}),{svg,options});
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;

test("SVG sampling includes strokes and preserves source paint without DOM insertion", async () => {
  const result = await measure(svg('<rect x="8" y="10" width="12" height="8" fill="none" stroke="currentColor" stroke-width="4"/>'));
  assert.deepEqual(result.bounds,{x:6,y:8,width:16,height:12});
  assert(Math.abs(result.center.x-14)<0.01);
  assert(Math.abs(result.center.y-14)<0.01);
  assert.equal(await page.locator("rect").count(),0);
});

test("background-aware weighting changes the offset without changing alpha crop bounds", async () => {
  const source=svg('<rect x="4" y="8" width="8" height="16" fill="black"/><rect x="20" y="8" width="8" height="16" fill="white"/>');
  const light=await measure(source), dark=await measure(source,{background:"black"});
  assert(Math.abs(light.center.x-8)<0.01);
  assert(Math.abs(dark.center.x-24)<0.01);
  assert.deepEqual(light.bounds,dark.bounds);
});

test("local gradients and clipped paths work while external or active content is rejected", async () => {
  const result = await measure(svg('<defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient><clipPath id="c"><rect x="4" y="4" width="16" height="16"/></clipPath></defs><rect width="32" height="32" fill="url(#g)" clip-path="url(#c)"/>'));
  assert.deepEqual(result.bounds,{x:4,y:4,width:16,height:16});
  for(const source of [svg('<image href="https://example.invalid/image.png"/>'),svg('<script>throw 1</script>'),svg('<rect onload="alert(1)"/>')]) {
    await assert.rejects(()=>measure(source));
  }
  await assert.rejects(()=>measure(svg('<rect/>'),{color:'red;fill:url(https://example.invalid/image.svg)'}));
});

test("scales intrinsic SVG coordinates consistently and preserves authored color", async () => {
  const withoutViewBox = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" color="white"><rect x="4" y="4" width="8" height="8" fill="currentColor"/></svg>';
  const result = await measure(withoutViewBox,{background:"black"});
  assert.deepEqual(result.bounds,{x:8,y:8,width:16,height:16});
  assert.equal(result.status,"estimated");
  const white = await measure(withoutViewBox,{background:"white"});
  assert.equal(white.status,"no-contrast");
  await assert.rejects(()=>measure('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'), /viewBox|intrinsic/);
});

test("accepts inline SVG markup without an explicit namespace and keeps the same measured geometry", async () => {
  const result = await measure('<svg viewBox="0 0 32 32"><rect x="4" y="8" width="16" height="8"/></svg>');
  assert.deepEqual(result.bounds,{x:4,y:8,width:16,height:8});
  assert(result.svg.includes('xmlns="http://www.w3.org/2000/svg"'));
});
