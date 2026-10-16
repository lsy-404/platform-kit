import type { ThemeText } from "./design.js";
import type { BrowserResult, RawFinding } from "./types.js";

const LIMIT = 20;

type Kind = "uncompensated" | "heavier" | "overcompensated";

const messages: Record<Kind, string> = {
  uncompensated: "Light-on-dark text keeps the light theme's size and weight, so it reads larger and bolder in the dark theme; reduce its size, weight or grade slightly.",
  heavier: "The dark theme renders this text larger or heavier than the light theme, which adds to the light-on-dark bloom.",
  overcompensated: "The dark theme shrinks this text well beyond what light-on-dark bloom needs, so it reads smaller than in the light theme.",
};

/**
 * Light text on a dark ground looks larger and bolder than the same type dark on light (irradiation). Text that
 * flips from dark-on-light to light-on-dark between the two theme scans should come out slightly smaller, lighter
 * or lower in grade; any of those counts, since weight and grade compensate without re-wrapping lines.
 */
export function compareThemes(light: ThemeText[], dark: ThemeText[]): BrowserResult {
  const findings: RawFinding[] = [];
  const skipped: BrowserResult["skipped"] = [];
  const byKey = new Map(light.map(entry => [entry.key, entry]));
  const groups = new Map<string, { kind: Kind; light: ThemeText; dark: ThemeText; elements: number; chars: number; examples: string[]; contrast: number }>();
  for (const after of dark) {
    const before = byKey.get(after.key);
    if (!before || before.text !== after.text || before.polarity !== "dark-on-light" || after.polarity !== "light-on-dark" || after.contrast < 3) continue;
    const smaller = after.size < before.size - 0.25, larger = after.size > before.size + 0.25;
    const lighter = after.weight < before.weight, heavier = after.weight > before.weight;
    const grade = (after.grade ?? 0) - (before.grade ?? 0);
    const kind: Kind | null = larger || heavier || grade > 0 ? "heavier"
      : after.size < before.size * 0.9 || before.weight - after.weight >= 200 ? "overcompensated"
      : smaller || lighter || grade < 0 ? null : "uncompensated";
    if (!kind) continue;
    const key = [kind, before.size, before.weight, before.grade, after.size, after.weight, after.grade].join("|");
    const group = groups.get(key) ?? { kind, light: before, dark: after, elements: 0, chars: 0, examples: [], contrast: after.contrast };
    group.elements++;
    group.chars += after.chars;
    group.contrast = Math.max(group.contrast, after.contrast);
    if (group.examples.length < 3) group.examples.push(after.key);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => b.chars - a.chars || a.light.size - b.light.size);
  for (const group of ordered.slice(0, LIMIT)) {
    const style = (entry: ThemeText) => ({ fontSize: entry.size, fontWeight: entry.weight, ...(entry.grade === null ? {} : { grade: entry.grade }) });
    findings.push({
      checkId: "AP034",
      target: group.examples[0]!,
      message: messages[group.kind],
      confidence: "heuristic",
      evidence: { kind: group.kind, light: style(group.light), dark: style(group.dark), elements: group.elements, chars: group.chars, maxContrast: group.contrast, examples: group.examples },
    });
  }
  if (ordered.length > LIMIT) skipped.push({ checkId: "AP034", target: "body", reason: `Finding limit (${LIMIT}) reached; further text styles not reported` });
  return { findings, skipped };
}
