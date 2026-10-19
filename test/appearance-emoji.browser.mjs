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
const last = selector => selector.split(" ").pop();
const byTarget = result => Object.fromEntries(result.findings.map(f => [last(f.target), f]));

try {
  // Controls, links, headings, labels and status regions with emoji are reported once per element.
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
      <button id="pair">🍯 蜜罐 🍯</button>`);
    const found = byTarget(result);
    assert.deepEqual(Object.keys(found).sort(), ["a#flag", "button#chef", "button#gear16", "button#key", "button#pair", "button#save", "button#wave", "div#saved", "div#tab", "h2#shop", "label#night"]);
    assert.deepEqual(found["button#save"].evidence, { emoji: ["💾"], text: "💾 存档", source: ["text"], element: "button", rendered: true });
    assert.equal(found["h2#shop"].evidence.element, "h2");
    assert.deepEqual(found["a#flag"].evidence.emoji, [FLAG], "a flag is one emoji");
    assert.deepEqual(found["button#chef"].evidence.emoji, [CHEF], "a ZWJ sequence is one emoji");
    assert.deepEqual(found["button#key"].evidence.emoji, [KEYCAP], "a keycap is one emoji");
    assert.deepEqual(found["button#wave"].evidence.emoji, [WAVE], "a skin tone stays with its emoji");
    assert.deepEqual(found["button#gear16"].evidence.emoji, [GEAR16], "VS16 turns a text symbol into emoji");
    assert.equal(found["div#tab"].evidence.element, "tab");
    assert.equal(found["div#saved"].evidence.element, "status");
    assert.deepEqual(found["button#pair"].evidence.emoji, ["🍯"], "repeated emoji are listed once");
    assert.ok(result.findings.every(f => f.checkId === "AP035" && f.confidence === "measured"));
    assert.equal(result.skipped.length, 0);
  }

  // Text-presentation symbols, hidden or named emoji, prose and plain containers are left alone.
  {
    const result = await run(`
      <button id="gear">${GEAR} 设置</button>
      <button id="check">✓ 完成</button>
      <a href="#" id="legal">© 2026 Tiny™ → 首页</a>
      <button id="star">★ 收藏</button>
      <button id="vs15">${CUP15} 咖啡</button>
      <button id="hidden"><span aria-hidden="true">💾</span> 存档</button>
      <button id="named"><span role="img" aria-label="蛋糕">🍰</span> 甜品</button>
      <button id="piece"><span style="display:none">💾</span> 存档</button>
      <div inert><button id="inert">🔒 锁定</button></div>
      <p id="prose">今天吃了一块 🍰，很满足。</p>
      <div class="food" id="art">🧁</div>
      <span id="loose">🎉 第一单完成！</span>`);
    assert.deepEqual(result.findings, [], "nothing here is interface emoji: " + JSON.stringify(result.findings.map(f => f.target)));
  }

  // Accessible names and button values count as interface text; nested controls own their own emoji.
  {
    const result = await run(`
      <button id="search" aria-label="🔍 搜索"><svg width="16" height="16" aria-hidden="true"></svg></button>
      <input type="submit" id="go" value="🚀 提交">
      <select id="fruit"><option id="apple">🍎 苹果</option><option>梨</option></select>
      <div role="alert" id="offline"><button id="retry">🔄 重试</button> 已断开</div>
      <div style="height:2000px"></div>
      <button id="far">📌 固定</button>`);
    const found = byTarget(result);
    assert.deepEqual(found["button#search"].evidence.source, ["aria-label"]);
    assert.deepEqual(found["input#go"].evidence.source, ["value"]);
    assert.equal(found["option#apple"].evidence.element, "option");
    assert.ok(found["button#retry"], "the nested button owns its emoji");
    assert.equal(found["div#offline"], undefined, "the alert region has no emoji of its own");
    assert.ok(found["button#far"], "the whole document is checked, not only the first viewport");
  }

  // Closed menus and dialogs are checked too: their labels show and are announced once opened.
  {
    const result = await run(`
      <div class="menu" style="display:none"><button id="menu-save">💾 存档</button></div>
      <dialog id="shop"><h2 id="shop-title">🏪 升级商店</h2></dialog>
      <button id="later" hidden>🤖 自动服务</button>
      <button id="shown">🌙 夜间模式</button>`);
    const found = byTarget(result);
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
    assert.equal(info.severity, "advisory");
    assert.deepEqual(info.dimensions, ["accessibility", "typography"]);
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><style>body{font:16px Arial;color:#111;background:#fff}</style><button id="save">💾 存档</button><button id="plain">读档</button>');
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
