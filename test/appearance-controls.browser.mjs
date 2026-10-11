import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { auditAppearance } from "../tooling/appearance-check/dist/index.js";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { discoverControls, runInteractions } from "../tooling/appearance-check/dist/interaction.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

test("inspects visible associated labels of decorated checkboxes and radios in both interaction states", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><style>
      body {margin:24px; color:#111; background:#fff; font:16px Arial}
      label {position:relative; display:flex; gap:8px; align-items:center; width:260px; padding:8px; background:#fff}
      input {position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%)}
      .box {width:20px; height:20px; background:#123}
      label:hover .caption, label:has(input:focus-visible) .caption {color:#fff}
      #external-label:hover, body:has(#radio:focus-visible) #external-label {color:#fff}
    </style>
    <label id="wrapped"><input id="checkbox" type="checkbox"><span class="box"></span><span class="caption" id="checkbox-caption">Checkbox label</span></label>
    <input id="radio" type="radio"><label id="external-label" for="radio">Radio label</label>
    <label><input type="checkbox" disabled><span class="caption" id="disabled-caption">Disabled label</span></label>
    <label style="display:none"><input type="checkbox"><span class="caption">Hidden label</span></label>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const report = await auditAppearance({urls:[`http://127.0.0.1:${server.address().port}`], checks:["AP002"], viewports:[{width:800,height:600}], executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
    assert.equal(report.pages[0].controls, 2);
    for (const state of ["hover", "focus"]) {
      assert(report.findings.some(finding => finding.state === state && ["#checkbox-caption", "#wrapped"].includes(finding.target)), `checkbox ${state} label contrast must be checked`);
      assert(report.findings.some(finding => finding.state === state && finding.target === "#external-label"), `radio ${state} label contrast must be checked`);
    }
    assert(!report.findings.some(finding => finding.target === "#disabled-caption"));
    assert.deepEqual(report.coverage, []);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("runs hover and focus color inspection only for enabled interaction checks", async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><style>
      body{margin:24px;font:16px Arial;background:#fff;color:#111}
      button{display:block;margin:12px;padding:8px;border:1px solid #888;background:#fff;color:#111}
      #a:hover,#a:focus-visible{color:#fff}
      #b:hover,#b:focus-visible{color:#fff}
    </style><button id="a">First</button><button id="b">Second</button><button id="c" disabled>Off</button><a id="hidden" href="#" style="display:none">x</a>`);
    await page.evaluate(installKit);
    const controls = await page.evaluate(discoverControls);
    assert.deepEqual(controls.map(c => c.target.replace(/^.*#/, "")), ["a", "b"], "disabled and hidden controls are not discovered");

    const collect = async (enabled, maxControls = 40) => {
      const rows = [];
      await runInteractions(page, controls, { enabled, maxControls }, async (result, state) => {
        for (const finding of result.findings) rows.push({ kind: "finding", state, ...finding });
        for (const gap of result.skipped) rows.push({ kind: "gap", state, ...gap });
      });
      return rows;
    };

    const both = await collect(["AP002"]);
    for (const state of ["hover", "focus"]) for (const id of ["a", "b"]) {
      assert(both.some(r => r.kind === "finding" && r.checkId === "AP002" && r.state === state && r.target.endsWith("#" + id)), `${id} ${state} contrast is inspected`);
    }

    const none = await collect(["AP012"]);
    assert.deepEqual(none.filter(r => r.checkId === "AP002"), [], "AP002 does not run when it is disabled");

    const limited = await collect(["AP002"], 1);
    assert(!limited.some(r => r.kind === "finding" && r.target.endsWith("#b")), "controls past the limit are not inspected");
    assert(limited.some(r => r.kind === "gap" && r.checkId === "AP002" && /limit/i.test(r.reason)), "the limit is reported as a gap");
    await context.close();
  } finally { await browser.close(); }
});
