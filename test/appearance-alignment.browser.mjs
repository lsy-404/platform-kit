import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { inspectShapes } from "../tooling/appearance-check/dist/shapes.js";
import { inspectAlignment } from "../tooling/appearance-check/dist/alignment.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

async function inspect(html, inspector, ids) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:16px;font:16px Arial;color:#111;background:#fff}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(installKit);
    return await page.evaluate(inspector, ids);
  } finally {
    await context.close();
  }
}

const targets = (result, id) => result.findings.filter(f => f.checkId === id).map(f => f.target);

try {
  // AP028 near-pill corners
  {
    const button = (id, radius) => `<button id="${id}" style="height:32px;width:90px;border:0;background:#ddd;border-radius:${radius}">b</button>`;
    const result = await inspect(button("near", "14px") + button("pill", "999px") + button("half", "16px") + button("rounded", "8px"), inspectShapes, ["AP028"]);
    assert.deepEqual(targets(result, "AP028"), ["button#near"]);
    assert.deepEqual(result.findings[0].evidence, { radius: 14, height: 32, width: 90, pillRadius: 16 });
  }

  // AP029 dialog corners against the page's cards
  {
    const cards = `<div style="width:200px;height:80px;background:#eee;border-radius:12px"></div><div style="width:200px;height:80px;background:#eee;border-radius:12px"></div>`;
    const dialog = (style) => `<dialog open id="dlg" style="top:200px;width:300px;padding:16px;border:1px solid #888;${style}">Dialog</dialog>`;
    const smaller = await inspect(cards + dialog("border-radius:6px"), inspectShapes, ["AP029"]);
    assert.deepEqual(targets(smaller, "AP029"), ["dialog#dlg"]);
    assert.deepEqual([smaller.findings[0].evidence.overlayRadius, smaller.findings[0].evidence.cardRadius], [6, 12]);
    assert.equal((await inspect(cards + dialog("border-radius:16px"), inspectShapes, ["AP029"])).findings.length, 0);
    assert.equal((await inspect(cards + dialog("border-radius:0;margin:0;top:0;left:0;width:100vw;max-width:none;height:100vh;max-height:none"), inspectShapes, ["AP029"])).findings.length, 0, "full-screen sheets keep square corners");
    assert.equal((await inspect(dialog("border-radius:6px"), inspectShapes, ["AP029"])).findings.length, 0, "no cards, no comparison");
  }

  // AP030 side-by-side controls
  {
    const row = (inputStyle, buttonStyle) => `<div style="display:flex;gap:8px;align-items:flex-start"><input id="q" style="height:32px;border:1px solid #888;${inputStyle}"><button id="go" style="border:1px solid #888;background:#eee;${buttonStyle}">Go</button></div>`;
    const taller = await inspect(row("", "height:36px"), inspectAlignment, ["AP030"]);
    assert.deepEqual(targets(taller, "AP030"), ["button#go"]);
    assert.equal(taller.findings[0].evidence.kind, "height");
    const offset = await inspect(row("", "height:32px;margin-top:4px"), inspectAlignment, ["AP030"]);
    assert.deepEqual(offset.findings.map(f => f.evidence.kind), ["offset"]);
    assert.equal((await inspect(row("", "height:32px"), inspectAlignment, ["AP030"])).findings.length, 0);
    assert.equal((await inspect(`<input style="height:32px;border:1px solid #888"><div style="height:200px"></div><button style="height:40px;border:1px solid #888">Far</button>`, inspectAlignment, ["AP030"])).findings.length, 0, "controls on different rows are not compared");
  }

  // AP031 inline icon beside its label
  {
    const icon = `<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>`;
    const baseline = await inspect(`<a id="link" href="#">${icon}Settings</a>`, inspectAlignment, ["AP031"]);
    assert.equal(baseline.findings.length, 1, "a baseline-aligned inline svg sits above the text center");
    assert.ok(baseline.findings[0].evidence.offset < 0);
    assert.equal((await inspect(`<a href="#" style="display:inline-flex;align-items:center;gap:4px">${icon}<span>Settings</span></a>`, inspectAlignment, ["AP031"])).findings.length, 0);
    assert.equal((await inspect(`<p style="width:120px">${icon}A label long enough to wrap over two lines</p>`, inspectAlignment, ["AP031"])).findings.length, 0, "multi-line labels are skipped");
  }

  // AP032 numeric table columns
  {
    const table = (style) => `<table style="font-family:FreeSans;${style}"><tbody>${["1,111", "8,888", "4,190"].map((value, i) => `<tr><td>Row ${i}</td><td>${value}</td></tr>`).join("")}</tbody></table>`;
    const proportional = await inspect(table("font-variant-numeric:proportional-nums"), inspectAlignment, ["AP032"]);
    assert.equal(proportional.findings.length, 1);
    assert.equal(proportional.findings[0].evidence.column, 2);
    assert.deepEqual(proportional.findings[0].evidence.samples, ["1,111", "8,888", "4,190"]);
    assert.equal((await inspect(table("font-variant-numeric:tabular-nums"), inspectAlignment, ["AP032"])).findings.length, 0);
    assert.equal((await inspect(table(""), inspectAlignment, ["AP032"])).findings.length, 0, "FreeSans defaults to tabular figures");
  }
  console.log("Appearance shape and alignment browser checks passed");
} finally {
  await browser.close();
}
