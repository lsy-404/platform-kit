import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const dist = join(root, "model-auth/packages/vue/dist");
const artifact = join(root, "test/artifacts");
const fixture = JSON.stringify([
  { id: "oauth", name: "OAuth service with an exceptionally long provider display name", description: "OAuth", authMethods: ["oauth"], available: true, models: Array.from({ length: 30 }, (_, index) => `very-long-model-name-${index}-abcdefghijklmnopqrstuvwxyz`), loadStrategy: "round-robin", oauthCredentials: [{ id: "oauth-1", label: "Primary", account: "person@example.test", enabled: true, healthy: true, models: ["o-model"] }, { id: "oauth-2", label: "Paused", enabled: false, healthy: false, models: ["o-model"] }] },
  { id: "key", name: "Key service", description: "API Key", authMethods: ["api-key"], available: true, models: ["k-model"], loadStrategy: "failover", apiKeyCredentials: [{ id: "key-1", label: "Workspace", enabled: true, healthy: false, models: ["k-model"] }] },
  { id: "offline", name: "Offline service", description: "Unavailable", authMethods: ["oauth"], available: false, unavailableReason: "Host integration unavailable", models: [], oauthCredentials: [{ id: "offline-1", label: "Offline account", enabled: true, healthy: false, models: [] }] },
]);
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;max-width:100%}fixture-connections,fixture-dialog{display:block;max-width:100%}</style><body><main><fixture-connections></fixture-connections><fixture-dialog></fixture-dialog></main><script type="module">
  import { registerModelAuthElement, registerModelConnectionPanelElement } from "/model-auth-element.js";
  registerModelConnectionPanelElement("fixture-connections"); registerModelAuthElement("fixture-dialog");
  const providers = ${fixture}; providers[0].oauthCredentials.forEach(account => account.models = providers[0].models); const panel = document.querySelector("fixture-connections"), dialog = document.querySelector("fixture-dialog");
  panel.providers = providers; panel.theme = "dark";
  dialog.providers = providers; dialog.theme = "dark"; dialog.open = false;
  window.fixtureEvents = [];
  window.fixtureWizardProviders = [
    { id: "single", name: "Single account service", description: "OAuth", authMethods: ["oauth"], available: true, models: [], oauthCredentials: [{ id: "single-1", label: "Only", account: "one@example.test", enabled: true, healthy: true, models: [] }] },
    { id: "broken", name: "Broken account service", description: "OAuth", authMethods: ["oauth"], available: true, models: [], oauthCredentials: [{ id: "broken-1", label: "Expired", enabled: true, healthy: false, models: [] }] },
  ];
  panel.addEventListener("manage", event => { const target = event.detail[0]; window.fixtureEvents.push(["manage", target]); dialog.initialConnection = target; dialog.open = true; });
  panel.addEventListener("refresh", () => window.fixtureEvents.push(["refresh"]));
  panel.addEventListener("add", () => window.fixtureEvents.push(["add"]));
  dialog.addEventListener("close", () => { dialog.open = false; });
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
  assert.equal(await panel.locator('[data-provider-id="oauth"] [data-part="connection-account"]').count(), 0, "multi-credential cards start collapsed");
  assert.equal(await panel.locator('[data-part="toggle-connection"]').count(), 1, "single-credential cards render their row directly");
  for (const toggle of await panel.locator('[data-part="toggle-connection"]').all()) await toggle.click();
  assert.ok(await panel.evaluate(element => { const text = element.shadowRoot.textContent; return text.includes("已停用") && text.includes("需要重新连接") && text.includes("Host integration unavailable"); }));
  assert.equal(await panel.locator('input[type="password"], input[type="text"]').count(), 0);
  assert.equal(await panel.evaluate(element => element.shadowRoot.textContent.includes("fixture-secret-must-not-render")), false);
  await panel.locator('[data-provider-id="key"] [data-part="view-connection"]').click();
  await page.locator("fixture-dialog").locator('[data-part="connection-info"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixtureEvents.at(-1)), ["manage", { providerId: "key", method: "api-key" }]);
  assert.equal(await page.locator("fixture-dialog").locator('[part="progress"]').count(), 0);
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
  assert.equal(await page.locator("fixture-dialog").locator('[data-part="models"], [data-part="connection-policy"], [part="strategy"]').count(), 0, "dialog shows neither models nor strategy");
  const dialogSize = await page.locator("fixture-dialog").evaluate(element => { const root = element.shadowRoot.querySelector('[data-part="connection-info"]'); return { width: root.clientWidth, scroll: root.scrollWidth }; });
  assert.ok(dialogSize.scroll <= dialogSize.width, `long models overflow: ${dialogSize.scroll}/${dialogSize.width}`);
  const refreshBox = await page.locator("fixture-dialog").locator('[data-part="refresh-connections"]').boundingBox();
  assert.ok(refreshBox.height < 48 && refreshBox.width > 48, `refresh button squeezed to ${refreshBox.width}x${refreshBox.height}`);
  const downSlots = await page.locator("fixture-dialog").evaluate(element => [...element.shadowRoot.querySelectorAll('[data-part="move-down"], .model-auth-move-spacer')].map(node => { const box = node.getBoundingClientRect(); return [Math.round(box.x), Math.round(box.width)]; }));
  const downButton = downSlots[1], spacerBox = downSlots.at(-1);
  assert.deepEqual(spacerBox, downButton, "reorder spacer matches the arrow button width and column");
  const arrowsInSummary = await page.locator("fixture-dialog").evaluate(element => [...element.shadowRoot.querySelectorAll(".model-auth-move")].every(button => button.closest(".model-auth-credential-summary")));
  assert.ok(arrowsInSummary, "reorder arrows sit on the credential status line");
  const summaryHeights = await page.locator("fixture-dialog").evaluate(element => [...element.shadowRoot.querySelectorAll(".model-auth-credential-summary")].map(node => ({ height: node.getBoundingClientRect().height, label: node.querySelector(".model-auth-row-main").getBoundingClientRect().width })));
  for (const summary of summaryHeights) assert.ok(summary.height < 120 && summary.label > 100, `credential summary squeezed: ${JSON.stringify(summary)}`);
  await page.screenshot({ path: join(artifact, "connection-panel-detail.png"), fullPage: true });
  const wizard = page.locator("fixture-dialog");
  await wizard.locator('[data-part="close"]').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const dialog = document.querySelector("fixture-dialog");
    dialog.providers = [...dialog.providers, ...window.fixtureWizardProviders];
    dialog.initialConnection = null; dialog.open = true;
  });
  const rows = wizard.locator('[data-part="provider-step"] [part="provider-row"]');
  await rows.first().waitFor();
  const row = wizard.locator('[data-provider-id="single"]');
  const rowBox = await row.boundingBox();
  assert.ok(rowBox.height > 40, `provider row collapsed to ${rowBox.height}px`);
  assert.ok(await row.locator("strong").isVisible() && (await row.locator("strong").boundingBox()).width > 0, "provider name is visible at 390px");
  await page.screenshot({ path: join(artifact, "model-auth-provider-step-narrow.png"), fullPage: true });
  await row.click();
  await wizard.locator('[data-part="credential-settings"]').first().waitFor();
  for (const part of ["move-up", "move-down", "reconnect"]) assert.equal(await wizard.locator(`[data-part="${part}"]`).count(), 0, `single healthy credential must not show ${part}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(artifact, "model-auth-detail-healthy.png"), fullPage: true });
  await wizard.locator('[data-part="back"]').click();
  await wizard.locator('[data-provider-id="broken"]').click();
  await wizard.locator('[data-part="reconnect"]').waitFor();
  assert.equal(await wizard.locator('[data-part="reconnect"]').count(), 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(artifact, "model-auth-detail-unhealthy.png"), fullPage: true });
  console.log("Connection panel browser checks passed");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
