import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { scanSurfaces } from "../tooling/appearance-check/dist/surfaces.js";
const require = createRequire(import.meta.url);
import { chromium } from "@playwright/test";
let browser;
const records = [];
before(async () => {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
});
after(async () => {
    await browser.close();
    if (process.env.APPEARANCE_RESULTS)
        await writeFile(process.env.APPEARANCE_RESULTS, JSON.stringify(records, null, 2));
});
async function scan(name, markup) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
        await page.setContent('<!doctype html><html><body style="margin:20px;background:white">' + markup + '</body></html>');
        const result = await page.evaluate(scanSurfaces);
        records.push({ name, result });
        return result;
    }
    finally {
        await page.close();
    }
}
function pair(outer = "", inner = "", wrap = false) {
    const child = '<article id="inner" style="width:100%;height:100%;box-sizing:border-box;background:#fff;border-radius:20px;' + inner + '">Surface</article>';
    return '<section id="outer" style="width:280px;height:180px;box-sizing:border-box;padding:4px;background:#1a4d8f;border-radius:24px;' + outer + '">' + (wrap ? '<div style="width:100%;height:100%"><div style="display:contents">' + child + '</div></div>' : child) + '</section>';
}
test("discovers a correct nested surface without annotations", async () => {
    const result = await scan("correct", pair());
    assert.equal(result.relationships.length, 1);
    assert.deepEqual(result.findings, []);
});
test("detects equal inner and outer radii using measured inset", async () => {
    const result = await scan("wrong-equal-radius", pair("", "border-radius:24px"));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].maxError, 4);
    assert.equal(result.findings[0].evidence[0].expected.x, 20);
});
test("recognition does not depend on tag names or ids", async () => {
    const html = pair("", "border-radius:24px").replaceAll("section", "div").replaceAll("article", "main").replaceAll(' id="outer"', "").replaceAll(' id="inner"', "");
    const result = await scan("no-markers", html);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].maxError, 4);
});
test("collapses transparent wrappers and display contents", async () => {
    const result = await scan("transparent-wrappers", pair("", "border-radius:24px", true));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].outer, "#outer");
    assert.equal(result.findings[0].inner, "#inner");
});
test("reported targets remain valid across deep transparent wrappers", async () => {
    const html = '<div style="width:280px;height:180px">'.repeat(8) + pair("", "border-radius:24px").replaceAll(' id="outer"', "").replaceAll(' id="inner"', "") + '</div>'.repeat(8);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
        await page.setContent(html);
        const result = await page.evaluate(scanSurfaces);
        assert.equal(result.findings.length, 1);
        assert.equal(await page.locator(result.findings[0].inner).count(), 1);
        assert.equal(await page.locator(result.findings[0].outer).count(), 1);
        records.push({ name: "deep-wrapper-targets", result });
    }
    finally {
        await page.close();
    }
});
test("inset includes parent border and padding", async () => {
    const result = await scan("border-plus-padding", pair("border:2px solid #111;padding:6px", "border-radius:16px"));
    assert.equal(result.relationships.length, 1);
    assert.deepEqual(result.findings, []);
});
test("does not invent an inner edge when fills match and the child has no border", async () => {
    const result = await scan("no-visible-inner-boundary", pair("background:#fff;border:1px solid #111", "background:#fff;border-radius:24px"));
    assert.deepEqual(result.relationships, []);
    assert.deepEqual(result.findings, []);
});
test("does not treat an independent button as a nested surface", async () => {
    const result = await scan("independent-button", '<section style="width:320px;height:200px;padding:8px;background:#eee;border-radius:24px"><button style="width:90px;height:40px;border:0;background:#1a4d8f;color:white;border-radius:4px">Action</button><p>Other content</p></section>');
    assert.deepEqual(result.relationships, []);
    assert.deepEqual(result.findings, []);
});
test("discovers the corners shared by a top surface", async () => {
    const result = await scan("top-surface", pair("", "height:80px;border-radius:24px 24px 0 0"));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].relationship, "top-surface");
    assert.equal(result.findings[0].evidence.length, 2);
});
test("does not treat a full-width independent control as a top surface", async () => {
    const result = await scan("full-width-independent-button", '<section style="width:280px;height:180px;box-sizing:border-box;padding:4px;background:#eee;border-radius:24px"><button style="width:100%;height:40px;background:#1a4d8f;border:0;border-radius:4px">Action</button></section>');
    assert.deepEqual(result.relationships, []);
});
test("supports elliptical radii and unequal insets", async () => {
    const result = await scan("ellipse", pair("padding:3px 5px;border-radius:30px / 20px", "border-radius:25px / 17px"));
    assert.equal(result.relationships.length, 1);
    assert.deepEqual(result.findings, []);
});
test("normalizes oversized pill radii to browser-used radii", async () => {
    const result = await scan("pill-normalization", pair("width:240px;height:48px;border-radius:999px", "border-radius:999px"));
    assert.equal(result.relationships.length, 1);
    assert.deepEqual(result.findings, []);
});
test("resolves percentage radii independently on each surface", async () => {
    const result = await scan("percentage-circle", pair("width:200px;height:200px;border-radius:50%", "border-radius:50%"));
    assert.equal(result.relationships.length, 1);
    assert.deepEqual(result.findings, []);
});
test("ignores closed details and display-none ancestors", async () => {
    const result = await scan("hidden-content", '<details><summary>Closed</summary>' + pair("", "border-radius:24px") + '</details><div style="display:none">' + pair("", "border-radius:24px") + '</div>');
    assert.deepEqual(result.relationships, []);
    assert.deepEqual(result.findings, []);
});
test("reports unsupported clipping instead of inventing a radius failure", async () => {
    const result = await scan("parent-clipping", pair("overflow:hidden", "border-radius:0"));
    assert.equal(result.findings.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.status, "partial");
});
test("reports unsupported transformed geometry", async () => {
    const result = await scan("rotation", pair("transform:rotate(5deg)", "border-radius:24px"));
    assert.equal(result.findings.length, 0);
    assert.ok(result.skipped.length >= 2);
    assert.equal(result.status, "partial");
});
test("reports zoom and clipped paint geometry as partial coverage", async () => {
    for (const style of ["zoom:1.25", "clip-path:circle(50%)"]) {
        const result = await scan(style, pair(style, "border-radius:24px"));
        assert.equal(result.findings.length, 0);
        assert.equal(result.status, "partial");
    }
});
test("a transparent header separator does not invent painted top corners", async () => {
    const result = await scan("separator-only", pair("", "background:transparent;border-radius:0;height:60px;border-bottom:1px solid #111"));
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.relationships, []);
});
test("identifies Vue slot and Teleport surfaces from their rendered DOM", async () => {
    const fixture = await readFile(new URL("./fixtures/appearance-vue.html", import.meta.url));
    const runtime = await readFile(require.resolve("vue/dist/vue.global.prod.js"));
    const server = createServer((request, response) => {
        response.setHeader("Content-Type", request.url === "/vue.js" ? "text/javascript" : "text/html");
        response.end(request.url === "/vue.js" ? runtime : fixture);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = "http://127.0.0.1:" + address.port;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
        await page.goto(url, { waitUntil: "networkidle" });
        const result = await page.evaluate(scanSurfaces);
        records.push({ name: "vue-rendered-components", result });
        assert.equal(result.relationships.length, 3);
        assert.equal(result.findings.length, 2);
        assert.deepEqual(result.findings.map(finding => finding.outer).sort(), ["#slot-bad", "#teleported"].sort());
        if (process.env.APPEARANCE_SCREENSHOT)
            await page.screenshot({ path: process.env.APPEARANCE_SCREENSHOT, fullPage: true });
        const processResult = await promisify(execFile)(process.execPath, ["tooling/appearance-check/dist/cli.js", "--url", url, "--checks", "AP003", "--viewport", "1280x900", "--json", ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? ["--executable-path", process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE] : [])], { cwd: new URL("..", import.meta.url), env: process.env }).catch(error => error);
        assert.equal(processResult.code, 2);
        const cliScan = JSON.parse(processResult.stdout);
        assert.equal(cliScan.findings.length, 2);
    }
    finally {
        await page.close();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
