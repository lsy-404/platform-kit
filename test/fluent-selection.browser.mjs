import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const html = `<!doctype html><html><head><link rel="stylesheet" href="/styles/fluent/dist/style.css"></head><body><div id="app"></div><script type="importmap">{"imports":{"vue":"/node_modules/vue/dist/vue.esm-browser.js"}}</script><script type="module">
import { createApp, h, ref } from "vue";
import { FluentSelect, FluentMenu } from "/styles/fluent/dist/vue/selection.js";
const App = { setup() {
  const value = ref("alpha"); const menuOpen = ref(false); const menuValues = ref(["copy"]); const menuAnchor = ref(null);
  return () => h("main", { "data-fluent-theme": "light", style: "padding:40px;width:320px" }, [
    h(FluentSelect, { modelValue: value.value, label: "Choice", options: [{value:"alpha",label:"Alpha"},{value:"beta",label:"Beta"},{value:"blocked",label:"Blocked",disabled:true},{value:"gamma",label:"Gamma"}], "onUpdate:modelValue": v => value.value=v }),
    h("button", { id:"menu-trigger", ref:menuAnchor, type:"button", onClick: () => menuOpen.value = true }, "Actions"),
    h(FluentMenu, { open:menuOpen.value, label:"Actions", anchor:menuAnchor.value, items:[{value:"copy",label:"Copy"},{separator:true},{value:"share",label:"Share"},{value:"delete",label:"Delete",disabled:true}], multiple:true, modelValue:menuValues.value, closeOnSelect:false, "onUpdate:open": v => menuOpen.value=v, "onUpdate:modelValue": v => menuValues.value=v })
  ]); } };
createApp(App).mount("#app");
</script></body></html>`;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (request, response) => {
  const pathname = request.url === "/" ? "/index.html" : new URL(request.url, "http://test").pathname;
  if (pathname === "/index.html") return response.end(html);
  const path = normalize(join(root, pathname));
  if (!path.startsWith(root)) return response.writeHead(403).end();
  try { response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const select = page.getByRole("button", { name: "Choice" });
  await select.click();
  await assert.equal(await page.getByRole("listbox").count(), 1);
  await assert.equal(await page.getByRole("option", { name: "Alpha" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await assert.equal(await select.textContent(), "Beta");
  await assert.equal(await page.getByRole("listbox").count(), 0);
  await assert.equal(await page.evaluate(() => document.activeElement?.id), await select.getAttribute("id"));
  await select.press("b");
  await assert.equal(await page.getByRole("listbox").count(), 1);
  await page.mouse.click(700, 500);
  await assert.equal(await page.getByRole("listbox").count(), 0);
  const menuTrigger = page.locator("#menu-trigger");
  await menuTrigger.click();
  await assert.equal(await page.getByRole("menu").count(), 1);
  await assert.equal(await page.getByRole("separator").count(), 1);
  await menuTrigger.press("ArrowDown");
  await menuTrigger.press("Enter");
  await assert.equal(await page.getByRole("menuitemcheckbox", { name: "Share" }).getAttribute("aria-checked"), "true");
  await assert.equal(await page.getByRole("menu").count(), 1);
  await page.keyboard.press("Escape");
  await assert.equal(await page.getByRole("menu").count(), 0);
  await assert.equal(await page.evaluate(() => document.activeElement?.id), "menu-trigger");
  await page.screenshot({ path: "test/artifacts/fluent-selection-browser.png" });
  console.log("Fluent selection browser checks passed");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
