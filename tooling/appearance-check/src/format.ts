import { checkInfo } from "./catalog.js";
import type { Finding, PageMetrics, Report } from "./types.js";

const percent = (share: number) => Math.round(share * 100) + "%";
const scope = (item: { page: string; viewport: { width: number; height: number }; colorScheme: string }) => `${item.page} ${item.viewport.width}x${item.viewport.height} ${item.colorScheme}`;

function metricLines(m: PageMetrics): string[] {
  const hues = m.palette.hueFamilies.map(h => `hue ${Math.round(h.hue)}° ×${h.colors.length} colors, surface ${percent(h.surfaceShare)}`).join("; ");
  const palette = `${m.palette.neutral} neutral, ${m.palette.chromatic} chromatic${hues ? ` (${hues})` : ""}`
    + (m.palette.surfaces.length ? `; surfaces ${m.palette.surfaces.map(s => `${s.color} ${percent(s.share)}`).join(", ")}` : "");
  const type = [
    m.type.bodySize === null ? "no body text" : `body ${m.type.bodySize}px`,
    `sizes ${m.type.sizes.map(s => s.px).join(" ")}`,
    `families ${m.type.families.map(f => f.family + (f.code ? " (code)" : "")).join(", ")}`,
    `weights ${m.type.weights.map(w => w.weight).join(" ")}`,
  ].join("; ");
  const s = m.spacing;
  const spacing = [
    s.baseUnit === null ? `no 2/4/8 px grid (4 px fit ${s.fit[4].toFixed(2)})` : `${s.baseUnit}px grid (fit ${s.fit[s.baseUnit].toFixed(2)})`,
    `${s.distinct} distinct`,
    ...s.offGrid.length ? ["off-grid " + s.offGrid.map(o => `${o.px}px×${o.count}`).join(", ")] : [],
  ].join("; ");
  return [`Metrics ${scope(m)}`, "  palette  " + palette, "  type     " + type, "  spacing  " + spacing];
}

function sorted(findings: Finding[]): Finding[] {
  const normative = (f: Finding) => Number(f.severity !== "normative");
  const viewport = (f: Finding) => f.viewport.width + "x" + f.viewport.height;
  return [...findings].sort((a, b) => normative(a) - normative(b) || a.checkId.localeCompare(b.checkId) || a.page.localeCompare(b.page)
    || viewport(a).localeCompare(viewport(b)) || a.colorScheme.localeCompare(b.colorScheme) || a.state.localeCompare(b.state));
}

export function formatReport(report: Report): string {
  const lines = ["Appearance review: " + report.verdict.toUpperCase()];
  for (const row of report.summary) lines.push(`  ${row.dimension.padEnd(15)}${row.verdict.toUpperCase().padEnd(12)}${row.conclusion}`);
  const notes = report.summary.filter(row => row.notes.length);
  if (notes.length) {
    lines.push("Notes");
    for (const row of notes) for (const note of row.notes) lines.push(`  ${row.dimension}: ${note}`);
  }
  for (const m of report.metrics) lines.push(...metricLines(m));
  if (report.findings.length) {
    lines.push("Findings");
    for (const f of sorted(report.findings)) lines.push(`  [${f.checkId} ${checkInfo(f.checkId).severity}] ${scope(f)} ${f.state} ${f.target}: ${f.message}`);
  }
  if (report.coverage.length) {
    lines.push("Coverage");
    for (const gap of report.coverage) lines.push(`  [${gap.checkId ? gap.checkId + " " : ""}${gap.level}] ${scope(gap)} ${gap.state} ${gap.target}: ${gap.checkId ? "not inspected: " : ""}${gap.reason}`);
  }
  const normative = report.findings.filter(f => f.severity === "normative").length;
  const count = (level: string) => report.coverage.filter(gap => gap.level === level).length;
  lines.push(`${report.findings.length} finding(s) (${normative} normative, ${report.findings.length - normative} advisory), ${report.suppressed.length} suppressed, ${report.coverage.length} coverage gap(s) (${count("blocking")} blocking, ${count("info")} info); ${report.pages.length} scan(s).`);
  return lines.join("\n");
}
