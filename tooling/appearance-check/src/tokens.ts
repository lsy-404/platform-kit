import { formatHex, parse } from "culori";
import type { DesignTokens } from "./types.js";

export interface DesignToken { name: string; value: number }
export interface DesignColorToken { name: string; value: string }
/** Token values flattened to comparable numbers (px) and hex colors. */
export interface DesignBaseline {
  colors: DesignColorToken[];
  fontSizes: DesignToken[];
  fontWeights: DesignToken[];
  radii: DesignToken[];
  spacing: DesignToken[];
}

type Mapping = { [key: string]: string | Mapping };

const SECTIONS = ["colors", "typography", "rounded", "spacing"] as const;

const unquote = (value: string): string => {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[1] === '"' ? quoted[2]!.replace(/\\(["\\])/g, "$1") : quoted[2]!.replaceAll("''", "'") : value;
};
const stripComment = (line: string): string => {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
};

/**
 * Reads the colors, typography, rounded and spacing mappings from the YAML front matter of a DESIGN.md file.
 * Other top-level keys (description, components and the like) are skipped unparsed, so their YAML may be anything.
 */
export function parseDesignMarkdown(markdown: string): DesignTokens {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error("DESIGN.md has no YAML front matter between --- lines");
  const lines = match[1]!.split(/\r?\n/);
  const tokens: Record<string, Mapping> = {};
  let section: Mapping | null = null;
  let stack: Array<{ indent: number; node: Mapping }> = [];
  lines.forEach((raw, index) => {
    const where = `DESIGN.md front matter line ${index + 2}`;
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const indent = raw.length - raw.trimStart().length;
    const line = stripComment(raw).trim();
    if (indent === 0) {
      const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      section = null;
      if (top && (SECTIONS as readonly string[]).includes(top[1]!)) {
        if (top[2]) throw new Error(`${where}: ${top[1]} must be a nested mapping`);
        section = tokens[top[1]!] = {};
        stack = [{ indent: 0, node: section }];
      }
      return;
    }
    if (!section) return;
    if (/^\t/.test(raw)) throw new Error(`${where}: tabs are not valid YAML indentation`);
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const pair = /^("[^"]*"|'[^']*'|[^:{}[\]]+?)\s*:(?:\s+(.*)|$)/.exec(line);
    if (!pair) throw new Error(`${where}: expected "key: value" in a mapping`);
    const key = unquote(pair[1]!.trim()), value = pair[2]?.trim() ?? "";
    if (/^[[{]/.test(value)) throw new Error(`${where}: flow collections are not supported; use one key per line`);
    const parent = stack[stack.length - 1]!.node;
    if (value) parent[key] = unquote(value);
    else {
      const child: Mapping = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    }
  });
  const result: DesignTokens = {};
  const strings = (map: Mapping | undefined) => map && Object.fromEntries(Object.entries(map).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  if (tokens.colors) result.colors = strings(tokens.colors);
  if (tokens.typography) result.typography = Object.fromEntries(Object.entries(tokens.typography).filter(([, value]) => typeof value === "object")) as DesignTokens["typography"];
  if (tokens.rounded) result.rounded = strings(tokens.rounded);
  if (tokens.spacing) result.spacing = strings(tokens.spacing);
  return result;
}

/** Converts a token length to CSS px; rem and em use the 16 px default root size. */
export function tokenLength(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/i.exec(String(value ?? ""));
  if (!match) return null;
  return Number(match[1]) * (match[2] && match[2].toLowerCase() !== "px" ? 16 : 1);
}

export function designBaseline(tokens: DesignTokens): DesignBaseline {
  const lengths = (map: Record<string, string | number> | undefined): DesignToken[] => Object.entries(map ?? {})
    .map(([name, raw]) => ({ name, value: tokenLength(raw) }))
    .filter((token): token is DesignToken => token.value !== null && token.value >= 0);
  const baseline: DesignBaseline = {
    colors: Object.entries(tokens.colors ?? {}).flatMap(([name, raw]) => {
      const color = typeof raw === "string" && !raw.includes("{") ? parse(raw) : undefined;
      return color ? [{ name, value: formatHex(color) }] : [];
    }),
    fontSizes: Object.entries(tokens.typography ?? {}).flatMap(([name, style]) => {
      const value = tokenLength(style?.fontSize as string | number | undefined);
      return value === null ? [] : [{ name, value }];
    }),
    fontWeights: Object.entries(tokens.typography ?? {}).flatMap(([name, style]) => {
      const value = Number(style?.fontWeight);
      return Number.isFinite(value) && value > 0 ? [{ name, value }] : [];
    }),
    radii: lengths(tokens.rounded),
    spacing: lengths(tokens.spacing),
  };
  if (!baseline.colors.length && !baseline.fontSizes.length && !baseline.fontWeights.length && !baseline.radii.length && !baseline.spacing.length) {
    throw new Error("Design baseline declares no usable colors, typography, rounded or spacing tokens");
  }
  return baseline;
}
