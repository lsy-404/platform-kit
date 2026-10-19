import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { checkInfo, defaultCheckIds, isCheckId, prerequisiteMet } from "./catalog.js";
import { summarize } from "./summary.js";
import { scanSurfaces } from "./surfaces.js";
import { inspectLayout } from "./layout.js";
import { inspectDefaultAxe, inspectDocumentAxe } from "./axe.js";
import { discoverControls, runInteractions } from "./interaction.js";
import { inspectNonText } from "./nontext.js";
import { inspectRhythm } from "./rhythm.js";
import { inspectFonts, inspectTypography } from "./typography.js";
import { inspectEmoji } from "./emoji.js";
import { checkTextSpacing } from "./text-spacing.js";
import { collectDesign } from "./design.js";
import { analyzeDesign, DESIGN_CHECKS } from "./metrics.js";
import { inspectShapes } from "./shapes.js";
import { inspectAlignment } from "./alignment.js";
import { designBaseline, parseDesignMarkdown } from "./tokens.js";
import { compareThemes } from "./theme.js";
import type { ThemeText } from "./design.js";
import type { DesignBaseline } from "./tokens.js";
import { installKit } from "./kit.js";
import { probeReflow, settlePage } from "./reflow.js";
import { probeMotion } from "./motion.js";
import type { AuditOptions, BrowserResult, CheckId, ColorScheme, DesignTokens, Dimension, Finding, GapLevel, Ignore, Report, State, Viewport } from "./types.js";

export function validateOptions(options: AuditOptions): void {
  if (!Array.isArray(options.urls) || !options.urls.length) throw new Error("At least one URL is required");
  for (const value of options.urls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs can be audited");
  }
  if (options.checks?.some(id => !isCheckId(id))) throw new Error("Unknown check ID");
  if (options.design !== undefined && (typeof options.design === "string" ? !options.design.trim() : !options.design || typeof options.design !== "object" || Array.isArray(options.design))) throw new Error("Design must be a file path or a token object");
  if (options.checks?.includes("AP033") && !prerequisiteMet(checkInfo("AP033"), options)) throw new Error("AP033 requires a design baseline (design option or --design)");
  if (options.checks?.includes("AP034") && !prerequisiteMet(checkInfo("AP034"), options)) throw new Error("AP034 compares themes and requires both light and dark color schemes");
  if (options.viewports && (!options.viewports.length || options.viewports.some(v => !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 1 || v.height < 1))) throw new Error("Invalid viewport");
  if (options.colorSchemes !== undefined && (!Array.isArray(options.colorSchemes) || !options.colorSchemes.length || options.colorSchemes.some(scheme => scheme !== "light" && scheme !== "dark"))) throw new Error("Color schemes must be a non-empty array of light or dark");
  for (const ignore of options.ignores ?? []) {
    if (ignore.colorScheme !== undefined && ignore.colorScheme !== "light" && ignore.colorScheme !== "dark") throw new Error("Unknown ignore color scheme");
    if (!ignore.reason?.trim() || !(ignore.checkId || ignore.page || ignore.selector || ignore.state || ignore.colorScheme)) throw new Error("Each ignore requires a scope and reason");
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

async function matchesIgnore(getPage: () => Promise<Page>, finding: Finding, ignore: Ignore): Promise<boolean> {
  if (ignore.checkId && ignore.checkId !== finding.checkId || ignore.state && ignore.state !== finding.state || ignore.colorScheme && ignore.colorScheme !== finding.colorScheme || ignore.page && !pageMatches(ignore.page, finding.page)) return false;
  if (!ignore.selector) return true;
  const page = await getPage();
  return page.locator(finding.target).first().evaluate((element, selector) => element.matches(selector) || element.closest(selector) !== null, ignore.selector);
}

const DEFAULT_VIEWPORTS: Viewport[] = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];

/** Reads a DESIGN.md front matter or a JSON token file; token objects pass through. */
export async function loadDesign(design: string | DesignTokens): Promise<DesignBaseline> {
  if (typeof design !== "string") return designBaseline(design);
  const text = await readFile(design, "utf8");
  return designBaseline(/\.json$/i.test(design) ? JSON.parse(text) as DesignTokens : parseDesignMarkdown(text));
}

export async function auditAppearance(options: AuditOptions): Promise<Report> {
  validateOptions(options);
  const enabled = options.checks ?? defaultCheckIds(options);
  const baseline = options.design === undefined ? undefined : await loadDesign(options.design);
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS, schemes = options.colorSchemes ?? ["light" as const];
  const timeout = options.timeoutMs ?? 15000;
  const firstVp = viewports[0]!, firstScheme = schemes[0]!;
  const report: Omit<Report, "verdict" | "summary"> = { findings: [], suppressed: [], coverage: [], pages: [], metrics: [] };
  const notes: Partial<Record<Dimension, Set<string>>> = {};
  const browser = await chromium.launch({ headless: true, executablePath: options.executablePath });
  try {
    for (const url of options.urls) {
      const themeText: Partial<Record<ColorScheme, ThemeText[]>> = {};
      // Findings that come from a closed scan open a page on demand when an ignore needs its selector.
      const onDemand = (viewport: Viewport, colorScheme: ColorScheme, extra: { reducedMotion?: "reduce" } = {}) => {
        let context: BrowserContext | undefined;
        let pagePromise: Promise<Page> | undefined;
        const getPage = () => pagePromise ??= (async () => {
          context = await browser.newContext({ viewport, colorScheme, ...extra, deviceScaleFactor: 1 });
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);
          await page.goto(url, { waitUntil: "load" });
          return page;
        })();
        return { getPage, close: async () => { await context?.close(); } };
      };
      // Ignore selectors are resolved on the page the finding came from; probes open one on demand.
      const adder = (viewport: Viewport, colorScheme: ColorScheme, getPage: () => Promise<Page>) => async (result: BrowserResult, state: State) => {
        for (const skipped of result.skipped) if (enabled.includes(skipped.checkId)) report.coverage.push({ ...skipped, page: url, viewport, colorScheme, state, level: "check" });
        for (const raw of result.findings) {
          if (!enabled.includes(raw.checkId)) continue;
          const info = checkInfo(raw.checkId);
          const finding: Finding = { ...raw, page: url, viewport, colorScheme, state, severity: info.severity, dimensions: [...info.dimensions] };
          let suppressed = false;
          for (const ignore of options.ignores ?? []) if (await matchesIgnore(getPage, finding, ignore)) {
            report.suppressed.push({ ...finding, reason: ignore.reason });
            suppressed = true;
            break;
          }
          if (!suppressed) report.findings.push(finding);
        }
      };
      const runProbe = async (kind: "reflow" | "motion") => {
        const viewport = kind === "reflow" ? { width: 320, height: 640 } : firstVp;
        const { getPage, close } = onDemand(viewport, firstScheme, kind === "motion" ? { reducedMotion: "reduce" } : {});
        try {
          const { result, page } = kind === "reflow"
            ? await probeReflow(browser, url, firstScheme, { timeoutMs: timeout })
            : await probeMotion(browser, url, firstVp, firstScheme, { timeoutMs: timeout });
          report.pages.push(page);
          try {
            await adder(page.viewport, firstScheme, getPage)(result, "default");
          } catch (error) {
            report.coverage.push({ page: url, viewport: page.viewport, colorScheme: firstScheme, state: "default", target: "document", checkId: kind === "reflow" ? "AP014" : "AP017", reason: String(error), level: "check" });
          }
        } finally { await close(); }
      };
      for (const viewport of viewports) for (const colorScheme of schemes) {
        const context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        const errors: Array<{ reason: string; level: GapLevel }> = [];
        page.on("pageerror", error => errors.push({ reason: "Page error: " + error.message, level: "info" }));
        page.on("response", response => {
          const request = response.request();
          if (response.status() < 400 || request.isNavigationRequest() && request.frame() === page.mainFrame()) return;
          errors.push({ reason: "HTTP " + response.status() + ": " + response.url(), level: request.resourceType() === "stylesheet" ? "blocking" : "info" });
        });
        page.on("requestfailed", request => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return;
          errors.push({ reason: "Request failed: " + request.url() + " (" + (request.failure()?.errorText ?? "unknown") + ")", level: request.resourceType() === "stylesheet" ? "blocking" : "info" });
        });
        const add = adder(viewport, colorScheme, async () => page);
        // A failing step becomes check-level gaps so the remaining checks still run.
        const step = async (ids: CheckId[], run: () => Promise<void>) => {
          const active = ids.filter(id => enabled.includes(id));
          if (!active.length) return;
          try { await run(); } catch (error) {
            for (const checkId of active) report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", checkId, reason: String(error), level: "check" });
          }
        };
        try {
          const response = await page.goto(url, { waitUntil: "load" });
          if (response && response.status() >= 400) throw new Error("HTTP " + response.status());
          await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 2000) }).catch(() => {
            report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", reason: "Network did not settle; current rendered state was inspected", level: "info" });
          });
          await page.evaluate(() => document.fonts.ready);
          await settlePage(page);
          await page.evaluate(installKit);
          const entry: Report["pages"][number] = { page: url, viewport, colorScheme, kind: "scan", controls: 0 };
          report.pages.push(entry);
          const firstSchemeScan = colorScheme === firstScheme, firstViewportScan = viewport === firstVp;

          await step(["AP003"], async () => {
            const scan = await page.evaluate(scanSurfaces);
            await add({
              findings: scan.findings.map(f => ({ checkId: "AP003", target: f.inner, related: f.outer, message: "Nested radii differ from outer radius minus measured inset", confidence: "heuristic", evidence: { relationship: f.relationship, corners: f.evidence, maxError: f.maxError } })),
              skipped: scan.skipped.map(s => ({ checkId: "AP003", target: s.target, reason: s.reason })),
            }, "default");
          });
          await step(["AP004", "AP005", "AP006", "AP007", "AP008"], async () => add(await page.evaluate(inspectLayout, enabled), "default"));
          await step(["AP001", "AP009", "AP010"], async () => add(await inspectDefaultAxe(page, enabled), "default"));
          await step(["AP016"], async () => add(await page.evaluate(inspectNonText), "default"));
          if (firstSchemeScan) {
            await step(["AP020"], async () => add(await page.evaluate(inspectRhythm, enabled), "default"));
            await step(["AP021", "AP022"], async () => add(await page.evaluate(inspectTypography, enabled), "default"));
            await step(["AP015"], async () => add(await checkTextSpacing(page), "default"));
            await step(["AP028", "AP029"], async () => add(await page.evaluate(inspectShapes, enabled), "default"));
            await step(["AP030", "AP031", "AP032"], async () => add(await page.evaluate(inspectAlignment, enabled), "default"));
          }
          if (firstViewportScan) {
            try {
              const sample = await page.evaluate(collectDesign);
              themeText[colorScheme] = sample.themeText;
              const design = analyzeDesign(sample, baseline);
              report.metrics.push({ page: url, viewport, colorScheme, ...design.metrics });
              for (const [dimension, list] of Object.entries(design.notes) as Array<[Dimension, string[]]>) for (const note of list) (notes[dimension] ??= new Set()).add(note);
              await add(design.drift, "default");
            } catch (error) {
              const ids = [...DESIGN_CHECKS, "AP034" as const].filter(id => enabled.includes(id));
              if (!ids.length) report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", reason: "Design metrics unavailable: " + String(error), level: "info" });
              for (const checkId of ids) report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", checkId, reason: String(error), level: "check" });
            }
          }
          if (firstSchemeScan && firstViewportScan) {
            await step(["AP011", "AP018"], async () => add(await inspectDocumentAxe(page, enabled), "default"));
            await step(["AP023"], async () => add(await page.evaluate(inspectFonts), "default"));
            await step(["AP035"], async () => add(await page.evaluate(inspectEmoji, enabled), "default"));
          }
          const controls = await page.evaluate(discoverControls);
          entry.controls = controls.length;
          await step(["AP002", "AP012", "AP013"], () => runInteractions(page, controls, { enabled, maxControls: options.maxControls ?? 40 }, add));
          const unsupported = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.shadowRoot || el.tagName === "IFRAME").filter(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).map(el => el.tagName.toLowerCase()));
          for (const target of unsupported) report.coverage.push({ page: url, viewport, colorScheme, state: "default", target, reason: "Shadow DOM and iframe contents are outside the inspected document", level: "info" });
        } catch (error) {
          report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", reason: String(error), level: "blocking" });
        } finally {
          for (const { reason, level } of errors) report.coverage.push({ page: url, viewport, colorScheme, state: "default", target: "document", reason, level });
          await context.close();
        }
      }
      if (enabled.includes("AP034")) {
        if (themeText.light && themeText.dark) {
          const { getPage, close } = onDemand(firstVp, "dark");
          try { await adder(firstVp, "dark", getPage)(compareThemes(themeText.light, themeText.dark), "default"); } finally { await close(); }
        } else if (themeText.light || themeText.dark) {
          report.coverage.push({ page: url, viewport: firstVp, colorScheme: "dark", state: "default", target: "document", checkId: "AP034", reason: "Light and dark samples of the first viewport are both needed to compare themes", level: "check" });
        }
      }
      if (enabled.includes("AP014")) await runProbe("reflow");
      if (enabled.includes("AP017")) await runProbe("motion");
    }
    const { verdict, summary } = summarize(report, enabled, report.pages.filter(p => p.kind === "scan").length);
    for (const row of summary) row.notes = [...notes[row.dimension] ?? []];
    return { verdict, summary, ...report };
  } finally { await browser.close(); }
}
