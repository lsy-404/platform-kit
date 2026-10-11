import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { inspectFonts, inspectTypography } from "../tooling/appearance-check/dist/typography.js";
import { inspectLayout } from "../tooling/appearance-check/dist/layout.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

async function open(html, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:16px Arial}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installKit);
  return { page, context };
}

async function run(html, fn, arg) {
  const { page, context } = await open(html);
  try { return await page.evaluate(fn, arg); } finally { await context.close(); }
}

const words = "the quick brown fox jumps over a lazy dog while reading some text ";
const latin = n => words.repeat(Math.ceil(n / words.length)).slice(0, n);
const cjk = n => "天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏".repeat(Math.ceil(n / 24)).slice(0, n);
const hit = (result, id, fragment) => result.findings.filter(f => f.checkId === id && f.target.includes(fragment));

try {
  // AP021 prose leading
  {
    const html = id => lh => `<p id="${id}" style="width:300px;margin:0;font:16px/${lh} Arial">${latin(260)}</p>`;
    const tight = await run(html("tight")("16px"), inspectTypography, ["AP021"]);
    const f = hit(tight, "AP021", "tight");
    assert.equal(f.length, 1, "line-height 1.0 is reported");
    assert.ok(f[0].evidence.ratio < 1.2 && f[0].evidence.lines >= 4);
    assert.equal(f[0].evidence.fontSize, 16);
    assert.equal(hit(await run(html("t")("1.15"), inspectTypography, ["AP021"]), "AP021", "t").length, 1, "1.15 is below 1.2");
    const ok = await run(html("ok")("1.25"), inspectTypography, ["AP021"]);
    assert.equal(ok.findings.length, 0, "1.25 passes");
    assert.equal(ok.skipped.length, 0);
    assert.equal((await run(html("tight")("16px"), inspectTypography, [])).findings.length, 0, "disabled check reports nothing");
    const heading = await run(`<h2 style="width:300px;margin:0;font:16px/1 Arial">${latin(260)}</h2>`, inspectTypography, ["AP021"]);
    assert.equal(heading.findings.length, 0, "headings are excluded");
    const pre = await run(`<pre style="width:300px;margin:0;white-space:pre-wrap;font:16px/1.1 monospace">${latin(260)}</pre>`, inspectTypography, ["AP021"]);
    assert.equal(pre.findings.length, 0, "preformatted text is excluded");
    const mono = await run(`<p style="width:300px;margin:0;font:16px/1 monospace">${latin(260)}</p>`, inspectTypography, ["AP021"]);
    assert.equal(mono.findings.length, 0, "monospace text is excluded");
    const short = await run(`<p style="width:300px;margin:0;font:16px/1 Arial">${latin(60)}</p>`, inspectTypography, ["AP021"]);
    assert.equal(short.findings.length, 0, "under 80 characters is excluded");
  }

  // AP022 line length
  {
    const wide = await run(`<p id="wide" style="width:1200px;margin:0;font:16px Arial">${latin(600)}</p>`, inspectTypography, ["AP022"]);
    const f = hit(wide, "AP022", "wide");
    assert.equal(f.length, 1);
    assert.ok(f[0].evidence.charsPerLine > 80 && f[0].evidence.script === "latin");
    assert.equal((await run(`<p id="wide" style="width:1200px;margin:0;font:16px Arial">${latin(600)}</p>`, inspectTypography, [])).findings.length, 0);
    const narrow = await run(`<p id="narrow" style="max-width:60ch;margin:0;font:16px Arial">${latin(600)}</p>`, inspectTypography, ["AP022"]);
    assert.equal(narrow.findings.length, 0, "60ch measure passes");
    assert.equal(narrow.skipped.length, 0);
    const longCjk = await run(`<p id="cjk" style="width:50em;margin:0;font:16px Arial">${cjk(400)}</p>`, inspectTypography, ["AP022"]);
    const g = hit(longCjk, "AP022", "cjk");
    assert.equal(g.length, 1, "50 CJK characters per line exceeds 40");
    assert.equal(g[0].evidence.script, "cjk");
    const shortCjk = await run(`<p id="cjk" style="width:30em;margin:0;font:16px Arial">${cjk(400)}</p>`, inspectTypography, ["AP022"]);
    assert.equal(shortCjk.findings.length, 0, "30 CJK characters per line passes");
  }

  // AP023 font load failure
  {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      if (request.url === "/missing.woff2") { response.statusCode = 404; response.end("nope"); return; }
      const style = request.url === "/ok" ? "p{font-family:Arial}"
        : request.url === "/unused" ? "p{font-family:Arial}"
        : "p{font-family:Missing,sans-serif}";
      response.end(`<!doctype html><style>@font-face{font-family:Missing;src:url(/missing.woff2)} ${style}</style><p id="t">Hello there</p>`);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const visit = async (path, prepare) => {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
        const page = await context.newPage();
        const failures = [];
        page.on("response", r => { if (r.status() === 404) failures.push(r.url()); });
        await page.goto(base + path);
        if (prepare) await page.evaluate(prepare);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(installKit);
        const result = await page.evaluate(inspectFonts);
        await context.close();
        return { result, failures };
      };
      const bad = await visit("/bad");
      assert.ok(bad.failures.some(url => url.endsWith("/missing.woff2")), "the font request failed with 404");
      const found = hit(bad.result, "AP023", "t");
      assert.equal(found.length, 1, "unloadable declared font is reported on its first user");
      assert.equal(found[0].evidence.family.replace(/["']/g, ""), "Missing");
      assert.ok(found[0].evidence.owners.length >= 1);
      const ok = await visit("/ok");
      assert.equal(ok.result.findings.length, 0, "Arial text has no failed font");
      assert.equal(ok.result.skipped.length, 0);
      const unused = await visit("/unused", () => document.fonts.load("16px Missing").catch(() => undefined));
      assert.equal(unused.result.findings.length, 0, "a failed font that no text uses is not reported");
    } finally {
      server.close();
    }
  }

  // AP006 level inversion
  {
    const layout = async html => run(html, inspectLayout, ["AP006"]);
    const bad = await layout(`<main><h2 id="a" style="font:400 14px Arial;margin:0">A</h2><h3 id="b" style="font:700 24px Arial;margin:0">B</h3></main>`);
    const f = bad.findings.filter(x => x.checkId === "AP006" && x.target.includes("b"));
    assert.equal(f.length, 1, "a stronger subheading is reported");
    assert.ok(f[0].related?.includes("a"));
    assert.equal(f[0].evidence.kind, "level-inversion");
    assert.equal(f[0].evidence.heading.level, 3);
    assert.equal(f[0].evidence.parentHeading.level, 2);
    assert.equal((await run(`<main><h2 id="a" style="font:400 14px Arial;margin:0">A</h2><h3 id="b" style="font:700 24px Arial;margin:0">B</h3></main>`, inspectLayout, [])).findings.length, 0);
    const eyebrow = await layout(`<main><h2 style="font:400 12px Arial;letter-spacing:.1em;margin:0">A</h2><h3 id="b" style="font:700 24px Arial;margin:0">B</h3></main>`);
    assert.equal(eyebrow.findings.length, 0, "tracked eyebrow headings are exempt");
    const upper = await layout(`<main><h2 style="font:400 12px Arial;text-transform:uppercase;margin:0">A</h2><h3 id="b" style="font:700 24px Arial;margin:0">B</h3></main>`);
    assert.equal(upper.findings.length, 0, "uppercase eyebrow headings are exempt");
    const ordered = await layout(`<main><h2 style="font:700 28px Arial;margin:0">A</h2><h3 id="b" style="font:700 20px Arial;margin:0">B</h3></main>`);
    assert.equal(ordered.findings.length, 0, "a smaller subheading is fine");
    const split = await layout(`<main><section><h2 style="font:400 14px Arial;margin:0">A</h2></section><section><h3 id="b" style="font:700 24px Arial;margin:0">B</h3></section></main>`);
    assert.equal(split.findings.length, 0, "headings in different sections are not compared");
  }
  console.log("Appearance typography browser checks passed");
} finally {
  await browser.close();
}
