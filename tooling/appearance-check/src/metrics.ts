import { differenceEuclidean, oklch, parse } from "culori";
import type { DesignColor, DesignSample, DesignUse } from "./design.js";
import type { DesignBaseline, DesignToken } from "./tokens.js";
import type { BrowserResult, CheckId, Dimension, PageMetrics, RawFinding, Skipped } from "./types.js";

const deltaOK = differenceEuclidean("oklab");
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const half = (value: number): number => Math.round(value * 2) / 2;

const parseHex = (value: string) => {
  const color = parse(value);
  if (!color) throw new Error("Unparseable color " + value);
  return color;
};
const chroma = (value: string): number => oklch(parseHex(value)).c;
const hueOf = (value: string): number => oklch(parseHex(value)).h ?? 0;
const channels = (value: string): number[] => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const channelDelta = (a: string, b: string): number => {
  const x = channels(a), y = channels(b);
  return Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
};

function detectDrift(colors: DesignColor[]): { findings: RawFinding[]; capped: boolean } {
  const findings: RawFinding[] = [];
  for (const role of ["text", "background", "border"] as const) {
    const group = colors.filter(c => c.role === role).sort((a, b) => b.count - a.count);
    const reported = new Set<string>();
    for (const minor of group) {
      let best: { major: DesignColor; delta: number; channel: number } | null = null;
      for (const major of group) {
        if (major === minor || major.count < 3 || minor.count > major.count / 3) continue;
        const cm = chroma(minor.value), cM = chroma(major.value);
        const channel = channelDelta(minor.value, major.value);
        const delta = deltaOK(parseHex(minor.value), parseHex(major.value));
        const flagged = cm >= 0.04 && cM >= 0.04 ? delta > 0 && delta < 0.02
          : cm < 0.02 && cM < 0.02 ? channel >= 1 && channel <= 2
          : false;
        if (flagged && (!best || delta < best.delta)) best = { major, delta, channel };
      }
      if (!best || reported.has(minor.value)) continue;
      if (findings.length >= 20) return { findings, capped: true };
      reported.add(minor.value);
      findings.push({
        checkId: "AP019",
        target: minor.examples[0] ?? "body",
        ...(best.major.examples[0] ? { related: best.major.examples[0] } : {}),
        message: "Color differs from a more common color by less than a noticeable step; likely an untokenized value.",
        confidence: "heuristic",
        evidence: { role, color: minor.value, nearest: best.major.value, deltaEOK: best.delta, channelDelta: best.channel, usage: { color: minor.count, nearest: best.major.count }, examples: minor.examples },
      });
    }
  }
  return { findings, capped: false };
}

const FINDING_LIMIT = 20;

/**
 * A rarely used value that sits next to a much more common one reads as an untokenized copy of it:
 * the common value is used at least three times and at least three times as often as the minor one.
 */
function detectUseDrift(
  checkId: CheckId, entries: DesignUse[], near: (minor: number, major: number) => boolean,
  message: string, evidence: (minor: DesignUse, major: DesignUse) => Record<string, unknown>,
): { findings: RawFinding[]; capped: boolean } {
  const findings: RawFinding[] = [];
  const sorted = [...entries].sort((a, b) => b.count - a.count || a.px - b.px);
  for (const minor of sorted) {
    let best: DesignUse | null = null;
    for (const major of sorted) {
      if (major === minor || major.px === minor.px || major.count < 3 || minor.count > major.count / 3 || !near(minor.px, major.px)) continue;
      if (!best || Math.abs(major.px - minor.px) < Math.abs(best.px - minor.px)) best = major;
    }
    if (!best) continue;
    if (findings.length >= FINDING_LIMIT) return { findings, capped: true };
    findings.push({
      checkId,
      target: minor.examples[0] ?? "body",
      ...(best.examples[0] ? { related: best.examples[0] } : {}),
      message,
      confidence: "heuristic",
      evidence: { ...evidence(minor, best), usage: { value: minor.count, nearest: best.count }, examples: minor.examples },
    });
  }
  return { findings, capped: false };
}

function detectScaleDrift(sample: DesignSample): { findings: RawFinding[]; capped: CheckId[] } {
  const findings: RawFinding[] = [], capped: CheckId[] = [];
  const collect = (checkId: CheckId, result: { findings: RawFinding[]; capped: boolean }) => {
    findings.push(...result.findings);
    if (result.capped && !capped.includes(checkId)) capped.push(checkId);
  };
  collect("AP024", detectUseDrift("AP024", sample.fontSizes, (a, b) => Math.abs(a - b) <= 1,
    "Font size is within 1 px of a more common size; likely off the type scale.",
    (minor, major) => ({ fontSize: minor.px, nearest: major.px })));
  const radius = (["control", "small", "surface"] as const).map(kind => detectUseDrift("AP025", sample.radii.filter(r => r.kind === kind && r.shape === "radius"), (a, b) => Math.abs(a - b) <= Math.max(1, 0.25 * b),
    "Corner radius is close to a more common radius of the same kind of element; likely off the radius scale.",
    (minor, major) => ({ kind, radius: minor.px, nearest: major.px })));
  const radiusFindings = radius.flatMap(result => result.findings);
  collect("AP025", { findings: radiusFindings.slice(0, FINDING_LIMIT), capped: radiusFindings.length > FINDING_LIMIT || radius.some(result => result.capped) });
  collect("AP026", detectUseDrift("AP026", sample.controls, (a, b) => Math.abs(a - b) <= Math.max(2, 0.08 * b),
    "Control height is close to a more common control height; likely off the size scale.",
    (minor, major) => ({ height: minor.px, nearest: major.px })));
  return { findings, capped };
}

function detectOffGrid(sample: DesignSample, spacing: PageMetrics["spacing"]): { findings: RawFinding[]; capped: boolean } {
  const findings: RawFinding[] = [];
  const unit = spacing.baseUnit;
  if (unit === null) return { findings, capped: false };
  const off = sample.spacingUse.filter(use => !fitsGrid(use, unit)).sort((a, b) => a.px - b.px || b.count - a.count);
  for (const use of off) {
    if (findings.length >= FINDING_LIMIT) return { findings, capped: true };
    findings.push({
      checkId: "AP027",
      target: use.examples[0] ?? "body",
      message: `Spacing of ${use.px} px is off the ${unit} px grid the rest of the page follows.`,
      confidence: "heuristic",
      evidence: { px: use.px, ...(use.alt === undefined ? {} : { padding: use.alt }), grid: unit, fit: spacing.fit[unit], count: use.count, properties: use.properties, examples: use.examples },
    });
  }
  return { findings, capped: false };
}

const DESIGN_LIMIT = 40;

function detectOffToken(sample: DesignSample, baseline: DesignBaseline): { findings: RawFinding[]; capped: boolean } {
  const findings: RawFinding[] = [];
  let capped = false;
  const add = (kind: string, value: number | string, nearest: { name: string; value: number | string; delta: number } | null, use: { count: number; examples: string[] }, extra: Record<string, unknown> = {}) => {
    if (findings.length >= DESIGN_LIMIT) { capped = true; return; }
    findings.push({
      checkId: "AP033",
      target: use.examples[0] ?? "body",
      message: `Rendered ${kind} ${typeof value === "number" ? value + (kind === "font-weight" ? "" : " px") : value} is not a design baseline token.`,
      confidence: "measured",
      evidence: { kind, value, nearest, count: use.count, examples: use.examples, ...extra },
    });
  };
  const nearestOf = (tokens: DesignToken[], value: number) => tokens.reduce<{ name: string; value: number; delta: number } | null>((best, token) => {
    const delta = Math.abs(token.value - value);
    return !best || delta < best.delta ? { name: token.name, value: token.value, delta } : best;
  }, null);
  if (baseline.colors.length) {
    const merged = new Map<string, { roles: string[]; count: number; examples: string[] }>();
    for (const color of sample.colors) {
      const entry = merged.get(color.value) ?? { roles: [], count: 0, examples: [] };
      if (!entry.roles.includes(color.role)) entry.roles.push(color.role);
      entry.count += color.count;
      for (const example of color.examples) if (entry.examples.length < 3 && !entry.examples.includes(example)) entry.examples.push(example);
      merged.set(color.value, entry);
    }
    for (const [value, use] of [...merged].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
      const nearest = baseline.colors.reduce<{ name: string; value: string; delta: number } | null>((best, token) => {
        const delta = deltaOK(parseHex(value), parseHex(token.value));
        return !best || delta < best.delta ? { name: token.name, value: token.value, delta: round3(delta) } : best;
      }, null);
      if (nearest && nearest.delta >= 0.02) add("color", value, nearest, use, { roles: use.roles });
    }
  }
  if (baseline.fontSizes.length) {
    for (const use of [...sample.fontSizes].sort((a, b) => a.px - b.px)) {
      const nearest = nearestOf(baseline.fontSizes, use.px);
      if (nearest && nearest.delta > 0.5) add("font-size", use.px, nearest, use);
    }
  }
  if (baseline.fontWeights.length) {
    for (const use of [...sample.fontWeights].sort((a, b) => a.px - b.px)) {
      const nearest = nearestOf(baseline.fontWeights, use.px);
      if (nearest && nearest.delta > 0) add("font-weight", use.px, nearest, use);
    }
  }
  if (baseline.radii.length) {
    const full = baseline.radii.find(token => token.value >= 100);
    for (const use of [...sample.radii].sort((a, b) => a.px - b.px)) {
      if (use.shape !== "radius") {
        if (!full) add("radius", use.shape, null, use, { shape: use.shape, elementKind: use.kind });
        continue;
      }
      const nearest = nearestOf(baseline.radii, use.px);
      if (nearest && nearest.delta > 0.5) add("radius", use.px, nearest, use, { shape: use.shape, elementKind: use.kind });
    }
  }
  if (baseline.spacing.length) {
    for (const use of [...sample.spacingUse].sort((a, b) => a.px - b.px)) {
      const nearest = nearestOf(baseline.spacing, use.px), bare = use.alt === undefined ? null : nearestOf(baseline.spacing, use.alt);
      if (nearest && nearest.delta > 0.5 && (!bare || bare.delta > 0.5)) add("spacing", use.px, nearest, use, { properties: use.properties, ...(use.alt === undefined ? {} : { padding: use.alt }) });
    }
  }
  return { findings, capped };
}

function paletteMetrics(sample: DesignSample): PageMetrics["palette"] {
  const weights = new Map<string, number>();
  for (const color of sample.colors) weights.set(color.value, (weights.get(color.value) ?? 0) + color.weight + color.count);
  const clusters: Array<{ center: string; members: string[] }> = [];
  for (const [value] of [...weights].sort((a, b) => b[1] - a[1])) {
    const near = clusters.find(cluster => deltaOK(parseHex(value), parseHex(cluster.center)) < 0.02);
    if (near) near.members.push(value); else clusters.push({ center: value, members: [value] });
  }
  const chromatic = clusters.filter(cluster => chroma(cluster.center) >= 0.03);
  const clusterIndex = (value: string): number => {
    let best = -1, bestDelta = 0.02;
    chromatic.forEach((cluster, index) => { const d = deltaOK(parseHex(value), parseHex(cluster.center)); if (d < bestDelta) { best = index; bestDelta = d; } });
    return best;
  };

  const totalSurface = sample.surfaces.reduce((sum, s) => sum + s.count, 0);
  const surfaceShare = (color: string) => totalSurface ? sample.surfaces.filter(s => s.color === color).reduce((sum, s) => sum + s.count, 0) / totalSurface : 0;
  const hues = chromatic.map((cluster, index) => ({ index, hue: hueOf(cluster.center) })).sort((a, b) => a.hue - b.hue);
  const families: Array<typeof hues> = [];
  if (hues.length) {
    let cut = 0, widest = -1;
    hues.forEach((entry, i) => {
      const next = hues[(i + 1) % hues.length]!;
      const gap = (next.hue - entry.hue + 360) % 360 || (hues.length === 1 ? 360 : 0);
      if (gap > widest) { widest = gap; cut = (i + 1) % hues.length; }
    });
    const ordered = [...hues.slice(cut), ...hues.slice(0, cut)];
    let current = [ordered[0]!];
    for (const entry of ordered.slice(1)) {
      const previous = current[current.length - 1]!;
      if ((entry.hue - previous.hue + 360) % 360 >= 30) { families.push(current); current = []; }
      current.push(entry);
    }
    families.push(current);
  }
  const hueFamilies = families.map(family => {
    const x = family.reduce((sum, e) => sum + Math.cos(e.hue * Math.PI / 180), 0), y = family.reduce((sum, e) => sum + Math.sin(e.hue * Math.PI / 180), 0);
    const members = family.map(e => chromatic[e.index]!);
    const indices = new Set(family.map(e => e.index));
    const share = sample.surfaces.filter(s => s.color !== "media" && indices.has(clusterIndex(s.color))).reduce((sum, s) => sum + s.count, 0);
    return { hue: Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360), colors: members.map(m => m.center), surfaceShare: round3(totalSurface ? share / totalSurface : 0) };
  });

  const surfaceColors = [...new Set(sample.surfaces.map(s => s.color))];
  const totalChars = sample.text.reduce((sum, t) => sum + (t.color ? t.chars : 0), 0);
  const textByColor = new Map<string, number>();
  for (const run of sample.text) if (run.color) textByColor.set(run.color, (textByColor.get(run.color) ?? 0) + run.chars);
  return {
    neutral: clusters.length - chromatic.length,
    chromatic: chromatic.length,
    hueFamilies,
    surfaces: surfaceColors.map(color => ({ color, share: round3(surfaceShare(color)) })).sort((a, b) => b.share - a.share).slice(0, 5),
    text: [...textByColor].map(([color, chars]) => ({ color, share: round3(totalChars ? chars / totalChars : 0) })).sort((a, b) => b.share - a.share).slice(0, 5),
  };
}

function typeMetrics(sample: DesignSample): PageMetrics["type"] {
  const total = sample.text.reduce((sum, t) => sum + t.chars, 0);
  const share = (map: Map<number, number>) => [...map].map(([key, chars]) => ({ key, share: total ? chars / total : 0 })).sort((a, b) => a.key - b.key);
  const sizeChars = new Map<number, number>(), weightChars = new Map<number, number>(), bodyChars = new Map<number, number>();
  const familyChars = new Map<string, { chars: number; code: boolean }>();
  let small = 0;
  for (const run of sample.text) {
    const size = half(run.size);
    sizeChars.set(size, (sizeChars.get(size) ?? 0) + run.chars);
    const weight = Math.round(run.weight / 100) * 100;
    weightChars.set(weight, (weightChars.get(weight) ?? 0) + run.chars);
    if (!run.code) bodyChars.set(size, (bodyChars.get(size) ?? 0) + run.chars);
    const key = run.family + "|" + run.code;
    familyChars.set(key, { chars: (familyChars.get(key)?.chars ?? 0) + run.chars, code: run.code });
    if (run.size < 11) small += run.chars;
  }
  const sizes = share(sizeChars).filter(s => s.share >= 0.005).map(s => ({ px: s.key, share: round3(s.share) }));
  const nearDuplicateSizes: Array<[number, number]> = [];
  for (let i = 1; i < sizes.length; i++) if (sizes[i]!.px / sizes[i - 1]!.px < 1.05) nearDuplicateSizes.push([sizes[i - 1]!.px, sizes[i]!.px]);
  const body = [...bodyChars].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return {
    bodySize: body ? body[0] : null,
    sizes,
    nearDuplicateSizes,
    families: [...familyChars].map(([key, v]) => ({ family: key.split("|")[0]!, share: round3(total ? v.chars / total : 0), code: v.code })).sort((a, b) => b.share - a.share),
    weights: share(weightChars).map(w => ({ weight: w.key, share: round3(w.share) })),
    smallTextShare: round3(total ? small / total : 0),
  };
}

const onGrid = (px: number, unit: number): boolean => Math.min(px % unit, unit - px % unit) <= 0.5;
/** A bordered inset fits when either its outer measure or its bare padding does. */
const fitsGrid = (use: { px: number; alt?: number }, unit: number): boolean => onGrid(use.px, unit) || use.alt !== undefined && onGrid(use.alt, unit);

function spacingMetrics(sample: DesignSample): PageMetrics["spacing"] {
  const uses = sample.spacingUse;
  const samples = uses.reduce((sum, use) => sum + use.count, 0);
  const fitOf = (unit: number) => samples ? uses.filter(use => fitsGrid(use, unit)).reduce((sum, use) => sum + use.count, 0) / samples : 0;
  const fit = { 2: round3(fitOf(2)), 4: round3(fitOf(4)), 8: round3(fitOf(8)) };
  const baseUnit = ([8, 4, 2] as const).find(unit => fitOf(unit) >= 0.85) ?? null;
  const counts = new Map<number, number>();
  for (const use of uses) counts.set(use.px, (counts.get(use.px) ?? 0) + use.count);
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  let distinct = 0, previous = -Infinity;
  for (const v of sorted) { if (v - previous > 1) distinct++; previous = v; }
  const unit = baseUnit ?? 4;
  const off = new Map<number, number>();
  for (const use of uses) if (!fitsGrid(use, unit)) off.set(use.px, (off.get(use.px) ?? 0) + use.count);
  const offGrid = [...off].filter(([, count]) => count >= 3).map(([px, count]) => ({ px, count })).sort((a, b) => b.count - a.count || a.px - b.px);
  return { samples, fit, baseUnit, distinct, offGrid };
}

/** Checks whose findings come from the sampled design; a sampling gap applies to each of them. */
export const DESIGN_CHECKS: readonly CheckId[] = ["AP019", "AP024", "AP025", "AP026", "AP027", "AP033"];

export function analyzeDesign(sample: DesignSample, baseline?: DesignBaseline): {
  drift: BrowserResult;
  metrics: Omit<PageMetrics, "page" | "viewport" | "colorScheme">;
  notes: Partial<Record<Dimension, string[]>>;
} {
  const ids = DESIGN_CHECKS.filter(id => id !== "AP033" || baseline);
  const skipped: Skipped[] = sample.skipped.flatMap(entry => ids.map(checkId => ({ checkId, target: entry.target, reason: entry.reason })));
  const limit = (checkId: CheckId, limit: number) => skipped.push({ checkId, target: "body", reason: `Finding limit (${limit}) reached; further values not reported` });
  const drift = detectDrift(sample.colors);
  if (drift.capped) skipped.push({ checkId: "AP019", target: "body", reason: "Color drift finding limit (20) reached; further drift not reported" });
  const palette = paletteMetrics(sample), type = typeMetrics(sample), spacing = spacingMetrics(sample);
  const scale = detectScaleDrift(sample);
  for (const checkId of scale.capped) limit(checkId, FINDING_LIMIT);
  const grid = detectOffGrid(sample, spacing);
  if (grid.capped) limit("AP027", FINDING_LIMIT);
  const tokens = baseline ? detectOffToken(sample, baseline) : { findings: [], capped: false };
  if (tokens.capped) limit("AP033", DESIGN_LIMIT);

  const color: string[] = [], typography: string[] = [], layout: string[] = [];
  if (palette.hueFamilies.length > 5) color.push(`${palette.hueFamilies.length} hue families in use`);
  if (sample.scheme === "dark") {
    if (palette.surfaces[0]?.color === "#000000" && palette.surfaces[0].share > 0.5) color.push("Pure black main surface in dark theme");
    if (palette.text[0]?.color === "#ffffff" && palette.text[0].share > 0.5) color.push("Pure white body text in dark theme");
  }
  if (type.sizes.length > 8) typography.push(`${type.sizes.length} distinct font sizes`);
  const odd = type.sizes.filter(size => Number.isInteger(size.px) && size.px % 2 === 1).map(size => size.px);
  if (odd.length) typography.push(`Odd font sizes ${odd.join("/")} px`);
  for (const [a, b] of type.nearDuplicateSizes) typography.push(`Near-duplicate sizes ${a}/${b} px`);
  const proportional = type.families.filter(f => !f.code).length;
  if (proportional > 3) typography.push(`${proportional} font families`);
  if (type.weights.length > 4) typography.push(`${type.weights.length} font weights`);
  if (type.bodySize !== null && type.bodySize < 14) typography.push(`Body text ${type.bodySize} px`);
  if (type.smallTextShare > 0.05) typography.push(`${Math.round(type.smallTextShare * 100)}% of text below 11 px`);
  if (spacing.samples > 0) {
    if (spacing.baseUnit === null) layout.push(`Spacing fits no 2/4/8 px grid (4 px fit ${spacing.fit[4].toFixed(2)})`);
    if (spacing.distinct > 20) layout.push(`${spacing.distinct} distinct spacing values`);
  }

  const notes: Partial<Record<Dimension, string[]>> = {};
  if (color.length) notes.color = color;
  if (layout.length) notes.layout = layout;
  if (typography.length) notes.typography = typography;
  return { drift: { findings: [...drift.findings, ...scale.findings, ...grid.findings, ...tokens.findings], skipped }, metrics: { palette, type, spacing }, notes };
}
