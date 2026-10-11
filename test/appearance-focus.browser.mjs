import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { discoverControls, runInteractions } from "../tooling/appearance-check/dist/interaction.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

// Findings and gaps are keyed by the id of the element their target selector resolves to.
async function run(html, { enabled = ["AP012", "AP013"], viewport = { width: 800, height: 600 }, maxControls = 40 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>body{margin:0;background:#fff;color:#111;font:16px Arial}.s{display:block;margin:30px}</style>${html}`);
  await page.evaluate(installKit);
  await page.evaluate(() => document.fonts.ready);
  const controls = await page.evaluate(discoverControls);
  const raw = [];
  await runInteractions(page, controls, { enabled, maxControls }, async (result, state) => {
    for (const finding of result.findings) raw.push({ kind: "finding", state, ...finding });
    for (const gap of result.skipped) raw.push({ kind: "gap", state, ...gap });
  });
  const ids = await page.evaluate(targets => targets.map(t => document.querySelector(t)?.id ?? null), raw.map(x => x.target));
  const rows = raw.map((x, i) => ({ ...x, id: ids[i] }));
  await context.close();
  return {
    controls,
    findings: rows.filter(x => x.kind === "finding"),
    gaps: rows.filter(x => x.kind === "gap"),
  };
}
const findings = (r, id, checkId) => r.findings.filter(f => f.id === id && (!checkId || f.checkId === checkId));
const gaps = (r, id, checkId) => r.gaps.filter(g => g.id === id && (!checkId || g.checkId === checkId));

try {
  {
    const r = await run(`<button class="s" id="bare" style="outline:none">Bare</button>`);
    const hit = findings(r, "bare", "AP012");
    assert.equal(hit.length, 1, "removed outline without replacement is a finding");
    assert.equal(hit[0].message, "No visible change when the control receives keyboard focus.");
    assert.equal(hit[0].evidence.styleChanged, false);
    assert(hit[0].evidence.changedPixels < 4);
    assert.equal(gaps(r, "bare").length, 0);

    const leak = await run(`<button class="s" id="bare" style="outline:none">Bare</button>`, { enabled: ["AP013"] });
    assert.equal(findings(leak, "bare", "AP012").length, 0, "disabling AP012 removes the finding");
  }

  {
    const r = await run(`<style>
        .ring:focus-visible{outline:none;box-shadow:0 0 0 3px #0057b8}
        .tint{border:1px solid #888;background:#fff}
        .tint:focus-visible{outline:none;background:#e0e0e0}
        .sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}
        .pick{display:inline-block;width:20px;height:20px;border:1px solid #333;vertical-align:middle}
        .sr:focus-visible + .pick{outline:2px solid #000;outline-offset:2px}
      </style>
      <button class="s" id="ua">Default ring</button>
      <button class="s ring" id="ring">Shadow ring</button>
      <button class="s tint" id="tint">Tint only</button>
      <label class="s" id="lab"><input class="sr" id="sr" type="checkbox"><span class="pick"></span> Option</label>`);
    for (const id of ["ua", "ring", "tint", "sr"]) {
      assert.equal(findings(r, id, "AP012").length, 0, id + " shows a focus indicator");
      assert.equal(gaps(r, id, "AP012").length, 0, id + " produces no gap");
    }
  }

  {
    const r = await run(`<input class="s" id="caret" style="outline:none"><div class="s" id="delegate" tabindex="0" onfocus="this.querySelector('input').focus()"><input id="inner"></div>`);
    assert.equal(findings(r, "caret").length, 0, "caret-only is never a finding");
    const caret = gaps(r, "caret", "AP012");
    assert.equal(caret.length, 1);
    assert.equal(caret[0].reason, "Only the text caret indicates focus; needs review");
    const moved = gaps(r, "delegate", "AP012");
    assert.equal(moved.length, 1);
    assert.equal(moved[0].reason, "Focus moved elsewhere");
    assert.equal(findings(r, "delegate").length, 0);
  }

  {
    const banner = background => `<div id="banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:${background}">Cookie banner</div>`;
    const button = top => `<button id="under" style="position:absolute;left:20px;top:${top}px">Target</button>`;
    const only = { enabled: ["AP013"] };

    const hit = await run(button(520) + banner("#fff"), only);
    const found = findings(hit, "under", "AP013");
    assert.equal(found.length, 1, "button wholly under an opaque fixed banner");
    assert.equal(found[0].message, "Focused control is entirely hidden by fixed or sticky content.");
    assert.equal(found[0].related, "div#banner");
    assert.equal(found[0].evidence.obscurerPosition, "fixed");
    assert.equal(gaps(hit, "under").length, 0);

    const leak = await run(button(520) + banner("#fff"), { enabled: ["AP012"] });
    assert.equal(findings(leak, "under", "AP013").length, 0, "disabling AP013 removes the finding");

    const translucent = await run(button(520) + banner("rgba(255,255,255,.6)"), only);
    assert.equal(findings(translucent, "under", "AP013").length, 0, "translucent banner does not hide the control");
    assert.equal(gaps(translucent, "under", "AP013").length, 0);

    const high = await run(button(100) + banner("#fff"), only);
    assert.equal(findings(high, "under", "AP013").length, 0, "control above the banner");

    const cover = position => `<button id="under" style="position:absolute;left:20px;top:100px;width:100px;height:30px">Target</button><div id="cover" style="position:${position};left:0;top:90px;width:200px;height:60px;z-index:1;background:#fff"></div>`;
    const overlay = await run(cover("absolute"), only);
    assert.equal(findings(overlay, "under", "AP013").length, 0, "an opaque overlay that is neither fixed nor sticky is not reported");
    assert.equal(gaps(overlay, "under", "AP013").length, 0);
    const overlayFixed = await run(cover("fixed"), only);
    assert.equal(findings(overlayFixed, "under", "AP013").length, 1, "the same overlay with position:fixed hides the control");
    assert.equal(gaps(high, "under", "AP013").length, 0);

    const sr = await run(`<input id="sr" type="checkbox" style="position:absolute;left:20px;top:560px;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)">` + banner("#fff"), only);
    assert.equal(findings(sr, "sr", "AP013").length, 0, "1x1 screen-reader-only input is not sampled");
    assert.equal(gaps(sr, "sr", "AP013").length, 0);

    const sticky = await run(`<div id="bar" style="position:sticky;top:0;z-index:1;height:60px;background:#fff"></div><button id="under" style="position:absolute;left:20px;top:10px">Target</button>`, only);
    assert.equal(findings(sticky, "under", "AP013").length, 1, "sticky content hides the control as well");
    assert.equal(findings(sticky, "under", "AP013")[0].evidence.obscurerPosition, "sticky");
  }

  {
    const long = `<a class="s" id="top" href="#">Top</a><a id="far" href="#" style="position:absolute;left:20px;top:2000px">Far link</a><div style="height:3000px"></div><button id="accept" style="position:fixed;right:10px;bottom:10px">Accept</button>`;
    const r = await run(long, { enabled: ["AP012", "AP013"] });
    assert.equal(gaps(r, "accept").length, 0, "a below-the-fold link elsewhere must not make a fixed control a gap");

    const under = `<a class="s" id="top" href="#">Top</a><button id="under" style="position:absolute;left:20px;top:520px">Target</button><a id="far" href="#" style="position:absolute;left:20px;top:2000px">Far link</a><div style="height:3000px"></div><div id="banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff">Cookie banner</div>`;
    const u = await run(under, { enabled: ["AP013"] });
    assert.equal(findings(u, "under", "AP013").length, 1, "a control under the banner is still found when an unrelated far link exists");
  }

  {
    const many = Array.from({ length: 5 }, (_, i) => `<button class="s" id="c${i}">Control ${i}</button>`).join("");
    const r = await run(many, { enabled: ["AP012"], maxControls: 2 });
    assert.equal(r.controls.length, 5);
    const limited = r.gaps.filter(g => /limit/i.test(g.reason));
    assert.equal(limited.length, 1, "a reached cap is reported once per enabled check");
    assert.equal(limited[0].checkId, "AP012");
    assert.match(limited[0].reason, /3/);
  }

  console.log("Appearance focus checks passed.");
} finally {
  await browser.close();
}
