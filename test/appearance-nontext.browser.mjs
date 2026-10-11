import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { inspectNonText } from "../tooling/appearance-check/dist/nontext.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

// Findings and gaps are keyed by the id of the element their target selector resolves to.
async function inspect(html) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>
    body{margin:0;background:#fff;color:#111;font:16px Arial}
    input.f{display:block;margin:20px;width:200px;height:30px;box-sizing:border-box;padding:0}
  </style>${html}`);
  await page.evaluate(installKit);
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(inspectNonText);
  const ids = await page.evaluate(targets => targets.map(t => document.querySelector(t)?.id ?? null), [...result.findings, ...result.skipped].map(x => x.target));
  const keyed = [...result.findings, ...result.skipped].map((x, i) => ({ ...x, id: ids[i] }));
  await context.close();
  return {
    findings: keyed.filter(x => "message" in x),
    gaps: keyed.filter(x => !("message" in x)),
    all: result,
  };
}
const findingFor = (r, id) => r.findings.filter(f => f.id === id);
const gapFor = (r, id) => r.gaps.filter(g => g.id === id);
const clean = (r, id, label) => {
  assert.deepEqual(findingFor(r, id).map(f => f.message), [], label + ": no finding");
  assert.deepEqual(gapFor(r, id).map(g => g.reason), [], label + ": no gap");
};
const field = (id, style) => `<input class="f" id="${id}" style="${style}">`;

try {
  {
    const r = await inspect([
      field("weak", "border:1px solid #ddd;background:#fff"),
      field("twin-below", "border:1px solid #969696;background:#fff"),
      field("twin-above", "border:1px solid #949494;background:#fff"),
      field("dark", "border:1px solid #767676;background:#fff"),
      field("none", "border:0;background:transparent"),
    ].join(""));
    const weak = findingFor(r, "weak");
    assert.equal(weak.length, 1, "weak border is a finding");
    assert.equal(weak[0].checkId, "AP016");
    assert.equal(weak[0].message, "Control boundary contrast is below 3:1 against the adjacent color.");
    assert.equal(weak[0].evidence.kind, "control-boundary");
    assert.equal(weak[0].evidence.required, 3);
    assert(Math.abs(weak[0].evidence.bestRatio - 1.36) < 0.02, "ratio of #ddd on white is about 1.36: " + weak[0].evidence.bestRatio);
    assert.equal(findingFor(r, "twin-below").length, 1, "2.96:1 border fails");
    clean(r, "twin-above", "3.03:1 border");
    clean(r, "dark", "#767676 border");
    clean(r, "none", "no boundary");
  }

  {
    const r = await inspect([
      field("fill", "border:0;background:#f0f0f0"),
      `<div style="background-image:linear-gradient(#fff,#eee);padding:20px;width:300px">${field("onimage", "border:1px solid #ddd;background:#fff")}</div>`,
      `<input class="f" id="dis" disabled style="border:1px solid #ddd;background:#fff">`,
      `<input class="f" id="hid" aria-hidden="true" style="border:1px solid #ddd;background:#fff;display:none">`,
    ].join(""));
    assert.equal(findingFor(r, "fill").length, 0, "fill-only is never a finding");
    const fill = gapFor(r, "fill");
    assert.equal(fill.length, 1);
    assert.equal(fill[0].checkId, "AP016");
    assert.match(fill[0].reason, /Fill-only/);
    assert.equal(findingFor(r, "onimage").length, 0, "image backdrop is never a finding");
    assert.equal(gapFor(r, "onimage").length, 1, "image backdrop is a gap");
    clean(r, "dis", "disabled control");
    clean(r, "hid", "hidden control");
  }

  {
    const icon = fill => `<button id="b" aria-label="x" style="background:#fff;border:0"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 4h16v16H4z" fill="${fill}"/></svg></button>`;
    const bad = await inspect(icon("#ccc"));
    const hit = findingFor(bad, "b");
    assert.equal(hit.length, 1, "pale glyph fails");
    assert.equal(hit[0].message, "Icon-only control glyph contrast is below 3:1.");
    assert.equal(hit[0].evidence.kind, "icon");
    assert(Math.abs(hit[0].evidence.bestRatio - 1.61) < 0.02, "ratio of #ccc on white is about 1.61: " + hit[0].evidence.bestRatio);

    clean(await inspect(icon("#595959")), "b", "dark glyph");
    const duo = await inspect(`<button id="b" aria-label="x" style="background:#fff;border:0"><svg viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" fill="#eee"/><path d="M4 4h16v16H4z" fill="#333"/></svg></button>`);
    clean(duo, "b", "duotone with strong glyph");
    const text = await inspect(`<button id="b" style="background:#f4f4f4;border:0">Save</button>`);
    clean(text, "b", "text button");
    const withText = await inspect(`<button id="b" style="background:#fff;border:0"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 4h16v16H4z" fill="#ccc"/></svg> Save</button>`);
    clean(withText, "b", "icon next to visible text");
    const native = await inspect(`<input id="c" type="checkbox">`);
    clean(native, "c", "unstyled native checkbox");
    const srText = await inspect(`<button id="b" style="background:#fff;border:0"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 4h16v16H4z" fill="#ccc"/></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Close</span></button>`);
    assert.equal(findingFor(srText, "b").length, 1, "screen-reader-only text does not count as a visible label");
    const raster = await inspect(`<button id="b" style="background:#fff;border:0"><img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></button>`);
    assert.equal(findingFor(raster, "b").length, 0);
    assert.match(gapFor(raster, "b")[0]?.reason ?? "", /Raster icon contrast is not measured/);
    const gradient = await inspect(`<button id="b" style="background:#fff;border:0"><svg viewBox="0 0 24 24" width="24" height="24"><defs><linearGradient id="g"><stop stop-color="#ccc"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#g)"/></svg></button>`);
    assert.equal(findingFor(gradient, "b").length, 0);
    assert.match(gapFor(gradient, "b")[0]?.reason ?? "", /Gradient or pattern icon paint/);
  }

  {
    const r = await inspect(`<div style="position:relative;width:300px;height:100px;margin:20px;background:#fff">
      <div style="position:absolute;inset:0;background:#202020"></div>
      <input id="stack" style="position:absolute;left:40px;top:30px;width:200px;height:30px;box-sizing:border-box;border:1px solid #2a2a2a;background:transparent">
    </div>`);
    const hit = findingFor(r, "stack");
    assert.equal(hit.length, 1, "border is measured against the painted sibling, not the white ancestor");
    assert.match(JSON.stringify(hit[0].evidence.adjacent), /32,\s*32,\s*32/);
  }

  {
    const r = await inspect(`<div style="position:relative;width:300px;height:100px;margin:20px;background:#fff">
      <div style="position:absolute;inset:0;background:#202020"></div>
      <input id="stack" style="position:absolute;left:40px;top:30px;width:200px;height:30px;box-sizing:border-box;border:1px solid #ffffff;background:transparent">
    </div>`);
    clean(r, "stack", "white border on dark sibling paint");
  }

  console.log("Appearance non-text contrast checks passed.");
} finally {
  await browser.close();
}
