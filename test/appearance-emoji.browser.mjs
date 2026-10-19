import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { installKit } from "../tooling/appearance-check/dist/kit.js";
import { inspectEmoji } from "../tooling/appearance-check/dist/emoji.js";
import { auditAppearance, checkInfo } from "../tooling/appearance-check/dist/index.js";

const require = createRequire(new URL("../tooling/appearance-check/package.json", import.meta.url));
const { chromium } = require("playwright");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function run(html, enabled = ["AP035"]) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px Arial}</style>${html}`);
    await page.evaluate(installKit);
    return await page.evaluate(inspectEmoji, enabled);
  } finally { await context.close(); }
}

// Sequences built from code points so invisible selectors and joiners survive editing.
const FLAG = "\u{1F1E8}\u{1F1F3}", CHEF = "\u{1F468}\u{200D}\u{1F373}", KEYCAP = "1\u{FE0F}\u{20E3}", WAVE = "\u{1F44B}\u{1F3FD}";
const GEAR = "\u{2699}", GEAR16 = "\u{2699}\u{FE0F}", CUP15 = "\u{2615}\u{FE0E}";
const COPY15 = "\u{A9}\u{FE0E}", COPY16 = "\u{A9}\u{FE0F}";
const last = selector => selector.split(" ").pop();
const byTarget = result => Object.fromEntries(result.findings.map(f => [last(f.target), f]));

try {
  // Interface text, prose and art alike: emoji look different on every device. One finding per element.
  {
    const result = await run(`
      <button id="save">💾 存档</button>
      <h2 id="shop">🏪 升级商店</h2>
      <a href="#" id="flag">${FLAG} 中文</a>
      <button id="chef">${CHEF} 厨师</button>
      <button id="key">${KEYCAP} 第一步</button>
      <button id="wave">${WAVE} 你好</button>
      <button id="gear16">${GEAR16} 设置</button>
      <label id="night"><input type="checkbox"> 🌙 夜间模式</label>
      <div role="tab" id="tab" tabindex="0">🍰 食品图鉴</div>
      <div role="status" id="saved">✅ 已保存</div>
      <button id="pair">🍯 蜜罐 🍯</button>
      <p id="prose">今天吃了一块 🍰，很满足。</p>
      <div class="food" id="art">🧁</div>
      <span id="loose">🎉 第一单完成！</span>`);
    const found = byTarget(result);
    assert.deepEqual(Object.keys(found).sort(), ["a#flag", "button#chef", "button#gear16", "button#key", "button#pair", "button#save", "button#wave", "div#art", "div#saved", "div#tab", "h2#shop", "label#night", "p#prose", "span#loose"]);
    assert.deepEqual(found["button#save"].evidence, { symbols: ["💾"], text: "💾 存档", source: ["text"], element: "button", rendered: true });
    assert.equal(found["h2#shop"].evidence.element, "h2");
    assert.deepEqual(found["a#flag"].evidence.symbols, [FLAG], "a flag is one emoji");
    assert.deepEqual(found["button#chef"].evidence.symbols, [CHEF], "a ZWJ sequence is one emoji");
    assert.deepEqual(found["button#key"].evidence.symbols, [KEYCAP], "a keycap is one emoji");
    assert.deepEqual(found["button#wave"].evidence.symbols, [WAVE], "a skin tone stays with its emoji");
    assert.deepEqual(found["button#gear16"].evidence.symbols, [GEAR16]);
    assert.equal(found["div#tab"].evidence.element, "tab");
    assert.equal(found["div#saved"].evidence.element, "status");
    assert.deepEqual(found["button#pair"].evidence.symbols, ["🍯"], "repeated emoji are listed once");
    assert.deepEqual(found["div#art"].evidence.symbols, ["🧁"], "emoji used as art count too");
    assert.equal(found["p#prose"].evidence.element, "p");
    assert.ok(result.findings.every(f => f.checkId === "AP035" && f.confidence === "measured"));
    assert.equal(result.skipped.length, 0);
  }

  // Pictographic symbols count whatever their default presentation: arrows, gears, checks, stars, shapes, VS15.
  {
    const result = await run(`
      <button id="gear">${GEAR} 设置</button>
      <button id="check">✓ 完成</button>
      <a href="#" id="legal">© 2026 Tiny™ → 首页</a>
      <button id="star">★ 收藏</button>
      <button id="vs15">${CUP15} 咖啡</button>
      <ul><li id="dot">● 在线</li></ul>
      <kbd id="kbd">⌘K</kbd>
      <button id="play">▶ 播放</button>
      <span id="heart">♥</span>
      <p id="imply">A ⇒ B</p>`);
    const found = byTarget(result);
    assert.deepEqual(found["button#gear"].evidence.symbols, [GEAR]);
    assert.deepEqual(found["button#check"].evidence.symbols, ["✓"]);
    assert.deepEqual(found["a#legal"].evidence.symbols, ["→"], "© and ™ are exempt, the arrow is not");
    assert.deepEqual(found["button#star"].evidence.symbols, ["★"]);
    assert.deepEqual(found["button#vs15"].evidence.symbols, [CUP15], "a text presentation selector does not exempt");
    assert.deepEqual(found["li#dot"].evidence.symbols, ["●"]);
    assert.deepEqual(found["kbd#kbd"].evidence.symbols, ["⌘"]);
    assert.deepEqual(found["button#play"].evidence.symbols, ["▶"]);
    assert.deepEqual(found["span#heart"].evidence.symbols, ["♥"]);
    assert.deepEqual(found["p#imply"].evidence.symbols, ["⇒"]);
  }

  // The only exemption: ©, ® and ™ as text marks. Ordinary typography is not a symbol.
  {
    const quiet = await run(`
      <p id="marks">© 2026 Tiny Projects® Brand™ ${COPY15}</p>
      <p id="math">3 × 4 = 12，25°C，A · B，“引号”…</p>`);
    assert.deepEqual(quiet.findings, [], "standard marks and typography are not reported: " + JSON.stringify(quiet.findings.map(f => f.evidence)));
    const emoji = byTarget(await run(`<p id="copy16">${COPY16} 2026</p>`));
    assert.deepEqual(emoji["p#copy16"].evidence.symbols, [COPY16], "an emoji presentation selector turns © into emoji");
  }

  // Hiding from assistive technology does not change how the glyph looks, so these are reported too.
  {
    const found = byTarget(await run(`
      <button id="hidden"><span aria-hidden="true">💾</span> 存档</button>
      <button id="named"><span role="img" aria-label="蛋糕">🍰</span> 甜品</button>
      <div inert><button id="inert">🔒 锁定</button></div>
      <button id="piece"><span style="display:none">💾</span> 存档</button>`));
    assert.ok(found["button#hidden"] && found["button#named"] && found["button#inert"]);
    assert.equal(found["button#hidden"].evidence.rendered, true);
    assert.equal(found["button#piece"].evidence.rendered, false, "a hidden piece is reported as not rendered");
  }

  // Attributes, generated content and the document title.
  {
    const result = await run(`
      <title>🍯 甜品屋</title>
      <style>.ok::before{content:"✓ "} .plain::after{content:"（完）"}</style>
      <button id="search" aria-label="🔍 搜索"><svg width="16" height="16" aria-hidden="true"></svg></button>
      <input id="q" placeholder="🔍 搜索">
      <span id="tip" title="✨ 提示">?</span>
      <input type="submit" id="go" value="🚀 提交">
      <span class="ok" id="ok">完成</span>
      <span class="plain" id="plain">结束</span>
      <select id="fruit"><option id="apple">🍎 苹果</option><option>梨</option></select>
      <div role="alert" id="offline"><button id="retry">🔄 重试</button> 已断开</div>
      <div style="height:2000px"></div>
      <button id="far">📌 固定</button>`);
    const found = byTarget(result);
    assert.deepEqual(found["button#search"].evidence.source, ["aria-label"]);
    assert.deepEqual(found["input#q"].evidence.source, ["placeholder"]);
    assert.deepEqual(found["span#tip"].evidence.source, ["title"]);
    assert.deepEqual(found["input#go"].evidence.source, ["value"]);
    assert.deepEqual(found["span#ok"].evidence.source, ["::before"]);
    assert.deepEqual(found["span#ok"].evidence.symbols, ["✓"]);
    assert.equal(found["span#plain"], undefined, "generated text without symbols is fine");
    assert.equal(found["option#apple"].evidence.element, "option");
    assert.ok(found["button#retry"], "the nested button owns its emoji");
    assert.equal(found["div#offline"], undefined, "the alert region has no emoji of its own");
    assert.ok(found["button#far"], "the whole document is checked, not only the first viewport");
    assert.deepEqual(found["title"].evidence.symbols, ["🍯"], "the document title is checked");
  }

  // Closed menus and dialogs are checked too; `rendered` tells what shows right now.
  {
    const found = byTarget(await run(`
      <div class="menu" style="display:none"><button id="menu-save">💾 存档</button></div>
      <dialog id="shop"><h2 id="shop-title">🏪 升级商店</h2></dialog>
      <button id="later" hidden>🤖 自动服务</button>
      <button id="shown">🌙 夜间模式</button>`));
    assert.equal(found["button#menu-save"].evidence.rendered, false);
    assert.equal(found["h2#shop-title"].evidence.rendered, false, "a closed dialog's heading is reported");
    assert.equal(found["button#later"].evidence.rendered, false);
    assert.equal(found["button#shown"].evidence.rendered, true);
  }

  // Disabled check and the reporting limit.
  {
    assert.deepEqual(await run(`<button>💾 存档</button>`, []), { findings: [], skipped: [] });
    const many = await run(Array.from({ length: 45 }, (_, i) => `<button>⭐ ${i}</button>`).join(""));
    assert.equal(many.findings.length, 40);
    assert.equal(many.skipped.length, 1);
    assert.equal(many.skipped[0].checkId, "AP035");
  }

  // Through the runner: AP035 runs by default, once per page across viewports and color schemes.
  {
    const info = checkInfo("AP035");
    assert.equal(info.name, "emoji-symbols");
    assert.equal(info.severity, "advisory");
    assert.deepEqual(info.dimensions, ["accessibility", "typography"]);
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><style>body{font:16px Arial;color:#111;background:#fff}</style><button id="save">💾 存档</button><button id="plain">读档</button><p>© 2026</p>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const report = await auditAppearance({
        urls: [`http://127.0.0.1:${server.address().port}/`],
        viewports: [{ width: 800, height: 600 }, { width: 390, height: 800 }],
        colorSchemes: ["light", "dark"],
        executablePath,
      });
      const emoji = report.findings.filter(f => f.checkId === "AP035");
      assert.equal(emoji.length, 1, "reported once for the page");
      assert.equal(last(emoji[0].target), "button#save");
      assert.equal(emoji[0].severity, "advisory");
      const row = report.summary.find(r => r.dimension === "typography");
      assert.ok(row.byCheck.some(c => c.checkId === "AP035" && c.findings === 1));
    } finally { server.close(); }
  }
} finally {
  await browser.close();
}
console.log("appearance emoji checks passed");
