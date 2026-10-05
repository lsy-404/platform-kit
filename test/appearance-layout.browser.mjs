import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { inspectLayout } from "../tooling/appearance-check/dist/layout.js";

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box } body { font: 16px Arial; margin: 24px }
    .overlap { height: 70px } .overlap span { display: inline-block }
    .clip { width: 90px; overflow: hidden; white-space: nowrap }
    .ellipsis { width: 90px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
    .bad-label { display: block; width: 70px }
    .ordinary-copy { width: 70px }
    .weak h2 { font-size: 12px; font-weight: 400; margin: 0 } .weak p { font-size: 20px; font-weight: 600; margin: 0 }
    .strong h2 { font-size: 28px; font-weight: 700; margin: 0 } .strong p { font-size: 16px; font-weight: 400; margin: 0 }
    button { display: inline-flex; width: 48px; height: 48px; padding: 0; align-items: center; justify-content: center }
    svg { width: 24px; height: 24px }
    .surfaces, .surfaces > div, .surfaces > div > div { border: 1px solid #777; padding: 14px; margin: 8px }
    .two-surfaces { border: 1px solid #777; padding: 14px } .two-surfaces > div { border: 1px solid #777; padding: 14px }
  </style></head><body>
    <div class="overlap"><span data-testid="overlap-a">Alpha overlap text</span><span data-testid="overlap-b" style="transform:translateX(-90px)">Beta overlap text</span></div>
    <div id="clear-overlap">Separate lines of readable text</div>
    <div data-testid="overlay-base" style="position:relative">Content behind the intentional tooltip</div>
    <div data-testid="intentional-tooltip" role="tooltip" style="position:absolute;top:24px;left:24px">Intentional overlay tooltip</div>
    <div class="clip" data-testid="clip">This text is much too long for its clipping container</div>
    <div class="ellipsis" data-testid="ellipsis">This long text is intentionally truncated</div>
    <label class="bad-label" data-testid="bad-label">Label with words wrapping across too many lines</label>
    <p class="ordinary-copy" data-testid="ordinary-copy">Ordinary paragraph text can naturally flow across several lines.</p>
    <section class="weak"><h2 data-testid="weak-heading">Weak section heading</h2><p>Prominent nearby body content</p></section>
    <section class="strong"><h2 data-testid="strong-heading">Clear strong heading</h2><p>Smaller nearby body copy</p></section>
    <button data-testid="shifted-icon" aria-label="Shifted icon"><svg viewBox="0 0 24 24"><path d="M12 2h8v8h-8z" fill="black"/></svg></button>
    <button data-testid="centered-icon" aria-label="Centered icon"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="black"/></svg></button>
    <div class="surfaces"><div><div data-testid="nested-target">Card content</div></div></div>
    <div class="two-surfaces"><div>Only two layers</div></div>
  </body></html>`);
  const result = await page.evaluate(inspectLayout, ["AP004", "AP005", "AP006", "AP007", "AP008"]);
  const has = (checkId, selectorFragment) => result.findings.some(finding => finding.checkId === checkId && finding.target.includes(selectorFragment));
  assert.ok(has("AP004", "overlap-a"), "independent overlapping text is reported");
  assert.ok(!has("AP004", "clear-overlap"), "separate text is not reported as overlapping");
  assert.ok(!result.findings.some(finding => finding.checkId === "AP004" && (finding.target.includes("intentional-tooltip") || finding.related?.includes("intentional-tooltip"))), "semantic tooltip overlays are excluded");
  assert.ok(has("AP005", "clip"), "clipped text is reported");
  assert.ok(!has("AP005", "ellipsis"), "intentional ellipsis is allowed");
  assert.ok(has("AP005", "bad-label"), "a fragmented control label is reported");
  assert.ok(!has("AP005", "ordinary-copy"), "ordinary paragraph wrapping is allowed");
  assert.ok(has("AP006", "weak-heading"), "visually weaker heading is reported");
  assert.ok(!has("AP006", "strong-heading"), "strong heading is allowed");
  assert.ok(has("AP007", "shifted-icon"), "shifted painted icon bounds are reported");
  assert.ok(!has("AP007", "centered-icon"), "centered painted icon bounds are allowed");
  assert.ok(has("AP008", "nested-target"), "three nested repeated surfaces are reported");
  assert.ok(!has("AP008", ".two-surfaces"), "two surface layers are allowed");
  console.log(`Appearance layout browser checks passed: ${result.findings.length} findings, ${result.skipped.length} skipped`);
} finally {
  await browser.close();
}
