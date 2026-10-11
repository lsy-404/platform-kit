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
  assert.equal(normalFinding.evidence.requiredRatio, 4.5);
  assert.equal(normalFinding.evidence.largeText, false);
  assert.ok(Math.abs(normalFinding.evidence.margin - (4.5 - 1.28)) < 0.011);
  const scopedDefault = await inspectColors(page, "default", "#normal-bad");
  assert(scopedDefault.findings.some(f => f.target === "#normal-bad"), "default inspection should accept a target scope");
  assert.equal(defaultBad.findings.some(f => f.target === "#bad" || f.target === "#good"), false);
  assert.equal(defaultBad.skipped.some(f => f.target === "#disabled" || f.target === "#hidden"), false);

  await page.locator("#bad").hover();
  const hoverBad = await inspectColors(page, "hover", "#bad");
  assert(hoverBad.findings.some(f => f.checkId === "AP002" && f.target === "#bad"), "low-contrast hover text should fail");

  await page.locator("#equal").hover();
  const hoverEqual = await inspectColors(page, "hover", "#equal");
  const equalFinding = hoverEqual.findings.find(f => f.checkId === "AP002" && f.evidence.contrastRatio === 1);
  assert(equalFinding, "identical hover text and fill colors should fail");
  assert.equal(equalFinding.evidence.foreground, equalFinding.evidence.background);
  assert.equal(equalFinding.target, "span", "the finding names the text-bearing element axe reports");
  assert.equal(hoverEqual.skipped.some(f => f.target === "#equal" || f.target === "span"), false, "exact same-color evidence should resolve axe's incomplete result");
  assert.equal(hoverEqual.findings.filter(f => f.checkId === "AP002").length, 1, "one visual defect is one finding");

  await page.locator("#good").hover();
  const hoverGood = await inspectColors(page, "hover", "#good");
  assert.equal(hoverGood.findings.length, 0, "adequate hover contrast should pass");
  assert.equal(hoverGood.skipped.some(s => s.target === "#good"), false, "adequate hover contrast must not bail out to a gap");

  await page.locator("#focus-bad").focus();
  const focusBad = await inspectColors(page, "focus", "#focus-bad");
  assert(focusBad.findings.some(f => f.checkId === "AP002" && f.target === "#focus-bad"), "low-contrast focus text should fail");

  await assert.rejects(() => inspectColors(page, "hover"), /target is required/);

  await page.setContent(`<style>body{background:#fff;color:#111} #invisible{color:#fff;background:#fff}</style><span id="invisible">Same default colors</span>`);
  const equalDefault = await inspectColors(page, "default");
  assert(equalDefault.findings.some(f => f.checkId === "AP001" && f.target === "#invisible" && f.evidence.contrastRatio === 1));
  await page.setContent(`<style>body{background:#fff} #outlined{color:#fff;background:#fff;text-shadow:1px 0 #000,-1px 0 #000}</style><span id="outlined">Outlined text</span>`);
  const outlined = await inspectColors(page, "default");
  assert(!outlined.findings.some(f => f.evidence.foreground === f.evidence.background && f.evidence.contrastRatio === 1), "text shadows need separate paint analysis");
  assert.equal(outlined.findings.some(f => f.target === "#outlined"), false, "outlined text must not produce any finding");

  // negative twins of #invisible: the backdrop is painted outside the ancestor chain
  await page.setContent(`<style>body{background:#fff;margin:0} .hero{position:relative;height:60px} .hero::before{content:"";position:absolute;inset:0;background:#000} #pseudo{position:relative;color:#fff}</style><div class="hero"><p id="pseudo">White on a dark pseudo-element</p></div>`);
  const pseudo = await inspectColors(page, "default");
  assert.equal(pseudo.findings.some(f => f.target === "#pseudo"), false, "a dark ::before backdrop is not same-color text");
  assert(pseudo.skipped.some(f => f.target === "#pseudo" && /pseudo-element content/.test(f.reason)), "the pseudo-element backdrop is a gap");
  await page.setContent(`<style>body{background:#fff;margin:0} #dark{position:absolute;left:0;top:0;width:300px;height:80px;background:#000} #ghost{position:absolute;left:10px;top:10px;color:#fff;background:transparent;border:0;padding:12px}</style><div id="dark"></div><button id="ghost">Ghost</button>`);
  await page.locator("#ghost").hover();
  const ghost = await inspectColors(page, "hover", "#ghost");
  assert.equal(ghost.findings.some(f => f.target === "#ghost" || f.target === "#ghost span"), false, "a transparent button over a dark sibling is not same-color text");
  await page.locator("#ghost").focus();
  const ghostFocus = await inspectColors(page, "focus", "#ghost");
  assert.equal(ghostFocus.findings.length, 0);
  await page.setContent(`<style>#uncertain { color:#fff; background-image:url('missing-image.png'); background-color:#fff }</style><span id="uncertain">Uncertain</span>`);
  const incomplete = await inspectColors(page, "default");
  assert(incomplete.skipped.some(f => f.checkId === "AP001" && f.target === "#uncertain"), "axe incomplete contrast should be reported as skipped");
  assert(incomplete.skipped.some(f => f.target === "#uncertain" && /background image/.test(f.reason)), "gap reason should name the axe message key");
} finally {
  await browser.close();
}
