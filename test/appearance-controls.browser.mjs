import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { auditAppearance } from "../tooling/appearance-check/dist/index.js";

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
