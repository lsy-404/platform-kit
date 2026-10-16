import type { CheckId, CheckInfo } from "./types.js";

const wcag = (slug: string) => "https://www.w3.org/WAI/WCAG22/Understanding/" + slug + ".html";

export const checks: ReadonlyArray<CheckInfo> = [
  { id: "AP001", name: "text-contrast", description: "Text contrast against its rendered background", dimensions: ["accessibility", "color"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("contrast-minimum"), criterion: "WCAG 2.2 1.4.3 (AA)" },
  { id: "AP002", name: "interaction-contrast", description: "Text readability during hover and keyboard focus", dimensions: ["accessibility", "color"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("contrast-minimum"), criterion: "WCAG 2.2 1.4.3 (AA)" },
  { id: "AP003", name: "concentric-radius", description: "Inner and outer radii relative to their actual inset", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scan", source: "https://fluent2.microsoft.design/shapes" },
  { id: "AP004", name: "content-overlap", description: "Overlapping visible text from independent elements", dimensions: ["layout", "typography"], severity: "advisory", confidence: "measured", scope: "scan", source: wcag("text-spacing") },
  { id: "AP005", name: "wrap-and-containment", description: "Clipped text, escaped containers and fragmented control labels", dimensions: ["layout", "typography"], severity: "advisory", confidence: "heuristic", scope: "scan", source: wcag("reflow") },
  { id: "AP006", name: "visual-hierarchy", description: "Headings visually weaker than adjacent body text or than their parent heading", dimensions: ["typography"], severity: "advisory", confidence: "heuristic", scope: "scan", source: "https://m3.material.io/styles/typography/applying-type" },
  { id: "AP007", name: "optical-centering", description: "Off-center painted SVG bounds in centered icon controls", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scan", source: "https://fluent2.microsoft.design/iconography" },
  { id: "AP008", name: "surface-layering", description: "Repeated enclosing surface borders or shadows", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scan", source: "https://fluent2.microsoft.design/elevation" },
  { id: "AP009", name: "link-distinguishable", description: "Links inside text are distinguishable without relying on color alone", dimensions: ["accessibility", "color"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("use-of-color"), criterion: "WCAG 2.2 1.4.1 (A)" },
  { id: "AP010", name: "target-size", description: "Pointer targets are at least 24x24 CSS px or sufficiently spaced", dimensions: ["accessibility", "layout"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("target-size-minimum"), criterion: "WCAG 2.2 2.5.8 (AA)" },
  { id: "AP011", name: "zoom-permitted", description: "Viewport meta does not prevent zooming to 200%", dimensions: ["accessibility"], severity: "normative", confidence: "measured", scope: "document", source: wcag("resize-text"), criterion: "WCAG 2.2 1.4.4 (AA)" },
  { id: "AP012", name: "focus-visible", description: "Keyboard focus produces a visible change", dimensions: ["accessibility"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("focus-visible"), criterion: "WCAG 2.2 2.4.7 (AA)" },
  { id: "AP013", name: "focus-not-obscured", description: "Focused controls are not entirely hidden by fixed or sticky content", dimensions: ["accessibility", "layout"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("focus-not-obscured-minimum"), criterion: "WCAG 2.2 2.4.11 (AA)" },
  { id: "AP014", name: "reflow", description: "Content reflows at 320 CSS px without horizontal scrolling or cut-off", dimensions: ["accessibility", "layout"], severity: "normative", confidence: "measured", scope: "probe", source: wcag("reflow"), criterion: "WCAG 2.2 1.4.10 (AA)" },
  { id: "AP015", name: "text-spacing", description: "Text is not clipped or overlapped under WCAG text-spacing overrides", dimensions: ["accessibility", "typography"], severity: "normative", confidence: "measured", scope: "viewport", source: wcag("text-spacing"), criterion: "WCAG 2.2 1.4.12 (AA)" },
  { id: "AP016", name: "non-text-contrast", description: "Control boundaries and icon glyphs reach 3:1", dimensions: ["accessibility", "color"], severity: "normative", confidence: "measured", scope: "scan", source: wcag("non-text-contrast"), criterion: "WCAG 2.2 1.4.11 (AA)" },
  { id: "AP017", name: "persistent-motion", description: "Auto-started motion keeps running under prefers-reduced-motion", dimensions: ["accessibility"], severity: "advisory", confidence: "heuristic", scope: "probe", source: wcag("pause-stop-hide"), criterion: "WCAG 2.2 2.2.2 (A)" },
  { id: "AP018", name: "heading-structure", description: "Heading levels are not skipped and headings are not empty", dimensions: ["accessibility", "typography"], severity: "advisory", confidence: "measured", scope: "document", source: "https://dequeuniversity.com/rules/axe/4.13/heading-order", criterion: "axe best-practice" },
  { id: "AP019", name: "color-drift", description: "Colors that differ from a more common color by less than a noticeable step", dimensions: ["color"], severity: "advisory", confidence: "heuristic", scope: "scheme", source: "https://www.w3.org/TR/css-color-4/#color-difference-OK" },
  { id: "AP020", name: "sibling-rhythm", description: "One gap in a run of identical siblings differs from the rest", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "viewport", source: "https://www.nngroup.com/articles/gestalt-proximity/" },
  { id: "AP021", name: "prose-leading", description: "Multi-line body text has line spacing of at least 1.2", dimensions: ["typography"], severity: "advisory", confidence: "measured", scope: "viewport", source: "https://practicaltypography.com/line-spacing.html" },
  { id: "AP022", name: "line-length", description: "Lines stay within the recommended reading measure", dimensions: ["typography"], severity: "advisory", confidence: "measured", scope: "viewport", source: wcag("visual-presentation"), criterion: "WCAG 2.2 1.4.8 (AAA)" },
  { id: "AP023", name: "font-load-failure", description: "Declared web fonts load instead of falling back", dimensions: ["typography"], severity: "advisory", confidence: "measured", scope: "document", source: "https://www.w3.org/TR/css-font-loading-3/#dom-fontface-status" },
  { id: "AP024", name: "type-scale-drift", description: "Font sizes within 1 px of a more common size; likely off the type scale", dimensions: ["typography"], severity: "advisory", confidence: "heuristic", scope: "scheme", source: "https://m3.material.io/styles/typography/type-scale-tokens" },
  { id: "AP025", name: "radius-drift", description: "Corner radii close to a more common radius of the same kind of element", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scheme", source: "https://fluent2.microsoft.design/shapes" },
  { id: "AP026", name: "control-size-drift", description: "Control heights close to a more common control height", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scheme", source: "https://fluent2.microsoft.design/layout" },
  { id: "AP027", name: "spacing-grid", description: "Padding, margin and gap values off the spacing grid the rest of the page follows", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "scheme", source: "https://m3.material.io/foundations/layout/understanding-layout/spacing" },
  { id: "AP028", name: "pill-radius", description: "Near-pill corners that stop short of half the element height", dimensions: ["layout"], severity: "advisory", confidence: "measured", scope: "viewport", source: "https://m3.material.io/styles/shape/corner-radius-scale" },
  { id: "AP029", name: "overlay-radius", description: "Open dialogs with smaller corners than the page's cards", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "viewport", source: "https://fluent2.microsoft.design/shapes" },
  { id: "AP030", name: "row-alignment", description: "Side-by-side controls with different heights or offset edges", dimensions: ["layout"], severity: "advisory", confidence: "measured", scope: "viewport", source: "https://fluent2.microsoft.design/layout" },
  { id: "AP031", name: "icon-text-alignment", description: "Inline icons vertically off-center from their single-line label", dimensions: ["layout"], severity: "advisory", confidence: "heuristic", scope: "viewport", source: "https://fluent2.microsoft.design/iconography" },
  { id: "AP032", name: "tabular-numbers", description: "Numeric table columns rendered with proportional digits", dimensions: ["typography"], severity: "advisory", confidence: "measured", scope: "viewport", source: "https://www.w3.org/TR/css-fonts-4/#font-variant-numeric-prop" },
  { id: "AP033", name: "design-tokens", description: "Rendered colors, sizes, weights, radii and spacing outside a supplied DESIGN.md baseline", dimensions: ["color", "layout", "typography"], severity: "advisory", confidence: "measured", scope: "scheme", source: "https://stitch.withgoogle.com/docs/design-md/overview/", requires: "design" },
  { id: "AP034", name: "theme-text-parity", description: "Light-on-dark text in the dark theme without the slight size, weight or grade reduction that keeps it visually equal to the light theme", dimensions: ["typography"], severity: "advisory", confidence: "heuristic", scope: "viewport", source: "https://fonts.google.com/knowledge/glossary/grade", requires: "both-schemes" },
];

/** True when the options supply what a check's `requires` names. */
export function prerequisiteMet(check: CheckInfo, options: { design?: unknown; colorSchemes?: readonly string[] }): boolean {
  if (check.requires === "design") return options.design !== undefined;
  if (check.requires === "both-schemes") return Boolean(options.colorSchemes?.includes("light") && options.colorSchemes.includes("dark"));
  return true;
}

/** Checks enabled when none are named: every check whose prerequisite is present. */
export function defaultCheckIds(options: { design?: unknown; colorSchemes?: readonly string[] }): CheckId[] {
  return checks.filter(check => prerequisiteMet(check, options)).map(check => check.id);
}

export function isCheckId(value: string): value is CheckId {
  return checks.some(check => check.id === value);
}

export function checkInfo(id: CheckId): CheckInfo {
  const info = checks.find(check => check.id === id);
  if (!info) throw new Error("Unknown check ID: " + id);
  return info;
}
