import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { collectDesign } from "../tooling/appearance-check/dist/design.js";
import { analyzeDesign } from "../tooling/appearance-check/dist/metrics.js";
import { inspectRhythm } from "../tooling/appearance-check/dist/rhythm.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

async function open(html, options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:16px Arial}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installKit);
  return { page, context };
}

async function drift(html, options) {
  const { page, context } = await open(html, options);
  try {
    const sample = await page.evaluate(collectDesign);
    return analyzeDesign(sample).drift;
  } finally {
    await context.close();
  }
}

const driftFor = (result, id) => result.findings.filter(f => f.checkId === "AP019" && f.target.includes(id));
const spans = (color, n, prefix) => Array.from({ length: n }, (_, i) => `<span id="${prefix}${i}" style="color:${color}">word </span>`).join("");

try {
  // AP019 color drift
  {
    const result = await drift(`<p>${spans("#2563eb", 3, "maj")}<span id="minor" style="color:#2563ec">word</span></p>`);
    assert.equal(driftFor(result, "minor").length, 1, "chromatic near-duplicate is reported on the minor color");
    const finding = driftFor(result, "minor")[0];
    assert.ok(finding.related?.includes("maj0"), "related is the majority example");
    assert.ok(finding.evidence.deltaEOK > 0 && finding.evidence.deltaEOK < 0.02, "deltaEOK is inside the drift band");
    assert.equal(finding.checkId, "AP019");
    assert.ok(result.findings.every(f => f.confidence === "heuristic"));
  }
  {
    const result = await drift(`<p>${spans("#333", 3, "maj")}<span id="minor" style="color:#343434">word</span></p>`);
    assert.equal(driftFor(result, "minor").length, 1, "neutral channel delta of 1 is reported");
    assert.equal(driftFor(result, "minor")[0].evidence.channelDelta, 1);
  }
  {
    const result = await drift(`<p>${spans("#2563eb", 3, "maj")}<span id="minor" style="color:#1d4ed8">word</span></p>`);
    assert.equal(driftFor(result, "minor").length, 0, "a distinct blue is a deliberate step");
    assert.equal(result.skipped.length, 0);
  }
  {
    const boxes = Array.from({ length: 3 }, (_, i) => `<div id="bg${i}" style="background:#202020;height:20px">x</div>`).join("");
    const result = await drift(`${boxes}<div id="minor" style="background:#1c1c1c;height:20px">x</div>`);
    assert.equal(result.findings.filter(f => f.target.includes("minor")).length, 0, "neutral channel delta of 4 is a real step");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await drift(`<p><span id="a" style="color:#333">word</span><span id="minor" style="color:#343434">word</span></p>`);
    assert.equal(driftFor(result, "minor").length, 0, "no majority color means no drift");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await drift(`<p>${spans("#2563eb", 3, "maj")}<span id="minor" style="color:rgba(37,99,236,.5)">word</span></p>`);
    assert.equal(result.findings.length, 0, "translucent values are not sampled");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await drift(`<p>${spans("#2563eb", 3, "maj")}</p><pre><code id="minor" style="color:#2563ec">code</code></pre>`);
    assert.equal(result.findings.length, 0, "code content is not sampled");
    assert.equal(result.skipped.length, 0);
  }

  {
    const hex = n => "#" + n.toString(16).padStart(2, "0").repeat(3);
    const groups = Array.from({ length: 40 }, (_, i) => `<p style="margin:0;font:10px/10px Arial">${spans(hex(10 + 5 * i), 3, "m" + i + "_")}<span id="n${i}" style="color:${hex(11 + 5 * i)}">word</span></p>`).join("");
    const result = await drift(groups);
    assert.equal(result.findings.length, 20, "AP019 stops at 20 findings");
    assert.ok(result.skipped.some(s => s.checkId === "AP019" && /limit/i.test(s.reason)), "the reached cap is visible as a gap");
  }
  {
    const { page, context } = await open(`<style>body{background:#fff}</style><svg style="position:fixed;left:0;top:0;width:100%;height:100%"><rect width="100%" height="100%" fill="#2563eb"/></svg><p>x</p>`);
    try {
      const { metrics } = analyzeDesign(await page.evaluate(collectDesign));
      const white = metrics.palette.surfaces.find(entry => entry.color === "#ffffff");
      assert.ok((white?.share ?? 0) < 0.5, "a full-viewport SVG covers the white page background");
    } finally { await context.close(); }
  }

  // AP020 sibling rhythm
  const rhythm = async (html, enabled = ["AP020"], options = {}) => {
    const { page, context } = await open(html, options);
    try { return await page.evaluate(inspectRhythm, enabled); } finally { await context.close(); }
  };
  const list = (items, extra = {}) => `<ul style="margin:0;padding:0;list-style:none">${items.map((_, i) => `<li id="i${i + 1}" class="${extra[i + 1]?.cls ?? ""}" style="margin:0 0 ${extra[i + 1]?.mb ?? 8}px">Item ${i + 1}</li>`).join("")}</ul>`;
  {
    const html = list([1, 2, 3, 4, 5], { 3: { mb: 11 } });
    const result = await rhythm(html);
    const found = result.findings.filter(f => f.checkId === "AP020");
    assert.equal(found.length, 1, "a single deviating gap is reported once");
    assert.ok(found[0].target.includes("i4"), "finding is on the later element");
    assert.ok(found[0].related?.includes("i3"), "related is the earlier element");
    assert.equal(found[0].evidence.axis, "y");
    assert.equal((await rhythm(html, [])).findings.length, 0, "disabled check reports nothing");
  }
  {
    const result = await rhythm(`<div style="display:flex;flex-wrap:wrap">${Array.from({ length: 60 }, () => `<div style="width:100px">${list([1, 2, 3, 4, 5], { 3: { mb: 11 } })}</div>`).join("")}</div>`, ["AP020"], { viewport: { width: 1400, height: 1400 } });
    assert.equal(result.findings.length, 60, "no finding is dropped silently");
  }
  {
    const result = await rhythm(list([1, 2, 3, 4, 5]));
    assert.equal(result.findings.length, 0, "equal gaps");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await rhythm(list([1, 2, 3, 4, 5], { 3: { mb: 32 } }));
    assert.equal(result.findings.length, 0, "a deliberate group separator is not an outlier");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await rhythm(list([1, 2, 3], { 2: { mb: 14 } }));
    assert.equal(result.findings.length, 0, "runs shorter than 4 are ignored");
    assert.equal(result.skipped.length, 0);
  }
  {
    const result = await rhythm(list([1, 2, 3, 4, 5], { 2: { cls: "active" } }));
    assert.equal(result.findings.length, 0, "a state class on one member does not split or flag the run");
    assert.equal(result.skipped.length, 0);
  }

  // metrics
  {
    const { page, context } = await open(`<style>
      body{background:#fff;color:#111} .row{margin:0;padding:8px}
      button{border:0;margin:0;padding:8px 16px;background:#2563eb;color:#fff;font:14px Arial}
      .a{font:14px Arial;padding:8px;margin:0} .b{font:16px Arial;padding:16px;margin:0} .c{font:24px Arial;padding:24px;margin:0}
    </style><div class="a">small text here</div><div class="b">regular body text content for the page here</div><div class="c">large</div><button>Go</button>`);
    try {
      const { metrics } = analyzeDesign(await page.evaluate(collectDesign));
      assert.equal(metrics.palette.chromatic, 1);
      const hue = metrics.palette.hueFamilies[0].hue;
      assert.ok(hue >= 255 && hue <= 275, `hue ${hue}`);
      assert.equal(metrics.type.bodySize, 16);
      assert.deepEqual(metrics.type.sizes.map(s => s.px), [14, 16, 24]);
      assert.equal(metrics.spacing.baseUnit, 8);
      assert.ok(metrics.palette.surfaces.length >= 1 && metrics.palette.surfaces[0].color === "#ffffff");
    } finally { await context.close(); }
  }
  {
    const { page, context } = await open(`<style>.p{padding:13px;margin:0;border:0;background:#fff;color:#111}</style>
      <div class="p">a</div><div class="p">b</div><div class="p">c</div><div class="p">d</div>`);
    try {
      const { metrics, notes } = analyzeDesign(await page.evaluate(collectDesign));
      assert.ok(metrics.spacing.offGrid.some(entry => entry.px === 13), "13 px is off grid");
      assert.notEqual(metrics.spacing.baseUnit, 8);
      assert.ok(notes.layout?.some(note => /grid/.test(note)), "layout note reports the missing grid");
    } finally { await context.close(); }
  }
  {
    const { page, context } = await open(`<style>body{background:#000;color:#fff}</style><p style="margin:0">Dark theme body text</p>`, { colorScheme: "dark" });
    try {
      const { notes } = analyzeDesign(await page.evaluate(collectDesign));
      assert.ok(notes.color?.includes("Pure black main surface in dark theme"));
      assert.ok(notes.color?.includes("Pure white body text in dark theme"));
    } finally { await context.close(); }
  }
  {
    const { page, context } = await open(`<style>body{background:#000;color:#fff}</style><p style="margin:0">Light scheme body text</p>`, { colorScheme: "light" });
    try {
      const { notes } = analyzeDesign(await page.evaluate(collectDesign));
      assert.ok(!notes.color?.some(note => /dark theme/.test(note)), "dark-theme notes only apply in the dark scheme");
    } finally { await context.close(); }
  }
  console.log("Appearance design browser checks passed");
} finally {
  await browser.close();
}
