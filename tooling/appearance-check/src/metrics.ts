import { differenceEuclidean, oklch, parse } from "culori";
import type { DesignColor, DesignSample } from "./design.js";
import type { BrowserResult, Dimension, PageMetrics, RawFinding, Skipped } from "./types.js";

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

function detectDrift(colors: DesignColor[]): RawFinding[] {
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
      reported.add(minor.value);
      findings.push({
        checkId: "AP019",
        target: minor.examples[0] ?? "body",
        ...(best.major.examples[0] ? { related: best.major.examples[0] } : {}),
        message: "Color differs from a more common color by less than a noticeable step; likely an untokenized value.",
        confidence: "heuristic",
        evidence: { role, color: minor.value, nearest: best.major.value, deltaEOK: best.delta, channelDelta: best.channel, usage: { color: minor.count, nearest: best.major.count }, examples: minor.examples },
      });
      if (findings.length >= 20) return findings;
    }
  }
  return findings;
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

function spacingMetrics(sample: DesignSample): PageMetrics["spacing"] {
  const values = sample.spacing.map(v => half(Math.abs(v))).filter(v => v > 1);
  const fitOf = (unit: number) => {
    if (!values.length) return 0;
    const near = values.filter(v => { const r = v % unit; return Math.min(r, unit - r) <= 0.5; }).length;
    return near / values.length;
  };
  const fit = { 2: round3(fitOf(2)), 4: round3(fitOf(4)), 8: round3(fitOf(8)) };
  const baseUnit = ([8, 4, 2] as const).find(unit => fitOf(unit) >= 0.85) ?? null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  let distinct = 0, previous = -Infinity;
  for (const v of sorted) { if (v - previous > 1) distinct++; previous = v; }
  const unit = baseUnit ?? 4;
  const offGrid = [...counts].filter(([v, count]) => count >= 3 && Math.min(v % unit, unit - v % unit) > 0.5).map(([px, count]) => ({ px, count })).sort((a, b) => b.count - a.count || a.px - b.px);
  return { samples: values.length, fit, baseUnit, distinct, offGrid };
}

export function analyzeDesign(sample: DesignSample): {
  drift: BrowserResult;
  metrics: Omit<PageMetrics, "page" | "viewport" | "colorScheme">;
  notes: Partial<Record<Dimension, string[]>>;
} {
  const skipped: Skipped[] = sample.skipped.map(entry => ({ checkId: "AP019", target: entry.target, reason: entry.reason }));
  const palette = paletteMetrics(sample), type = typeMetrics(sample), spacing = spacingMetrics(sample);

  const color: string[] = [], typography: string[] = [], layout: string[] = [];
  if (palette.hueFamilies.length > 5) color.push(`${palette.hueFamilies.length} hue families in use`);
  if (sample.scheme === "dark") {
    if (palette.surfaces[0]?.color === "#000000" && palette.surfaces[0].share > 0.5) color.push("Pure black main surface in dark theme");
    if (palette.text[0]?.color === "#ffffff" && palette.text[0].share > 0.5) color.push("Pure white body text in dark theme");
  }
  if (type.sizes.length > 8) typography.push(`${type.sizes.length} distinct font sizes`);
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
  return { drift: { findings: detectDrift(sample.colors), skipped }, metrics: { palette, type, spacing }, notes };
}
