import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectTypography(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const leading = enabled.includes("AP021"), measure = enabled.includes("AP022");
  if (!leading && !measure) return { findings, skipped };

  const PROSE = "p, li, blockquote, dd, figcaption";
  const MAX_BLOCKS = 200;
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  const round = (value: number): number => Math.round(value * 100) / 100;

  let examined = 0;
  for (const block of Array.from(document.querySelectorAll(PROSE))) {
    if (block.querySelector(PROSE) || block.closest("pre, code, nav, table, svg, [role=navigation]")) continue;
    if (!kit.visible(block) || kit.decorative(block)) continue;
    const style = getComputedStyle(block);
    if (style.columnCount !== "auto" && style.columnCount !== "1") continue;
    if (++examined > MAX_BLOCKS) {
      skipped.push({ checkId: leading ? "AP021" : "AP022", target: "body", reason: "Prose block limit reached; remaining blocks were not checked." });
      break;
    }
    const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
    const lines = kit.lines(block);
    if (lines.length < 3) continue;
    const fontSize = parseFloat(style.fontSize);

    if (leading && text.length >= 80 && fontSize >= 12 && fontSize <= 24 && !/mono/i.test(style.fontFamily)) {
      const pitches = lines.slice(1).map((line, i) => line.top - lines[i]!.top);
      const pitch = median(pitches);
      const ratio = pitch / fontSize;
      if (ratio < 1.2) {
        findings.push({
          checkId: "AP021",
          target: kit.selector(block),
          message: "Multi-line body text has line spacing below 1.2.",
          confidence: "measured",
          evidence: { ratio: round(ratio), pitch: round(pitch), fontSize, lines: lines.length },
        });
      }
    }

    if (measure && text.length >= 200) {
      const script = kit.script(text);
      const full = lines.slice(0, -1).map(line => line.width);
      const total = lines.reduce((sum, line) => sum + line.width, 0);
      const charsPerLine = total > 0 ? text.length * median(full) / total : 0;
      if (charsPerLine > (script === "cjk" ? 40 : 80)) {
        findings.push({
          checkId: "AP022",
          target: kit.selector(block),
          message: "Lines are longer than the recommended reading measure.",
          confidence: "measured",
          evidence: { charsPerLine: round(charsPerLine), lines: lines.length, script, blockWidth: round(block.getBoundingClientRect().width), fontSize },
        });
      }
    }
  }
  return { findings, skipped };
}

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export async function inspectFonts(): Promise<BrowserResult> {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  await document.fonts.ready;

  const clean = (family: string): string => family.trim().replace(/^["']|["']$/g, "");
  const faces = Array.from(document.fonts);
  const loaded = new Set(faces.filter(face => face.status === "loaded").map(face => [clean(face.family).toLowerCase(), face.weight, face.style].join("|")));
  for (const face of faces) if (face.status === "loading") skipped.push({ checkId: "AP023", target: clean(face.family), reason: "Font face was still loading after fonts.ready." });

  const failed = new Map<string, { family: string; faces: Array<{ weight: string; style: string; unicodeRange: string }> }>();
  for (const face of faces) {
    if (face.status !== "error" || loaded.has([clean(face.family).toLowerCase(), face.weight, face.style].join("|"))) continue;
    const key = clean(face.family).toLowerCase();
    const entry = failed.get(key) ?? { family: clean(face.family), faces: [] };
    entry.faces.push({ weight: face.weight, style: face.style, unicodeRange: face.unicodeRange });
    failed.set(key, entry);
  }
  if (!failed.size) return { findings, skipped };

  const owners = new Map<string, Element[]>();
  for (const { owner } of kit.textRuns()) {
    const first = clean((getComputedStyle(owner).fontFamily.split(",")[0] ?? "")).toLowerCase();
    const list = owners.get(first) ?? [];
    if (!list.includes(owner)) { list.push(owner); owners.set(first, list); }
  }
  for (const [key, entry] of failed) {
    const users = owners.get(key);
    if (!users?.length) continue;
    findings.push({
      checkId: "AP023",
      target: kit.selector(users[0]!),
      message: "Declared web font failed to load; a fallback font is rendered.",
      confidence: "measured",
      evidence: { family: entry.family, failedFaces: entry.faces, owners: users.slice(0, 3).map(owner => kit.selector(owner)) },
    });
  }
  return { findings, skipped };
}
