import type { CheckId } from "./types.js";

export const checks: ReadonlyArray<{ id: CheckId; name: string; description: string }> = [
  { id: "AP001", name: "text-contrast", description: "Text contrast against its rendered background" },
  { id: "AP002", name: "interaction-contrast", description: "Text readability during hover and keyboard focus" },
  { id: "AP003", name: "concentric-radius", description: "Inner and outer radii relative to their actual inset" },
  { id: "AP004", name: "content-overlap", description: "Overlapping visible text from independent elements" },
  { id: "AP005", name: "wrap-and-containment", description: "Clipped text, escaped containers and fragmented control labels" },
  { id: "AP006", name: "visual-hierarchy", description: "Headings visually weaker than adjacent body text" },
  { id: "AP007", name: "optical-centering", description: "Off-center painted SVG bounds in centered icon controls" },
  { id: "AP008", name: "surface-layering", description: "Repeated enclosing surface borders or shadows" },
];

export function isCheckId(value: string): value is CheckId {
  return checks.some(check => check.id === value);
}
