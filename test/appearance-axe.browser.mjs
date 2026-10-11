import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runAxe, inspectDefaultAxe, inspectDocumentAxe } from "../tooling/appearance-check/dist/axe.js";
import { inspectColors } from "../tooling/appearance-check/dist/colors.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

const ALL = ["AP001", "AP009", "AP010"];
const DOC = ["AP011", "AP018"];

function has(result, checkId, target) {
  return result.findings.some(f => f.checkId === checkId && f.target === target);
}
function untouched(result, target) {
  return !result.findings.some(f => f.target === target) && !result.skipped.some(s => s.target === target);
}

try {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const load = async html => {
    await page.setContent(`<!doctype html><html lang="en"><head><title>t</title><style>body{font-family:Arial,sans-serif;margin:8px}</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
  };

  // AP009
  const linkHtml = decoration => `<style>body{color:#222}</style><p>Read <a id="l" href="#" style="color:#444;text-decoration:${decoration}">terms</a> now.</p>`;
  await load(linkHtml("none"));
  const linkBad = await inspectDefaultAxe(page, ALL);
  const linkFinding = linkBad.findings.find(f => f.checkId === "AP009" && f.target === "#l");
  assert(linkFinding, "color-only link should fail AP009");
  assert.equal(linkFinding.confidence, "measured");
  assert.equal(linkFinding.evidence.rule, "link-in-text-block");
  const linkOff = await inspectDefaultAxe(page, ["AP001", "AP010"]);
  assert(!linkOff.findings.some(f => f.checkId === "AP009"), "disabled AP009 must not report");
  await load(linkHtml("underline"));
  assert(untouched(await inspectDefaultAxe(page, ALL), "#l"), "underlined link should pass without a gap");

  // AP010
  const buttons = (css, ids) => `<div style="display:flex">${ids.map(id => `<button id="${id}" aria-label="${id}" style="${css}"></button>`).join("")}</div>`;
  await load(buttons("width:16px;height:16px;padding:0;margin:0 1px;border:1px solid #000", ["a", "b"]));
  const sizeBad = await inspectDefaultAxe(page, ALL);
  assert(has(sizeBad, "AP010", "#a") && has(sizeBad, "AP010", "#b"), "tight 16px targets should fail AP010");
  assert(!(await inspectDefaultAxe(page, ["AP001", "AP009"])).findings.some(f => f.checkId === "AP010"), "disabled AP010 must not report");
  await load(buttons("width:16px;height:16px;padding:0;margin:0 12px;border:1px solid #000", ["a", "b"]));
  const sizeSpaced = await inspectDefaultAxe(page, ALL);
  assert(untouched(sizeSpaced, "#a") && untouched(sizeSpaced, "#b"), "16px targets 40px apart pass");
  await load(buttons("width:24px;height:24px;padding:0;margin:0;border:1px solid #000", ["a"]));
  assert(untouched(await inspectDefaultAxe(page, ALL), "#a"), "24px target passes");
  await load(`<p>Please read the <a id="inl" href="#" style="text-decoration:underline">linked terms of service</a> before you continue to use this page.</p>`);
  assert(untouched(await inspectDefaultAxe(page, ALL), "#inl"), "inline link in a sentence is exempt");

  // Option-bug guard
  await load(buttons("width:16px;height:16px;padding:0;margin:0 1px", ["a", "b"]) + `<p style="color:#ccc">low contrast</p><h3>x</h3>`);
  const only = await runAxe(page, ["target-size"]);
  const ids = new Set([...only.passes, ...only.violations, ...only.incomplete].map(r => r.id));
  assert([...ids].every(id => id === "target-size"), `runAxe must run only the requested rule, saw ${[...ids]}`);
  assert(only.violations.some(r => r.id === "target-size"), "target-size should still run when it is not a default rule");

  // AP011
  const vp = content => `<meta name="viewport" content="${content}">`;
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title>${vp("width=device-width,user-scalable=no")}</head><body><p>x</p></body></html>`);
  const zoomBad = await inspectDocumentAxe(page, DOC);
  const zoomFinding = zoomBad.findings.find(f => f.checkId === "AP011");
  assert(zoomFinding, "user-scalable=no should fail AP011");
  assert.equal(zoomFinding.evidence.data.value, "user-scalable=no");
  assert.equal("0" in zoomFinding.evidence.data, false, "string check data is not spread into character keys");
  assert(!(await inspectDocumentAxe(page, ["AP018"])).findings.some(f => f.checkId === "AP011"), "disabled AP011 must not report");
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title>${vp("width=device-width,initial-scale=1")}</head><body><p>x</p></body></html>`);
  const zoomOk = await inspectDocumentAxe(page, DOC);
  assert.equal(zoomOk.findings.length, 0);
  assert.equal(zoomOk.skipped.length, 0);

  // AP018
  await load(`<h1>A</h1><h3 id="skip">B</h3>`);
  const skip = await inspectDocumentAxe(page, DOC);
  const skipFinding = skip.findings.find(f => f.checkId === "AP018" && f.target === "#skip");
  assert(skipFinding, "skipped heading level should be reported");
  assert.equal(skipFinding.message, "Heading level skipped.");
  assert(!(await inspectDocumentAxe(page, ["AP011"])).findings.some(f => f.checkId === "AP018"), "disabled AP018 must not report");
  await load(`<h1>A</h1><h2 id="empty"></h2>`);
  const empty = await inspectDocumentAxe(page, DOC);
  const emptyFinding = empty.findings.find(f => f.checkId === "AP018" && f.target === "#empty");
  assert(emptyFinding, "empty heading should be reported");
  assert.equal(emptyFinding.message, "Heading has no text.");
  await load(`<h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3><h2 id="d">D</h2>`);
  const orderOk = await inspectDocumentAxe(page, DOC);
  assert.equal(orderOk.findings.length, 0, "ordered headings and going up levels pass");
  assert.equal(orderOk.skipped.length, 0);

  // AP001 evidence
  await load(`<p id="small" style="font-size:16px;color:#aaa">Small low contrast</p>`);
  const small = (await inspectColors(page, "default")).findings.find(f => f.checkId === "AP001" && f.target === "#small");
  assert(small, "16px #aaa on white should fail");
  assert.equal(small.evidence.requiredRatio, 4.5);
  assert.equal(small.evidence.largeText, false);
  assert.equal(small.evidence.contrastRatio, 2.32, "#aaa on white is 2.32:1");
  assert.ok(Math.abs(small.evidence.margin - 2.18) < 0.011);
  await load(`<p id="big" style="font-size:24px;color:#969696">Large low contrast</p>`);
  const big = (await inspectColors(page, "default")).findings.find(f => f.target === "#big");
  assert(big, "24px #969696 (2.96:1) should fail the 3:1 requirement");
  assert.equal(big.evidence.requiredRatio, 3);
  assert.equal(big.evidence.largeText, true);
  await load(`<p id="ok" style="font-size:24px;color:#949494">Large adequate contrast</p>`);
  assert(untouched(await inspectColors(page, "default"), "#ok"), "24px #949494 (3.03:1) passes");
  await load(`<div id="host"></div>`);
  await page.evaluate(() => document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<p style="color:#bbb">Shadow low contrast</p>');
  const shadow = await inspectDefaultAxe(page, ALL);
  assert(shadow.skipped.some(s => s.checkId === "AP001" && s.target === "document" && /multi-part/.test(s.reason)), "shadow DOM nodes give a multi-part gap");
  assert.equal(shadow.findings.filter(f => f.checkId === "AP001").length, 0, "shadow DOM nodes give no finding");
  await load(`<p id="grad" style="color:#777;background:linear-gradient(90deg,#fff,#000)">Over gradient</p>`);
  const grad = await inspectColors(page, "default");
  assert(grad.skipped.some(s => s.checkId === "AP001" && s.target === "#grad" && /gradient/.test(s.reason)), "gradient backgrounds give a gap naming the gradient");
  assert(!grad.findings.some(f => f.target === "#grad"), "gradient gives a gap, not a finding");

  // Default scan also reports AP001 and honours its flag
  await load(`<p id="small" style="color:#aaa">Low</p>`);
  assert(has(await inspectDefaultAxe(page, ALL), "AP001", "#small"));
  assert.equal((await inspectDefaultAxe(page, ["AP009", "AP010"])).findings.length, 0, "disabled AP001 must not report");
} finally {
  await browser.close();
}
