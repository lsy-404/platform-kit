import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inspectColors } from "../tooling/appearance-check/dist/colors.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>
    button { color: #fff; background: #146c43; border: 0; padding: 12px; }
    #normal-bad { color: #777; background: #666; }
    #bad:hover { color: #aaa; background: #fff; }
    #equal:hover { color: #fff; background: #fff; }
    #good:hover { color: #111; background: #fff; }
    #focus-bad:focus { color: #aaa; background: #fff; }
  </style>
  <button id="bad">Bad hover</button>
  <button id="equal"><span>Equal hover</span></button>
  <button id="good">Good hover</button>
  <button id="focus-bad">Bad focus</button>
  <button id="normal-bad">Bad default</button>
  <button id="disabled" disabled>Disabled</button>
  <div id="hidden" style="display:none;color:#fff;background:#fff">Hidden</div>`);

  const defaultBad = await inspectColors(page, "default");
  const normalFinding = defaultBad.findings.find(f => f.target === "#normal-bad" && f.checkId === "AP001");
  assert(normalFinding, "low-contrast default text should fail");
  assert.equal(normalFinding.evidence.contrastRatio, 1.28);
  assert.equal(normalFinding.evidence.fgColor, "#777777");
  assert.equal(normalFinding.evidence.bgColor, "#666666");
  const scopedDefault = await inspectColors(page, "default", "#normal-bad");
  assert(scopedDefault.findings.some(f => f.target === "#normal-bad"), "default inspection should accept a target scope");
  assert.equal(defaultBad.findings.some(f => f.target === "#bad" || f.target === "#good"), false);
  assert.equal(defaultBad.skipped.some(f => f.target === "#disabled" || f.target === "#hidden"), false);

  await page.locator("#bad").hover();
  const hoverBad = await inspectColors(page, "hover", "#bad");
  assert(hoverBad.findings.some(f => f.checkId === "AP002" && f.target === "#bad"), "low-contrast hover text should fail");

  await page.locator("#equal").hover();
  const hoverEqual = await inspectColors(page, "hover", "#equal");
  const equalFinding = hoverEqual.findings.find(f => f.checkId === "AP002" && f.target === "#equal" && f.evidence.contrastRatio === 1);
  assert(equalFinding, "identical hover text and fill colors should fail");
  assert.equal(equalFinding.evidence.foreground, equalFinding.evidence.background);
  assert.equal(hoverEqual.skipped.some(f => f.target === "#equal"), false, "exact same-color evidence should resolve axe's incomplete result");

  await page.locator("#good").hover();
  const hoverGood = await inspectColors(page, "hover", "#good");
  assert.equal(hoverGood.findings.length, 0, "adequate hover contrast should pass");

  await page.locator("#focus-bad").focus();
  const focusBad = await inspectColors(page, "focus", "#focus-bad");
  assert(focusBad.findings.some(f => f.checkId === "AP002" && f.target === "#focus-bad"), "low-contrast focus text should fail");

  await assert.rejects(() => inspectColors(page, "hover"), /target is required/);

  await page.setContent(`<style>#uncertain { color:#fff; background-image:url('missing-image.png'); background-color:#fff }</style><span id="uncertain">Uncertain</span>`);
  const incomplete = await inspectColors(page, "default");
  assert(incomplete.skipped.some(f => f.checkId === "AP001" && f.target === "#uncertain"), "axe incomplete contrast should be reported as skipped");
} finally {
  await browser.close();
}
