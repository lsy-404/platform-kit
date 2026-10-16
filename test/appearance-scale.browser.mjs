import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { collectDesign } from "../tooling/appearance-check/dist/design.js";
import { analyzeDesign } from "../tooling/appearance-check/dist/metrics.js";
import { designBaseline } from "../tooling/appearance-check/dist/tokens.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

async function analyze(html, baseline) {
  const context = await browser.newContext({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:14px Arial;color:#111;background:#fff}p,div{margin:0}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(installKit);
    return analyzeDesign(await page.evaluate(collectDesign), baseline);
  } finally {
    await context.close();
  }
}

const of = (result, id) => result.drift.findings.filter(f => f.checkId === id);
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i)).join("");

try {
  // AP024 type-scale drift
  {
    const result = await analyze(`${repeat(4, i => `<p id="p${i}">Body text</p>`)}<p><span id="minor" style="font-size:13px">label</span><span id="small" style="font-size:12px">tiny</span></p>`);
    const found = of(result, "AP024");
    assert.equal(found.length, 1, "only the 13 px neighbour of 14 px is drift");
    assert.equal(found[0].target, "span#minor");
    assert.equal(found[0].evidence.fontSize, 13);
    assert.equal(found[0].evidence.nearest, 14);
    assert.ok(result.notes.typography?.includes("Odd font sizes 13 px"));
  }

  // AP025 radius drift compares like with like
  {
    const card = (id, radius) => `<div id="${id}" style="height:60px;margin-bottom:8px;background:#eee;border-radius:${radius}px">card</div>`;
    const result = await analyze(repeat(4, i => card("c" + i, 12)) + card("odd", 10)
      + repeat(3, i => `<button id="b${i}" style="height:32px;border:0;background:#ddd;border-radius:8px">b</button>`)
      + `<span id="tag" style="display:inline-block;height:20px;background:#ddd;border-radius:4px">tag</span>`);
    const found = of(result, "AP025");
    assert.equal(found.length, 1, "buttons and tags are not compared with cards");
    assert.equal(found[0].target, "div#odd");
    assert.deepEqual([found[0].evidence.kind, found[0].evidence.radius, found[0].evidence.nearest], ["surface", 10, 12]);
  }

  // AP026 control size drift
  {
    const button = (id, height) => `<button id="${id}" style="height:${height}px;border:1px solid #888;background:#eee">b</button>`;
    const result = await analyze(repeat(4, i => button("n" + i, 32)) + button("near", 34) + button("compact", 28));
    const found = of(result, "AP026");
    assert.deepEqual(found.map(f => f.target), ["button#near"], "34 px drifts from 32 px; 28 px is a deliberate step");
    assert.deepEqual([found[0].evidence.height, found[0].evidence.nearest], [34, 32]);
  }

  // AP027 spacing grid with border-inclusive insets
  {
    const result = await analyze(repeat(6, i => `<div style="padding:8px 16px;margin-bottom:16px;border:1px solid #ccc">bordered ${i}</div>`)
      + `<div id="odd" style="padding:7px 8px;border:0">odd</div>`);
    assert.equal(result.metrics.spacing.baseUnit, 8, "1 px border plus 16 px padding still sits on the grid");
    const found = of(result, "AP027");
    assert.deepEqual(found.map(f => f.target), ["div#odd"]);
    assert.deepEqual([found[0].evidence.px, found[0].evidence.grid], [7, 8]);
    assert.ok(!result.notes.layout?.some(note => /grid/.test(note)));
  }

  // AP033 off-token values against a design baseline
  {
    const baseline = designBaseline({
      colors: { ink: "#111", canvas: "#fff", surface: "#eee" },
      typography: { body: { fontSize: "14px", fontWeight: 400 } },
      rounded: { lg: "12px" },
      spacing: { xs: "8px", md: "16px" },
    });
    const html = `<div style="padding:16px;background:#eee;border-radius:12px;height:60px">on token</div>
      <div id="off" style="padding:7px;background:#ff0000;border-radius:10px;height:60px;font-size:13px;font-weight:700">off token</div>
      <span id="pill" style="display:inline-block;padding:0 8px;height:24px;background:#eee;border-radius:999px">pill</span>`;
    const found = of(await analyze(html, baseline), "AP033");
    const kinds = Object.fromEntries(found.map(f => [f.evidence.kind + ":" + f.evidence.value, f.target]));
    assert.equal(kinds["color:#ff0000"], "div#off");
    assert.equal(kinds["font-size:13"], "div#off");
    assert.equal(kinds["font-weight:700"], "div#off");
    assert.equal(kinds["radius:10"], "div#off");
    assert.equal(kinds["spacing:7"], "div#off");
    assert.equal(kinds["radius:pill"], "span#pill", "a pill is off-token when no full radius is declared");
    assert.ok(!found.some(f => ["color:#111111", "color:#eeeeee", "radius:12", "spacing:16", "spacing:8", "font-size:14"].includes(f.evidence.kind + ":" + f.evidence.value)));
    const withFull = of(await analyze(html, designBaseline({ rounded: { lg: "12px", full: "9999px" } })), "AP033");
    assert.ok(!withFull.some(f => f.evidence.value === "pill"));
    assert.ok(of(await analyze(html), "AP033").length === 0, "AP033 needs a baseline");
  }
  console.log("Appearance scale browser checks passed");
} finally {
  await browser.close();
}
