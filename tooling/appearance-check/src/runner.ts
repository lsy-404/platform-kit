import { chromium } from "playwright";
import type { Page } from "playwright";
import { checks, isCheckId } from "./catalog.js";
import { scanSurfaces } from "./surfaces.js";
import { inspectLayout } from "./layout.js";
import { inspectColors } from "./colors.js";
import type { AuditOptions, BrowserResult, Finding, Ignore, Report, State } from "./types.js";

export function validateOptions(options: AuditOptions): void {
  if (!Array.isArray(options.urls) || !options.urls.length) throw new Error("At least one URL is required");
  for (const value of options.urls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs can be audited");
  }
  if (options.checks?.some(id => !isCheckId(id))) throw new Error("Unknown check ID");
  if (options.viewports && (!options.viewports.length || options.viewports.some(v => !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 1 || v.height < 1))) throw new Error("Invalid viewport");
  for (const ignore of options.ignores ?? []) {
    if (!ignore.reason?.trim() || !(ignore.checkId || ignore.page || ignore.selector || ignore.state)) throw new Error("Each ignore requires a scope and reason");
    if (ignore.checkId && !isCheckId(ignore.checkId)) throw new Error("Unknown ignore check ID");
    if (ignore.state && !["default", "hover", "focus"].includes(ignore.state)) throw new Error("Unknown ignore state");
  }
  for (const value of [options.maxControls, options.timeoutMs]) if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error("Limits must be positive integers");
}

export function pageMatches(pattern: string, url: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const regex = new RegExp("^" + escaped + "$");
  const parsed = new URL(url);
  return regex.test(url) || regex.test(parsed.pathname) || parsed.hash.startsWith("#/") && regex.test(parsed.hash.slice(1).split("?")[0]!);
}

async function matchesIgnore(page: Page, finding: Finding, ignore: Ignore): Promise<boolean> {
  if (ignore.checkId && ignore.checkId !== finding.checkId || ignore.state && ignore.state !== finding.state || ignore.page && !pageMatches(ignore.page, finding.page)) return false;
  if (!ignore.selector) return true;
  return page.locator(finding.target).first().evaluate((element, selector) => element.matches(selector) || element.closest(selector) !== null, ignore.selector);
}

async function settle(page: Page): Promise<void> {
  const delay = await page.evaluate(() => {
    let longest = 0;
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const milliseconds = (value: string) => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000));
      const durations = milliseconds(style.transitionDuration), delays = milliseconds(style.transitionDelay);
      for (let i = 0; i < durations.length; i++) longest = Math.max(longest, (durations[i] ?? 0) + (delays[i % delays.length] ?? 0));
    }
    return Math.min(2000, longest + 50);
  });
  await page.waitForTimeout(delay);
}

export async function auditAppearance(options: AuditOptions): Promise<Report> {
  validateOptions(options);
  const enabled = options.checks ?? checks.map(check => check.id);
  const report: Report = { findings: [], suppressed: [], coverage: [], pages: [] };
  const browser = await chromium.launch({ headless: true, executablePath: options.executablePath });
  try {
    for (const url of options.urls) for (const viewport of options.viewports ?? [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs ?? 15000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push("Page error: " + error.message));
      page.on("response", response => { if (response.status() >= 400) errors.push("HTTP " + response.status() + ": " + response.url()); });
      const add = async (result: BrowserResult, state: State) => {
        for (const skipped of result.skipped) report.coverage.push({ ...skipped, page: url, viewport, state });
        for (const raw of result.findings) {
          if (!enabled.includes(raw.checkId)) continue;
          const finding: Finding = { ...raw, page: url, viewport, state };
          let suppressed = false;
          for (const ignore of options.ignores ?? []) if (await matchesIgnore(page, finding, ignore)) {
            report.suppressed.push({ ...finding, reason: ignore.reason });
            suppressed = true;
            break;
          }
          if (!suppressed) report.findings.push(finding);
        }
      };
      try {
        const response = await page.goto(url, { waitUntil: "load" });
        if (response && response.status() >= 400) throw new Error("HTTP " + response.status());
        await page.waitForLoadState("networkidle", { timeout: Math.min(options.timeoutMs ?? 15000, 2000) }).catch(() => {
          report.coverage.push({ page: url, viewport, state: "default", target: "document", reason: "Network did not settle; current rendered state was inspected" });
        });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        if (enabled.includes("AP003")) {
          const scan = await page.evaluate(scanSurfaces);
          await add({
            findings: scan.findings.map(f => ({ checkId: "AP003", target: f.inner, related: f.outer, message: "Nested radii differ from outer radius minus measured inset", confidence: "heuristic", evidence: { relationship: f.relationship, corners: f.evidence, maxError: f.maxError } })),
            skipped: scan.skipped.map(s => ({ checkId: "AP003", target: s.target, reason: s.reason })),
          }, "default");
        }
        await add(await page.evaluate(inspectLayout, enabled), "default");
        if (enabled.includes("AP001")) await add(await inspectColors(page, "default"), "default");
        const controls = await page.evaluate(() => {
          function selector(element: Element): string {
            if (element.id && document.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
            const parts: string[] = [];
            for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
              const siblings = [...(node.parentElement?.children ?? [])].filter(child => child.tagName === node!.tagName);
              parts.unshift(node.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")");
            }
            return "body > " + parts.join(" > ");
          }
          return [...document.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[tabindex]")].filter(element => {
            const box = element.getBoundingClientRect();
            return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth && !element.matches(":disabled,[aria-disabled=true],[tabindex='-1']");
          }).map(selector);
        });
        report.pages.push({ page: url, viewport, controls: controls.length });
        if (enabled.includes("AP002")) {
          const limit = options.maxControls ?? 40;
          for (const target of controls.slice(limit)) report.coverage.push({ page: url, viewport, state: "hover", target, checkId: "AP002", reason: "Control limit reached; hover and focus were not inspected" });
          for (const target of controls.slice(0, limit)) {
            const control = page.locator(target);
            for (const state of ["hover", "focus"] as const) {
              try {
                await page.mouse.move(0, 0);
                await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
                if (state === "hover") await control.hover({ timeout: 2000 });
                else {
                  await page.keyboard.press("Tab");
                  await control.focus({ timeout: 2000 });
                }
                await settle(page);
                await add(await inspectColors(page, state, target), state);
              } catch (error) {
                report.coverage.push({ page: url, viewport, state, target, checkId: "AP002", reason: String(error) });
              }
            }
          }
        }
        const unsupported = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.shadowRoot || el.tagName === "IFRAME").filter(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).map(el => el.tagName.toLowerCase()));
        for (const target of unsupported) report.coverage.push({ page: url, viewport, state: "default", target, reason: "Shadow DOM and iframe contents are outside the inspected document" });
      } catch (error) {
        report.coverage.push({ page: url, viewport, state: "default", target: "document", reason: String(error) });
      } finally {
        for (const reason of errors) report.coverage.push({ page: url, viewport, state: "default", target: "document", reason });
        await context.close();
      }
    }
    return report;
  } finally { await browser.close(); }
}
