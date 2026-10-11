import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectRhythm(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  if (!enabled.includes("AP020")) return { findings, skipped };

  interface Member { element: Element; rect: DOMRect; classes: Set<string>; signature: string }
  type Item = Member | null;
  const MAX_CONTAINERS = 2000, MAX_FINDINGS = 50;

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  const compatible = (a: Member, b: Member): boolean => {
    if (a.signature !== b.signature) return false;
    if (!a.classes.size || !b.classes.size) return true;
    return [...a.classes].some(name => b.classes.has(name));
  };

  const evaluate = (run: Member[], axis: "x" | "y") => {
    const start = (m: Member) => axis === "x" ? m.rect.left : m.rect.top;
    const end = (m: Member) => axis === "x" ? m.rect.right : m.rect.bottom;
    const ordered = [...run].sort((a, b) => start(a) - start(b));
    const gaps = ordered.slice(1).map((m, i) => start(m) - end(ordered[i]!));
    if (gaps.some(g => g < 0)) return;
    const m = median(gaps);
    if (gaps.filter(g => Math.abs(g - m) <= 0.5).length / gaps.length < 0.75) return;
    const outliers = gaps.map((g, i) => ({ g, i })).filter(({ g }) => Math.abs(g - m) > Math.max(1.5, 0.15 * m) && g <= 2 * m + 2);
    if (!outliers.length || outliers.length > Math.floor(gaps.length / 3)) return;
    for (const { g, i } of outliers) {
      if (findings.length >= MAX_FINDINGS) return;
      findings.push({
        checkId: "AP020",
        target: kit.selector(ordered[i + 1]!.element),
        related: kit.selector(ordered[i]!.element),
        message: "One gap in a run of identical siblings differs from the rest.",
        confidence: "heuristic",
        evidence: { axis, gaps: gaps.map(v => Math.round(v * 100) / 100), median: m, index: i, gap: Math.round(g * 100) / 100 },
      });
    }
  };

  let examined = 0;
  for (const container of Array.from(document.querySelectorAll("body, body *"))) {
    const style = getComputedStyle(container);
    if (!/^(block|flow-root|flex)$/.test(style.display) || container.children.length < 4) continue;
    if (!kit.visible(container)) continue;
    if (++examined > MAX_CONTAINERS) { skipped.push({ checkId: "AP020", target: "body", reason: "Container limit reached; remaining containers were not checked." }); break; }
    const flex = style.display === "flex";
    const axis: "x" | "y" = flex && style.flexDirection.startsWith("row") ? "x" : "y";

    const items: Item[] = [];
    for (const child of Array.from(container.children)) {
      const cs = getComputedStyle(child);
      if (cs.display === "none") continue;
      const inFlow = !/^(contents|inline.*)$/.test(cs.display) && (cs.position === "static" || cs.position === "relative") && cs.float === "none"
        && kit.visible(child) && !kit.geometryIssue(child) && !kit.srOnly(child);
      if (!inFlow) { items.push(null); continue; }
      items.push({
        element: child,
        rect: child.getBoundingClientRect(),
        classes: new Set(Array.from(child.classList)),
        signature: [child.tagName, child.getAttribute("role") ?? "", cs.display].join("|"),
      });
    }

    let run: Member[] = [];
    const flush = () => {
      if (run.length >= 4) {
        if (flex && style.flexWrap !== "nowrap") {
          const lines: Member[][] = [];
          for (const member of run) {
            const line = lines[lines.length - 1];
            const crossStart = (m: Member) => axis === "x" ? m.rect.top : m.rect.left;
            const crossEnd = (m: Member) => axis === "x" ? m.rect.bottom : m.rect.right;
            const overlaps = line && line.some(other => Math.min(crossEnd(other), crossEnd(member)) - Math.max(crossStart(other), crossStart(member)) > 0);
            if (overlaps) line.push(member); else lines.push([member]);
          }
          for (const line of lines) if (line.length >= 4) evaluate(line, axis);
        } else evaluate(run, axis);
      }
      run = [];
    };
    for (const item of items) {
      if (!item) { flush(); continue; }
      const last = run[run.length - 1];
      if (last && !compatible(last, item)) flush();
      run.push(item);
    }
    flush();
  }
  return { findings, skipped };
}
