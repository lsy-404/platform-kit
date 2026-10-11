import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const near = (actual, expected, tolerance, label) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);
const rgbNear = (actual, expected, label) => expected.forEach((v, i) => near(actual[i], v, 1, label + " channel " + i));

async function open(html, options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>body{margin:0;font:16px Arial}</style>${html}`);
  await page.evaluate(installKit);
  return { page, context };
}
const kit = (page, fn, arg) => page.evaluate(`(${fn.toString()})(globalThis.__appearanceKit, ${JSON.stringify(arg ?? null)})`);

try {
  {
    const { page, context } = await open("<p>x</p>");
    await page.evaluate(installKit);
    assert.equal(await page.evaluate(() => typeof globalThis.__appearanceKit.paintBehind), "function", "install is idempotent");
    const first = await page.evaluate(() => { const k = globalThis.__appearanceKit; globalThis.__appearanceKit = k; return k === globalThis.__appearanceKit; });
    assert(first);

    const c = await kit(page, k => ({
      white767676: k.contrast([0x76, 0x76, 0x76], [255, 255, 255]),
      white949494: k.contrast([0x94, 0x94, 0x94], [255, 255, 255]),
      reversed: k.contrast([255, 255, 255], [0x76, 0x76, 0x76]),
      blackWhite: k.contrast([0, 0, 0], [255, 255, 255]),
      same: k.contrast([10, 20, 30], [10, 20, 30]),
      below: k.contrast([0x96, 0x96, 0x96], [255, 255, 255]),
    }));
    near(c.white767676, 4.54, 0.01, "#767676 on white");
    near(c.white949494, 3.03, 0.01, "#949494 on white");
    near(c.below, 2.96, 0.01, "#969696 on white");
    assert.equal(c.reversed, c.white767676, "contrast is symmetric");
    near(c.blackWhite, 21, 0.0001, "black on white");
    assert.equal(c.same, 1);
    assert(c.white767676 >= 4.5 && c.white949494 >= 3 && c.below < 3, "ratios are not rounded before comparison");

    const colors = await kit(page, k => ({
      plain: k.rgba("rgb(10, 20, 30)"),
      alpha: k.rgba("rgba(10, 20, 30, 0.5)"),
      slash: k.rgba("rgb(10 20 30 / 25%)"),
      hex: k.rgba("#336699"),
      transparent: k.rgba("transparent"),
      modern: k.rgba("color(srgb 1 0 0)"),
      over: k.composite([0, 0, 0, 0.5], [255, 255, 255, 1]),
      opaque: k.composite([1, 2, 3, 1], [255, 255, 255, 1]),
      clear: k.composite([1, 2, 3, 0], [9, 8, 7, 1]),
    }));
    assert.deepEqual(colors.plain, [10, 20, 30, 1]);
    assert.deepEqual(colors.alpha, [10, 20, 30, 0.5]);
    near(colors.slash[3], 0.25, 0.001, "slash alpha");
    assert.deepEqual(colors.hex, [0x33, 0x66, 0x99, 1]);
    assert.equal(colors.transparent[3], 0);
    assert.deepEqual(colors.modern, [255, 0, 0, 1]);
    rgbNear(colors.over, [127.5, 127.5, 127.5], "50% black over white");
    assert.deepEqual(colors.opaque.slice(0, 3), [1, 2, 3]);
    assert.deepEqual(colors.clear.slice(0, 3), [9, 8, 7]);
    await context.close();
  }

  {
    const { page, context } = await open(`
      <div id="plain" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#fff"></div>
      <div id="tint" style="position:absolute;left:150px;top:0;width:100px;height:100px;background:#fff"><div style="width:100%;height:100%;background:rgba(0,0,0,.5)"></div></div>
      <div id="solid" style="position:absolute;left:300px;top:0;width:100px;height:100px;background:#202020"></div>
      <div id="grad" style="position:absolute;left:450px;top:0;width:100px;height:100px;background:linear-gradient(#fff,#000)"></div>
      <div id="faded" style="position:absolute;left:600px;top:0;width:100px;height:100px;background:#fff;opacity:.5"></div>
      <div id="pseudo" style="position:absolute;left:0;top:150px;width:100px;height:100px;background:#fff"><style>#pseudo::before{content:"";position:absolute;inset:0;background:#f00}</style></div>
      <div id="blend" style="position:absolute;left:150px;top:150px;width:100px;height:100px;background:#fff;mix-blend-mode:multiply"></div>
      <div id="outer" style="position:absolute;left:300px;top:150px;width:100px;height:100px;background:#fff"><button id="over" style="position:absolute;inset:0;border:0;background:#f00"></button></div>
      <div id="stackbase" style="position:absolute;left:450px;top:150px;width:200px;height:100px;background:#202020"></div>
      <div id="field" style="position:absolute;left:460px;top:160px;width:80px;height:30px;border:1px solid #2a2a2a;background:transparent"></div>
      <img id="img" alt="" style="position:absolute;left:0;top:300px;width:50px;height:50px" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`);
    const at = (id, dx = 10, dy = 10, exclude = null) => page.evaluate(([id, dx, dy, exclude]) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return globalThis.__appearanceKit.paintBehind(r.left + dx, r.top + dy, exclude ? document.getElementById(exclude) : undefined);
    }, [id, dx, dy, exclude]);
    rgbNear(await at("plain"), [255, 255, 255], "plain");
    rgbNear(await at("tint"), [127.5, 127.5, 127.5], "translucent layer composited over its parent");
    rgbNear(await at("solid"), [32, 32, 32], "solid");
    assert.equal(await at("grad"), null, "background image is unknown");
    assert.equal(await at("faded"), null, "effective opacity below 1 is unknown");
    assert.equal(await at("pseudo"), null, "painting pseudo-element is unknown");
    assert.equal(await at("blend"), null, "blend mode is unknown");
    assert.equal(await at("img", 5, 5), null, "image element is unknown");
    rgbNear(await at("outer"), [255, 0, 0], "topmost paint wins");
    rgbNear(await at("outer", 10, 10, "over"), [255, 255, 255], "excluded element is skipped");
    rgbNear(await at("field", 40, 15), [32, 32, 32], "paint stack, not DOM ancestry, supplies the backdrop");
    // Canvas background propagated from body when the root has none, and outside any element.
    rgbNear(await page.evaluate(() => globalThis.__appearanceKit.paintBehind(790, 590)), [255, 255, 255], "canvas default");
    await context.close();
  }

  {
    const { page, context } = await open(`<style>:root{color-scheme:dark}</style><div id="x" style="position:absolute;left:100px;top:100px;width:20px;height:20px"></div>`, { colorScheme: "dark" });
    const dark = await page.evaluate(() => globalThis.__appearanceKit.paintBehind(500, 500));
    assert(dark.slice(0, 3).every(v => v < 100), "dark Canvas color is not white: " + dark);
    await context.close();
  }

  {
    const { page, context } = await open(`
      <div style="position:absolute;left:0;top:0;width:400px;height:300px;background:#f5f5f5"><input id="flat" style="position:absolute;left:100px;top:100px"></div>
      <div style="position:absolute;left:400px;top:0;width:400px;height:300px;background:linear-gradient(90deg,#fff,#000)"><input id="grad" style="position:absolute;left:100px;top:100px"></div>
      <div style="position:absolute;left:0;top:300px;width:400px;height:300px;background:#fff"><input id="split" style="position:absolute;left:100px;top:100px"><div style="position:absolute;left:0;top:0;width:50px;height:300px;background:#000"></div></div>`);
    const adj = id => page.evaluate(id => globalThis.__appearanceKit.adjacentColor(document.getElementById(id)), id);
    const flat = await adj("flat");
    rgbNear(flat.rgb, [245, 245, 245], "flat adjacent color");
    assert.match((await adj("grad")).reason, /Adjacent background varies or is not a flat color/);
    const edge = await page.evaluate(() => {
      const el = document.getElementById("split"); el.style.left = "46px";
      return globalThis.__appearanceKit.adjacentColor(el);
    });
    assert.match(edge.reason ?? "", /varies/, "samples that disagree are not flat");
    await context.close();
  }

  {
    const { page, context } = await open(`
      <div id="rot" style="transform:rotate(10deg)"><span id="in">a</span></div>
      <div id="tr" style="transform:translate(10px,5px)"><span id="trin">a</span></div>
      <div id="sc" style="transform:scale(1.1)"><span id="scin">a</span></div>
      <div id="clip" style="clip-path:circle(50%)"><span id="clipin">a</span></div>
      <div id="zoomed" style="zoom:1.2"><span id="zin">a</span></div>
      <span id="srcl" style="position:absolute;width:1px;height:1px;overflow:hidden">x</span>
      <span id="srclip" style="position:absolute;clip:rect(0px,0px,0px,0px);width:40px;height:20px">x</span>
      <span id="srinset" style="position:absolute;clip-path:inset(50%);width:40px;height:20px">x</span>
      <span id="normal">x</span>
      <div aria-hidden="true"><b id="hid">h</b></div><div inert><b id="inertb">h</b></div>
      <button id="dis" disabled><i id="disin">d</i></button><div aria-disabled="true"><b id="ariadis">d</b></div><button id="en">e</button>
      <details><summary id="sum">s</summary><p id="closed">hidden</p></details><details open><summary>s</summary><p id="opened">shown</p></details>
      <p id="vis">v</p><p id="gone" style="display:none">g</p><p id="off" style="position:absolute;left:-500px">o</p>`);
    const r = await page.evaluate(() => {
      const k = globalThis.__appearanceKit, $ = id => document.getElementById(id);
      return {
        rot: k.geometryIssue($("in")), tr: k.geometryIssue($("trin")), sc: k.geometryIssue($("scin")), clip: k.geometryIssue($("clipin")), zoom: k.geometryIssue($("zin")), plain: k.geometryIssue($("vis")),
        srcl: k.srOnly($("srcl")), srclip: k.srOnly($("srclip")), srinset: k.srOnly($("srinset")), normal: k.srOnly($("normal")),
        hid: k.decorative($("hid")), inert: k.decorative($("inertb")), notDecor: k.decorative($("vis")),
        dis: k.disabled($("disin")), ariadis: k.disabled($("ariadis")), en: k.disabled($("en")),
        sum: k.visible($("sum")), closed: k.visible($("closed")), opened: k.visible($("opened")), vis: k.visible($("vis")), gone: k.visible($("gone")), off: k.visible($("off")),
        scriptLatin: k.script("Hello world"), scriptCjk: k.script("这是一个中文段落 with a word"), scriptMix: k.script("abcd 这"), scriptEmpty: k.script("  "),
      };
    });
    assert.equal(typeof r.rot, "string"); assert.equal(r.tr, null); assert.equal(typeof r.sc, "string");
    assert.equal(typeof r.clip, "string"); assert.equal(typeof r.zoom, "string"); assert.equal(r.plain, null);
    assert(r.srcl && r.srclip && r.srinset && !r.normal);
    assert(r.hid && r.inert && !r.notDecor);
    assert(r.dis && r.ariadis && !r.en);
    assert(r.sum && !r.closed && r.opened && r.vis && !r.gone && !r.off);
    assert.equal(r.scriptLatin, "latin"); assert.equal(r.scriptCjk, "cjk"); assert.equal(r.scriptMix, "latin"); assert.equal(r.scriptEmpty, "latin");
    await context.close();
  }

  {
    const { page, context } = await open(`
      <div id="a"><p>One</p><p>Two</p></div><div data-testid="card"><span>x</span></div><section id="s"><i>q</i></section>
      <p id="para" style="width:120px">alpha beta gamma delta epsilon zeta eta theta iota kappa lambda</p>
      <div style="width:100px;height:20px;overflow:hidden"><span id="clipped" style="display:inline-block;width:300px">wide</span></div>`);
    const r = await page.evaluate(() => {
      const k = globalThis.__appearanceKit;
      const all = [...document.body.querySelectorAll("*")];
      const sels = all.map(el => k.selector(el));
      const roundTrip = all.every((el, i) => document.querySelector(sels[i]) === el);
      const para = document.getElementById("para"), fs = parseFloat(getComputedStyle(para).fontSize);
      const lines = k.lines(para);
      const a = document.getElementById("a"), s = document.getElementById("s");
      const clipped = document.getElementById("clipped");
      const cr = k.clippedRect(clipped, clipped.getBoundingClientRect());
      return {
        roundTrip, idSel: k.selector(s), testid: k.selector(document.querySelector("[data-testid]")),
        id1: k.identity(a), id1b: k.identity(a), id2: k.identity(s),
        lineCount: lines.length, tops: lines.map(l => l.top), widths: lines.map(l => l.width), fs, maxWidth: Math.max(...lines.map(l => l.width)),
        runs: k.textRuns().map(run => run.owner.id || run.owner.tagName), cw: cr.width,
        opacity: (() => { const e = document.createElement("div"); e.style.opacity = ".5"; e.innerHTML = "<b>t</b>"; e.firstChild.style.opacity = ".5"; document.body.appendChild(e); return k.effectiveOpacity(e.firstChild); })(),
      };
    });
    assert(r.roundTrip, "every selector resolves back to its element");
    assert.equal(r.idSel, "section#s");
    assert.match(r.testid, /\[data-testid="card"\]/);
    assert.equal(r.id1, r.id1b); assert.notEqual(r.id1, r.id2);
    assert(r.lineCount >= 3, "narrow paragraph wraps into several lines");
    assert(r.tops.every((t, i) => i === 0 || t > r.tops[i - 1]), "lines are ordered top to bottom");
    assert(r.maxWidth <= 121, "line widths stay inside the 120px block");
    assert(r.runs.includes("para") && r.runs.includes("P"));
    near(r.cw, 100, 1, "clippedRect is limited by an overflow-hidden ancestor");
    near(r.opacity, 0.25, 0.001, "effective opacity multiplies along ancestors");
    await context.close();
  }
  console.log("Appearance kit contrast, compositing, paint stack and predicate checks passed.");
} finally {
  await browser.close();
}
