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
    #bad:hover { color: #aaa; background: #fff; }
    #good:hover { color: #111; background: #fff; }
    #focus-bad:focus { color: #aaa; background: #fff; }
  </style>
  <button id="bad">Bad hover</button>
  <button id="good">Good hover</button>
  <button id="focus-bad">Bad focus</button>
  <button id="disabled" disabled>Disabled</button>
  <div id="hidden" style="display:none;color:#fff;background:#fff">Hidden</div>`);

  const defaultBad = await inspectColors(page, "default");
  assert.equal(defaultBad.findings.some(f => f.target === "#bad" || f.target === "#good"), false);
  assert.equal(defaultBad.skipped.some(f => f.target === "#disabled" || f.target === "#hidden"), false);

  await page.locator("#bad").hover();
  const hoverBad = await inspectColors(page, "hover", "#bad");
  assert(hoverBad.findings.some(f => f.checkId === "AP002" && f.target === "#bad"), "low-contrast hover text should fail");

  await page.locator("#good").hover();
  const hoverGood = await inspectColors(page, "hover", "#good");
  assert.equal(hoverGood.findings.length, 0, "adequate hover contrast should pass");

  await page.locator("#focus-bad").focus();
  const focusBad = await inspectColors(page, "focus", "#focus-bad");
  assert(focusBad.findings.some(f => f.checkId === "AP002" && f.target === "#focus-bad"), "low-contrast focus text should fail");

  await page.setContent(`<style>#uncertain { color:#fff; background-image:url('missing-image.png'); background-color:#fff }</style><span id="uncertain">Uncertain</span>`);
  const incomplete = await inspectColors(page, "default");
  assert(incomplete.skipped.some(f => f.checkId === "AP001" && f.target === "#uncertain"), "axe incomplete contrast should be reported as skipped");
} finally {
  await browser.close();
}
