import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { probeReflow } from "../tooling/appearance-check/dist/reflow.js";
import { checkTextSpacing } from "../tooling/appearance-check/dist/text-spacing.js";
import { probeMotion } from "../tooling/appearance-check/dist/motion.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const pages = new Map();
const server = createServer((request, response) => {
  const html = pages.get(new URL(request.url, "http://x").pathname);
  response.writeHead(html === undefined ? 404 : 200, { "content-type": "text/html" });
  response.end(html ?? "");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const serve = (path, body, head = "") => {
  pages.set(path, `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial}${head}</style></head><body>${body}</body></html>`);
  return origin + path;
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const mentions = (list, fragment) => list.filter(item => item.target.includes(fragment) || item.related?.includes(fragment));
const findingsFor = (result, checkId, fragment) => mentions(result.findings.filter(f => f.checkId === checkId), fragment);
const gapsFor = (result, fragment) => mentions(result.skipped, fragment);

test("AP014 reflow", async () => {
    const run = async (body, head) => probeReflow(browser, serve("/reflow-" + Math.random().toString(36).slice(2), body, head), "light");

    const wide = await run(`<div id=wide style="width:600px">text</div>`);
    assert.deepEqual(wide.page.viewport, { width: 320, height: 640 });
    assert.equal(wide.page.kind, "reflow");
    assert.equal(wide.page.colorScheme, "light");
    const wideFindings = findingsFor(wide.result, "AP014", "#wide");
    assert.equal(wideFindings.length, 1, "a 600px block overflows a 320px viewport");
    assert.equal(wideFindings[0].evidence.kind, "overflow");
    assert.equal(wideFindings[0].evidence.viewportWidth, 320);
    assert.ok(wideFindings[0].evidence.overshoot > 250 && wideFindings[0].evidence.overshoot < 290, "overshoot is about 280px");

    const cutOff = await run(`<div id=wide style="width:600px">text</div>`, "html{overflow-x:hidden}");
    const cutFindings = findingsFor(cutOff.result, "AP014", "#wide");
    assert.equal(cutFindings.length, 1, "root clipping still hides the overflowing block");
    assert.equal(cutFindings[0].evidence.kind, "cut-off");
    assert.equal(cutFindings[0].evidence.rootClips, true);

    const clipped = await run(`<div id=chip style="width:84px;height:20px;overflow:hidden;white-space:nowrap">A label that cannot fit its box</div>`);
    const clippedFindings = findingsFor(clipped.result, "AP014", "#chip");
    assert.equal(clippedFindings.length, 1, "text cut off by an inner clip is lost content at 320px");
    assert.equal(clippedFindings[0].evidence.kind, "clipped");
    assert.equal(findingsFor(clipped.result, "AP005", "#chip").length, 0, "findings are reported under AP014 only");

    const scroller = await run(`<div id=sc style="overflow-x:auto"><table id=tbl style="width:600px"><tr><td>cell</td></tr></table></div>`);
    assert.equal(scroller.result.findings.length, 0, "content inside its own scroller is reachable");
    assert.equal(gapsFor(scroller.result, "#tbl").length, 0, "no gap for the scroller twin");

    const skipLink = await run(`<a id=skip href=# style="position:absolute;left:-9999px">Skip</a><p>Body</p>`, "html{overflow-x:hidden}");
    assert.equal(skipLink.result.findings.length, 0, "a parked skip link is not a reflow culprit");
    assert.equal(gapsFor(skipLink.result, "#skip").length, 0);

    const offCanvas = await run(`<nav id=menu style="position:absolute;left:100%;top:0;width:200px">Menu</nav><p>Body</p>`, "html{overflow-x:hidden}");
    assert.equal(offCanvas.result.findings.length, 0, "an off-canvas panel under root clipping is by design");
    assert.equal(gapsFor(offCanvas.result, "#menu").length, 0);

    const offCanvasOpen = await run(`<nav id=menu style="position:absolute;left:100%;top:0;width:200px">Menu</nav><p>Body</p>`);
    assert.equal(findingsFor(offCanvasOpen.result, "AP014", "#menu").length, 1, "the same panel is reachable by page scroll without root clipping");

    const image = await run(`<img id=pic alt="" width=600 height=40 src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`);
    assert.equal(findingsFor(image.result, "AP014", "#pic").length, 0, "2-D content is an exception, not a finding");
    assert.equal(gapsFor(image.result, "#pic").length, 1, "2-D overflow needs review");
    assert.equal(image.result.skipped[0].checkId, "AP014");

    const fits = await run(`<div id=ok style="width:300px">text</div>`);
    assert.equal(fits.result.findings.length + fits.result.skipped.length, 0, "content that fits is clean");

    const missing = await probeReflow(browser, origin + "/does-not-exist", "light");
    assert.equal(missing.result.findings.length, 0);
    assert.ok(missing.result.skipped.some(s => s.checkId === "AP014" && s.target === "document"), "an uninspectable page is a gap, not a pass");
});

test("AP015 text spacing", async () => {
    const open = async (html) => {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><style>body{margin:8px;font:14px Arial}div,p,span{margin:0}</style>${html}`);
      await page.evaluate(installKit);
      return { page, context };
    };

    const { page, context } = await open(`
      <div id=chip1 style="width:84px;height:20px;line-height:20px;overflow:hidden;white-space:nowrap">Short label</div>
      <div id=chip2 style="min-width:84px;padding:4px;white-space:nowrap">Short label</div>
      <div id=ell style="width:84px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Short label</div>
      <p id=inl style="letter-spacing:0 !important;width:84px;height:20px;overflow:hidden;white-space:nowrap">Short label</p>
      <span id=ico style="font-family:'Material Icons';display:inline-block;width:100px;overflow:hidden;white-space:nowrap;font-size:16px">arrow_forward</span>`);
    const stylesBefore = await page.evaluate(() => document.querySelectorAll("style").length);
    const baseline = await page.evaluate(() => ["chip1", "chip2", "ell", "inl", "ico"].map(id => {
      const el = document.getElementById(id);
      return el.scrollWidth <= el.clientWidth + 2 && el.scrollHeight <= el.clientHeight + 2;
    }));
    assert.deepEqual(baseline, [true, true, true, true, true], "all fixtures start without clipping");
    const spacing = await checkTextSpacing(page);

    const chip = findingsFor(spacing, "AP015", "#chip1");
    assert.equal(chip.length, 1, "label that fits at baseline clips under the override");
    assert.equal(chip[0].evidence.kind, "clipped");
    assert.equal(chip[0].evidence.override, "WCAG 1.4.12");
    assert.equal(chip[0].confidence, "measured");
    assert.equal(chip[0].checkId, "AP015");
    assert.equal(findingsFor(spacing, "AP015", "#chip2").length + gapsFor(spacing, "#chip2").length, 0, "a chip that grows with its text is clean");
    assert.equal(findingsFor(spacing, "AP015", "#ell").length, 0, "ellipsis is not a clipped finding");
    const ellGaps = gapsFor(spacing, "#ell");
    assert.equal(ellGaps.length, 1, "truncation under the override is a gap");
    assert.match(ellGaps[0].reason, /truncated/i);
    assert.equal(findingsFor(spacing, "AP015", "#inl").length, 0, "inline !important blocks the override, nothing to measure");
    const inlGaps = gapsFor(spacing, "#inl");
    assert.equal(inlGaps.length, 1);
    assert.match(inlGaps[0].reason, /!important/);
    assert.equal(findingsFor(spacing, "AP015", "#ico").length + gapsFor(spacing, "#ico").length, 0, "icon-font ligatures are excluded");
    assert.ok(spacing.skipped.every(s => s.checkId === "AP015"));

    const after = await page.evaluate(() => ({
      styles: document.querySelectorAll("style").length,
      letterSpacing: getComputedStyle(document.getElementById("chip2")).letterSpacing,
    }));
    assert.equal(after.styles, stylesBefore, "the override stylesheet is removed");
    assert.equal(after.letterSpacing, "normal", "the page is restored");

    // text that already clipped at baseline is not attributed to the override
    await page.setContent(`<!doctype html><style>body{margin:8px;font:14px Arial}</style><div id=pre style="width:30px;height:20px;overflow:hidden;white-space:nowrap">Already clipped before</div>`);
    await page.evaluate(installKit);
    const preexisting = await checkTextSpacing(page);
    assert.equal(findingsFor(preexisting, "AP015", "#pre").length, 0, "pre-existing clipping belongs to AP005");
    await context.close();
});

test("AP017 persistent motion", async () => {
    const keyframes = "@keyframes slide{to{transform:translateX(100px)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.3}}";
    const box = "width:50px;height:20px;background:#357;margin:4px;";
    const body = `
      <div id=pos style="${box}animation:slide 2s infinite"></div>
      <div id=slow style="${box}animation:slide 6s 1"></div>
      <div id=reduce-ok style="${box}"></div>
      <div id=pref-ok class=pref></div>
      <div id=spinner style="width:24px;height:24px;margin:4px;background:#357;animation:spin 1s linear infinite"></div>
      <div role=progressbar id=bar style="${box}animation:slide 2s infinite"></div>
      <div id=finite style="${box}animation:slide 1s 1"></div>
      <div id=pulse style="${box}animation:pulse 2s infinite"></div>
      <div id=hidden aria-hidden=true style="${box}animation:slide 2s infinite"></div>
      <script>
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) document.getElementById("reduce-ok").style.animation = "slide 2s infinite";
      </script>`;
    const head = `${keyframes}@media (prefers-reduced-motion:no-preference){.pref{width:50px;height:20px;margin:4px;background:#357;animation:slide 2s infinite}}`;
    const url = serve("/motion", body, head);
    const motion = await probeMotion(browser, url, { width: 800, height: 600 }, "light");
    assert.equal(motion.page.kind, "motion");
    assert.deepEqual(motion.page.viewport, { width: 800, height: 600 });
    const targets = motion.result.findings.map(f => f.target);
    assert.ok(motion.result.findings.every(f => f.checkId === "AP017" && f.confidence === "heuristic"));
    assert.equal(findingsFor(motion.result, "AP017", "#pos").length, 1, "an infinite transform animation persists under reduced motion");
    const pos = motion.result.findings.find(f => f.target.includes("#pos"));
    assert.ok(pos.evidence.properties.includes("transform"));
    assert.equal(pos.evidence.animationName, "slide");
    assert.equal(findingsFor(motion.result, "AP017", "#slow").length, 1, "a finite animation longer than 5s persists");
    for (const id of ["reduce-ok", "pref-ok", "spinner", "bar", "finite", "pulse", "hidden"]) {
      assert.ok(!targets.some(t => t.includes("#" + id)), `${id} is not reported`);
      assert.equal(gapsFor(motion.result, "#" + id).length, 0, `${id} has no gap`);
    }
    assert.equal(motion.result.findings.length, 2, "only the two persistent animations are reported");
});

after(async () => {
  await browser.close();
  server.close();
});
