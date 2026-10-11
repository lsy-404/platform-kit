import { checkInfo, checks } from "./catalog.js";
import type { CheckId, Dimension, DimensionSummary, Finding, Report, Severity, Verdict } from "./types.js";

const dimensions: Dimension[] = ["accessibility", "color", "layout", "typography"];
const rank: Record<Verdict, number> = { fail: 4, warn: 3, incomplete: 2, pass: 1, "not-run": 0 };

const key = (f: Finding) => [f.checkId, f.page, f.target, f.related ?? ""].join("|");

function unique(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter(f => !seen.has(key(f)) && seen.add(key(f)));
}

function list(findings: Finding[], severity: Severity): string {
  const counts = new Map<CheckId, number>();
  for (const f of findings) if (checkInfo(f.checkId).severity === severity) counts.set(f.checkId, (counts.get(f.checkId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, n]) => `${id} ${checkInfo(id).name} ×${n}`).join(", ");
}

function conclusion(verdict: Verdict, n: { normative: number; advisory: number; gaps: number; blocking: number; checks: number; scans: number }, findings: Finding[]): string {
  const gaps = n.gaps ? `; ${n.gaps} coverage gap(s)` : "";
  switch (verdict) {
    case "fail": return `Fails: ${n.normative} normative issue(s) (${list(findings, "normative")})${n.advisory ? `; ${n.advisory} advisory` : ""}${gaps}.`;
    case "warn": return `Needs review: ${n.advisory} advisory issue(s) (${list(findings, "advisory")})${gaps}.`;
    case "incomplete": return `No issues found, but ${n.gaps + n.blocking} area(s) could not be inspected.`;
    case "pass": return `No issues found by ${n.checks} check(s) across ${n.scans} scan(s).`;
    case "not-run": return "Not checked: no enabled check covers this dimension.";
  }
}

export function summarize(report: Omit<Report, "verdict" | "summary">, enabled: CheckId[], scans: number): { verdict: Verdict; summary: DimensionSummary[] } {
  const blocking = report.coverage.filter(gap => gap.level === "blocking").length;
  const summary = dimensions.map((dimension): DimensionSummary => {
    const ids = checks.filter(check => enabled.includes(check.id) && check.dimensions.includes(dimension)).map(check => check.id);
    const inDimension = (id: CheckId | undefined) => id !== undefined && ids.includes(id);
    const found = unique(report.findings.filter(f => inDimension(f.checkId)));
    const normative = found.filter(f => checkInfo(f.checkId).severity === "normative").length;
    const advisory = found.length - normative;
    const gapList = report.coverage.filter(gap => gap.level === "check" && inDimension(gap.checkId));
    const suppressed = unique(report.suppressed.filter(f => inDimension(f.checkId))).length;
    const verdict: Verdict = !ids.length ? "not-run" : normative ? "fail" : advisory ? "warn" : gapList.length || blocking ? "incomplete" : "pass";
    const byCheck = ids.flatMap(id => {
      const findings = found.filter(f => f.checkId === id).length, gaps = gapList.filter(gap => gap.checkId === id).length;
      const info = checkInfo(id);
      return findings || gaps ? [{ checkId: id, name: info.name, severity: info.severity, findings, gaps }] : [];
    });
    const top = [...found]
      .sort((a, b) => Number(checkInfo(a.checkId).severity === "advisory") - Number(checkInfo(b.checkId).severity === "advisory") || a.checkId.localeCompare(b.checkId) || a.page.localeCompare(b.page))
      .slice(0, 3).map(f => ({ checkId: f.checkId, page: f.page, target: f.target, message: f.message }));
    return {
      dimension, verdict,
      conclusion: conclusion(verdict, { normative, advisory, gaps: gapList.length, blocking, checks: ids.length, scans }, found),
      checks: ids,
      counts: { normative, advisory, suppressed, gaps: gapList.length },
      byCheck, top, notes: [],
    };
  });
  const verdict = summary.reduce<Verdict>((worst, row) => rank[row.verdict] > rank[worst] ? row.verdict : worst, "not-run");
  return { verdict, summary };
}
