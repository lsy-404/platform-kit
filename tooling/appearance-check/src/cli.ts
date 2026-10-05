#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { auditAppearance } from "./runner.js";
import { checks, isCheckId } from "./catalog.js";
import { formatReport } from "./format.js";
import type { AuditOptions, CheckId } from "./types.js";

const help = `appearance-check --url http://localhost:5173 [options]
  --config FILE         JSON AuditOptions, including precise ignores
  --checks AP003,AP005   Run selected check IDs
  --ignore-check AP003   Disable a check (repeatable)
  --viewport 390x844     Viewport (repeatable; default desktop + mobile)
  --executable-path FILE Chromium executable; default Playwright Chromium
  --max-controls N      Hover/focus limit per page (default 40)
  --timeout N           Page timeout in milliseconds (default 15000)
  --json                Print JSON instead of text
  --output FILE         Save the report instead of printing
  --warn-only           Findings and coverage gaps do not set a failure exit
  --list                List stable check IDs
Exit: 0 clean, 1 invalid input or incomplete coverage, 2 findings.`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: "string", multiple: true }, config: { type: "string" }, checks: { type: "string" },
    "ignore-check": { type: "string", multiple: true }, viewport: { type: "string", multiple: true },
    "executable-path": { type: "string" }, "max-controls": { type: "string" }, timeout: { type: "string" },
    json: { type: "boolean" }, output: { type: "string" }, "warn-only": { type: "boolean" }, list: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) console.log(help);
  else if (values.list) console.log(checks.map(check => `${check.id} ${check.name} — ${check.description}`).join("\n"));
  else {
    const options: AuditOptions = values.config ? JSON.parse(await readFile(values.config, "utf8")) : { urls: [] };
    const urls = [...values.url ?? [], ...positionals];
    if (urls.length) options.urls = urls;
    if (values.checks !== undefined) {
      const ids = values.checks.split(",");
      if (ids.some(id => !isCheckId(id))) throw new Error("Unknown check ID in --checks");
      options.checks = ids as CheckId[];
    }
    for (const id of values["ignore-check"] ?? []) {
      if (!isCheckId(id)) throw new Error("Unknown check ID: " + id);
      options.checks = (options.checks ?? checks.map(check => check.id)).filter(check => check !== id);
    }
    if (values.viewport) options.viewports = values.viewport.map(value => {
      if (!/^\d+x\d+$/.test(value)) throw new Error("Viewport must be WIDTHxHEIGHT");
      const [width, height] = value.split("x").map(Number);
      return { width: width!, height: height! };
    });
    if (values["executable-path"]) options.executablePath = values["executable-path"];
    if (values["max-controls"]) options.maxControls = Number(values["max-controls"]);
    if (values.timeout) options.timeoutMs = Number(values.timeout);
    const report = await auditAppearance(options);
    const output = values.json ? JSON.stringify(report, null, 2) : formatReport(report);
    if (values.output) await writeFile(values.output, output + "\n");
    else console.log(output);
    if (!values["warn-only"]) process.exitCode = report.coverage.length ? 1 : report.findings.length ? 2 : 0;
  }
} catch (error) {
  console.error("appearance-check: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
