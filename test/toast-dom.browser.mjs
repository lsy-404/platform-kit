import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const dist = join(process.cwd(), "styles/toast/dist");
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/toast.css"><script src="/toast.browser.js"></script></head>
<body style="margin:0;background:#888"></body></html>`;
const mime = { ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://test").pathname;
  if (pathname === "/") return response.writeHead(200, { "content-type": "text/html" }).end(page);
  const path = normalize(join(dist, pathname));
  if (!path.startsWith(dist)) return response.writeHead(403).end();
  try { response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgb = value => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

try {
  for (const colorScheme of ["light", "dark"]) {
    const tab = await browser.newPage({ viewport: { width: 1024, height: 700 }, colorScheme, reducedMotion: "no-preference" });
    await tab.goto(`http://127.0.0.1:${port}/`);

    // A paused store keeps timing out of the assertions.
    await tab.evaluate(() => {
      const { createToastStore, mountToastHost } = window.PlatformKitToast;
      window.store = createToastStore({ rate: () => 0, limit: 3 });
      window.host = mountToastHost({ store: window.store, closeLabel: "Close", observeWindow: false });
      window.store.error("<img src=x onerror=alert(1)>", "Upload failed");
      window.store.success("Saved", "Done");
    });
    const cards = tab.locator(".pk-toast");
    await assert.doesNotReject(cards.nth(1).waitFor());
    assert.equal(await cards.count(), 2);
    assert.equal(await cards.nth(0).getAttribute("role"), "alert");
    assert.equal(await cards.nth(1).getAttribute("role"), "status");
    assert.equal(await tab.locator(".pk-toast img").count(), 0, "messages are text, not HTML");
    assert.equal(await cards.nth(0).locator(".pk-toast__message").textContent(), "<img src=x onerror=alert(1)>");

    const host = await tab.locator(".pk-toast-host").boundingBox();
    assert.ok(host.x + host.width <= 1024 - 17 && host.y + host.height <= 700 - 17, "stack sits in the bottom-end corner");

    const colors = await cards.nth(1).evaluate((node) => {
      const card = getComputedStyle(node);
      const message = getComputedStyle(node.querySelector(".pk-toast__message"));
      const title = getComputedStyle(node.querySelector(".pk-toast__title"));
      return { surface: card.backgroundColor, text: message.color, title: title.color };
    });
    assert.ok(contrast(rgb(colors.text), rgb(colors.surface)) >= 4.5, `${colorScheme} message ${colors.text} on ${colors.surface}`);
    assert.ok(contrast(rgb(colors.title), rgb(colors.surface)) >= 4.5, `${colorScheme} success title ${colors.title} on ${colors.surface}`);

    // Updates repaint in place; the limit drops the oldest timed toast.
    await tab.evaluate(() => {
      const [first] = window.store.snapshot();
      window.store.update(first.id, { message: "Retrying" });
      window.store.push("Sticky", { duration: 0 });
      window.store.info("Fourth");
    });
    await tab.waitForFunction(() => document.querySelectorAll(".pk-toast:not(.pk-toast-leave-active)").length === 3);
    const messages = await tab.locator(".pk-toast:not(.pk-toast-leave-active) .pk-toast__message").allTextContents();
    assert.deepEqual(messages, ["Saved", "Sticky", "Fourth"]);

    // Close removes the card after the leave transition.
    await tab.getByRole("button", { name: "Close" }).first().click();
    await tab.waitForFunction(() => document.querySelectorAll(".pk-toast").length === 2);

    // Actions run and dismiss.
    await tab.evaluate(() => {
      window.clicked = 0;
      window.store.push("Update ready", { duration: 0, actions: [{ label: "Restart", primary: true, onClick: () => window.clicked++ }] });
    });
    await tab.getByRole("button", { name: "Restart" }).click();
    assert.equal(await tab.evaluate(() => window.clicked), 1);
    await tab.waitForFunction(() => !document.querySelector(".pk-toast__action"));

    // Hovering the stack engages it; leaving releases it.
    await tab.evaluate(() => {
      window.engaged = [];
      const store = window.PlatformKitToast.createToastStore({ rate: (a) => { window.engaged.push(a.engaged); return 1; } });
      window.host.destroy();
      window.host = window.PlatformKitToast.mountToastHost({ store, observeWindow: false, placement: "top-start", theme: "dark" });
      store.push("Hover", { duration: 0 });
    });
    await tab.locator(".pk-toast").hover();
    await tab.mouse.move(900, 600);
    assert.deepEqual((await tab.evaluate(() => window.engaged)).slice(-2), [true, false]);
    assert.equal(await tab.locator(".pk-toast-host").getAttribute("data-pk-toast-theme"), "dark");
    const corner = await tab.locator(".pk-toast-host").boundingBox();
    assert.ok(corner.x <= 18.5 && corner.y <= 18.5, "top-start placement");

    await tab.evaluate(() => window.host.destroy());
    assert.equal(await tab.locator(".pk-toast-host").count(), 0);
    await tab.close();
  }
  console.log("Toast DOM host: semantics, text safety, limit, actions, engagement, placement and contrast passed.");
} finally {
  await browser.close();
  server.close();
}
