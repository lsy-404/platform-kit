#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { auditAppearance } from "./runner.js";
import { checks, defaultCheckIds, isCheckId } from "./catalog.js";
import { formatReport } from "./format.js";
import type { AuditOptions, CheckId } from "./types.js";

const help = `appearance-check --url http://localhost:5173 [options]
  --config FILE         JSON AuditOptions, including precise ignores
  --checks AP003,AP005   Run selected check IDs
  --ignore-check AP003   Disable a check (repeatable)
  --design FILE         DESIGN.md (YAML front matter) or JSON tokens; enables AP033
  --viewport 390x844     Viewport (repeatable; default desktop + mobile)
  --color-scheme light|dark  Emulate prefers-color-scheme (repeatable; default light)
  --executable-path FILE Chromium executable; default Playwright Chromium
  --max-controls N      Hover/focus limit per page (default 40)
  --timeout N           Page timeout in milliseconds (default 15000)
  --json                Print JSON instead of text
  --output FILE         Save the report instead of printing
  --fail-on fail|warn   Also exit 2 on advisory warnings (default fail)
  --warn-only           Findings and coverage gaps do not set a failure exit
  --list                List stable check IDs
Exit: 0 clean or advisory-only, 1 invalid input or incomplete coverage, 2 normative findings (or warnings with --fail-on warn).`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: "string", multiple: true }, config: { type: "string" }, checks: { type: "string" },
    "ignore-check": { type: "string", multiple: true }, viewport: { type: "string", multiple: true },
    "color-scheme": { type: "string", multiple: true }, design: { type: "string" }, "executable-path": { type: "string" }, "max-controls": { type: "string" }, timeout: { type: "string" },
    json: { type: "boolean" }, output: { type: "string" }, "warn-only": { type: "boolean" }, "fail-on": { type: "string" }, list: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) console.log(help);
  else if (values.list) console.log(checks.map(check => `${check.id} ${check.name} [${check.dimensions.join(",")}; ${check.severity}] — ${check.description}${check.requires ? ` (requires --${check.requires})` : ""}`).join("\n"));
  else {
    if (values["fail-on"] !== undefined && values["fail-on"] !== "fail" && values["fail-on"] !== "warn") throw new Error("--fail-on must be fail or warn");
    const options: AuditOptions = values.config ? JSON.parse(await readFile(values.config, "utf8")) : { urls: [] };
    // A design path in a config file is relative to that file; --design is relative to the working directory.
    if (values.config && typeof options.design === "string") options.design = resolve(dirname(values.config), options.design);
    if (values.design) options.design = resolve(values.design);
    const urls = [...values.url ?? [], ...positionals];
    if (urls.length) options.urls = urls;
    if (values.checks !== undefined) {
      const ids = values.checks.split(",");
      if (ids.some(id => !isCheckId(id))) throw new Error("Unknown check ID in --checks");
      options.checks = ids as CheckId[];
    }
    for (const id of values["ignore-check"] ?? []) {
      if (!isCheckId(id)) throw new Error("Unknown check ID: " + id);
      options.checks = (options.checks ?? defaultCheckIds(options)).filter(check => check !== id);
    }
    if (values.viewport) options.viewports = values.viewport.map(value => {
      if (!/^\d+x\d+$/.test(value)) throw new Error("Viewport must be WIDTHxHEIGHT");
      const [width, height] = value.split("x").map(Number);
      return { width: width!, height: height! };
    });
    if (values["color-scheme"]) options.colorSchemes = values["color-scheme"].map(value => {
      if (value !== "light" && value !== "dark") throw new Error("Color scheme must be light or dark");
      return value;
    });
    if (values["executable-path"]) options.executablePath = values["executable-path"];
    if (values["max-controls"]) options.maxControls = Number(values["max-controls"]);
    if (values.timeout) options.timeoutMs = Number(values.timeout);
    const report = await auditAppearance(options);
    const output = values.json ? JSON.stringify(report, null, 2) : formatReport(report);
    if (values.output) await writeFile(values.output, output + "\n");
    else console.log(output);
    if (!values["warn-only"]) {
      const incomplete = report.summary.some(row => row.verdict === "incomplete") || report.coverage.some(gap => gap.level === "blocking");
      process.exitCode = report.verdict === "fail" || values["fail-on"] === "warn" && report.summary.some(row => row.verdict === "warn") ? 2 : incomplete ? 1 : 0;
    }
  }
} catch (error) {
  console.error("appearance-check: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
