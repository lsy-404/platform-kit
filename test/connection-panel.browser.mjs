import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const dist = join(root, "oauth/packages/vue/dist");
const artifact = join(root, "test/artifacts");
const fixture = JSON.stringify([
  { id: "oauth", name: "OAuth service", description: "OAuth", authMethods: ["oauth"], available: true, models: Array.from({ length: 30 }, (_, index) => `very-long-model-name-${index}-abcdefghijklmnopqrstuvwxyz`), loadStrategy: "weighted-round-robin", oauthCredentials: [{ id: "oauth-1", label: "Primary", account: "person@example.test", enabled: true, healthy: true, weight: 2, models: ["o-model"] }, { id: "oauth-2", label: "Paused", enabled: false, healthy: false, weight: 3, models: ["o-model"] }] },
  { id: "key", name: "Key service", description: "API Key", authMethods: ["api-key"], available: true, models: ["k-model"], loadStrategy: "failover", apiKeyCredentials: [{ id: "key-1", label: "Workspace", enabled: true, healthy: false, weight: 1, models: ["k-model"] }] },
  { id: "offline", name: "Offline service", description: "Unavailable", authMethods: ["oauth"], available: false, unavailableReason: "Host integration unavailable", models: [], oauthCredentials: [{ id: "offline-1", label: "Offline account", enabled: true, healthy: false, weight: 1, models: [] }] },
]);
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;max-width:100%}fixture-connections,fixture-dialog{display:block;max-width:100%}</style><body><main><fixture-connections></fixture-connections><fixture-dialog></fixture-dialog></main><script type="module">
  import { registerModelAuthElement, registerModelConnectionPanelElement } from "/model-auth-element.js";
  registerModelConnectionPanelElement("fixture-connections"); registerModelAuthElement("fixture-dialog");
  const providers = ${fixture}; providers[0].oauthCredentials.forEach(account => account.models = providers[0].models); const panel = document.querySelector("fixture-connections"), dialog = document.querySelector("fixture-dialog");
  panel.providers = providers; panel.model = { providerId: "oauth", model: providers[0].models[0] }; panel.theme = "dark";
  dialog.providers = providers; dialog.model = panel.model; dialog.theme = "dark"; dialog.open = false;
  window.fixtureEvents = [];
  panel.addEventListener("manage", event => { const target = event.detail[0]; window.fixtureEvents.push(["manage", target]); dialog.initialConnection = target; dialog.open = true; });
  panel.addEventListener("refresh", () => window.fixtureEvents.push(["refresh"]));
  panel.addEventListener("add", () => window.fixtureEvents.push(["add"]));
  dialog.addEventListener("close", () => { dialog.open = false; });
  dialog.addEventListener("select-model", event => { const selection = event.detail[0]; window.fixtureEvents.push(["model", selection]); dialog.model = selection; panel.model = selection; });
</script>`;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (request, response) => {
  const pathname = request.url === "/" ? "/index.html" : new URL(request.url, "http://test").pathname;
  if (pathname === "/index.html") return response.end(html);
  const path = normalize(join(dist, pathname));
  if (!path.startsWith(dist)) return response.writeHead(403).end();
  try { response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await mkdir(artifact, { recursive: true });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const panel = page.locator("fixture-connections");
  await panel.locator('[data-part="connection-card"]').first().waitFor();
  assert.equal(await panel.locator('[data-part="connection-card"]').count(), 3);
  assert.ok(await panel.evaluate(element => { const text = element.shadowRoot.textContent; return text.includes("已停用") && text.includes("需要重新连接") && text.includes("Host integration unavailable"); }));
  assert.equal(await panel.locator("input").count(), 0);
  assert.equal(await panel.evaluate(element => element.shadowRoot.textContent.includes("fixture-secret-must-not-render")), false);
  await panel.locator('[data-provider-id="key"] [data-part="view-connection"]').click();
  await page.locator("fixture-dialog").locator('[data-part="connection-info"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixtureEvents.at(-1)), ["manage", { providerId: "key", method: "api-key" }]);
  assert.equal(await page.locator("fixture-dialog").locator('[part="progress"]').count(), 0);
  assert.equal(await page.locator("fixture-dialog").locator('[data-model-id="k-model"]').isDisabled(), true);
  await page.locator("fixture-dialog").locator('[data-part="close"]').click();
  await page.waitForTimeout(250);
  assert.equal(await panel.locator('[data-part="connection-card"]').count(), 3, "closing details must keep the persistent panel");
  await panel.locator('[data-part="refresh-connections"]').click();
  await panel.locator('[data-part="add-connection"]').click();
  assert.deepEqual(await page.evaluate(() => window.fixtureEvents.slice(-2)), [["refresh"], ["add"]]);
  const dimensions = await panel.evaluate(element => { const root = element.shadowRoot.querySelector('[data-part="connections-panel"]'); return { width: root.clientWidth, scroll: root.scrollWidth, dark: root.dataset.theme === "dark" }; });
  assert.ok(dimensions.scroll <= dimensions.width, `narrow panel overflows: ${dimensions.scroll}/${dimensions.width}`);
  assert.equal(dimensions.dark, true);
  await page.screenshot({ path: join(artifact, "connection-panel-narrow-dark.png"), fullPage: true });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("fixture-connections").locator('[data-part="connection-card"]').count(), 3, "fixture state must restore after reload");
  await page.locator("fixture-connections").locator('[data-provider-id="oauth"] [data-part="view-connection"]').click();
  const models = page.locator("fixture-dialog").locator(".model-auth-connection-models");
  assert.equal(await models.locator('[data-part="model-row"]').count(), 30);
  assert.equal(await models.locator('[data-model-id="very-long-model-name-0-abcdefghijklmnopqrstuvwxyz"]').getAttribute('aria-pressed'), 'true');
  await models.locator('summary').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('fixture-dialog').evaluate(el => el.shadowRoot.activeElement?.getAttribute('aria-label')), '搜索模型', 'Tab must reach model search');
  await models.locator('[data-part="model-search"]').fill('very-long-model-name-1-');
  assert.equal(await models.locator('[data-part="model-row"]').count(), 1);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.fixtureEvents.at(-1)), ['model', { providerId: 'oauth', model: 'very-long-model-name-1-abcdefghijklmnopqrstuvwxyz' }]);
  assert.equal(await models.locator('[data-part="model-row"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('fixture-dialog').locator('[data-part="dialog"]').isVisible(), true, 'selection must preserve the dialog');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('fixture-dialog').evaluate(el => el.shadowRoot.activeElement?.getAttribute('aria-label')), '负载策略', 'Tab must reach policy after the filtered model row');
  const dialogSize = await page.locator("fixture-dialog").evaluate(element => { const root = element.shadowRoot.querySelector('[data-part="connection-info"]'); return { width: root.clientWidth, scroll: root.scrollWidth }; });
  assert.ok(dialogSize.scroll <= dialogSize.width, `long models overflow: ${dialogSize.scroll}/${dialogSize.width}`);
  await page.screenshot({ path: join(artifact, "connection-panel-detail-models.png"), fullPage: true });
  console.log("Connection panel browser checks passed");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
