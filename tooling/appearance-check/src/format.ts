import type { Report } from "./types.js";

export function formatReport(report: Report): string {
  const lines = report.findings.map(f => `[${f.checkId}] ${f.page} ${f.viewport.width}x${f.viewport.height} ${f.state} ${f.target}: ${f.message}`);
  for (const gap of report.coverage) lines.push(`[${gap.checkId ?? "coverage"}] ${gap.page} ${gap.viewport.width}x${gap.viewport.height} ${gap.state} ${gap.target}: not inspected: ${gap.reason}`);
  lines.push(`${report.findings.length} warning(s), ${report.suppressed.length} suppressed, ${report.coverage.length} coverage gap(s); ${report.pages.length} page/viewport scan(s).`);
  return lines.join("\n");
}
