import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const require = createRequire(new URL("../apps/fluent-preview/package.json", import.meta.url));
const { preview } = await import(require.resolve("vite"));

test("built Fluent preview supports trimming, theme changes, RTL and narrow layouts", async () => {
  const server = await preview({ configFile: false, root: "apps/fluent-preview", preview: { host: "127.0.0.1", port: 0 } });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await mkdir("test/artifacts/visual-center", { recursive: true });
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?theme=${theme}`);
        const section = page.locator("#graphics");
        await section.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => {
          const graphics = [...document.querySelectorAll("#graphics [data-status]")];
          return graphics.length === 7 && graphics.every(node => node.dataset.status === "estimated");
        });
        const bounds = await section.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width, "graphics section leaves the viewport");
        const corrected = section.getByTestId("visual-center-preview").locator(".fluent-svg-icon__paint");
        const before = await corrected.getAttribute("style");
        await section.getByText("Trim transparent space", { exact: true }).click();
        await section.getByText("Visual center estimate", { exact: true }).click();
        assert.notEqual(await corrected.getAttribute("style"), before);
        await section.getByText("Trim transparent space", { exact: true }).click();
        await section.getByText("Visual center estimate", { exact: true }).click();
        await section.getByText("Right-to-left", { exact: true }).click();
        const geometry = await section.getByRole("button", { name: "Play", exact: true }).evaluate(node => {
          const box = node.getBoundingClientRect();
          const icon = node.querySelector(".fluent-icon-text__icon").getBoundingClientRect();
          const label = node.querySelector(".fluent-icon-text__label").getBoundingClientRect();
          return { contained: icon.top >= box.top && icon.bottom <= box.bottom, reversed: icon.left > label.right };
        });
        assert(geometry.contained, "icon must fit inside its button");
        assert(geometry.reversed, "RTL must put the icon after the label visually");
        await section.screenshot({ path: `test/artifacts/visual-center/fluent-graphics-${theme}-${width}.png` });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.httpServer.close(resolve));
  }
});
