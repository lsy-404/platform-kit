export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface ViewportLike {
  width: number;
  height: number;
}
export type AnchorSide = "top" | "bottom";

export interface AnchoredPosition {
  left: number;
  top: number;
  side: AnchorSide;
  maxWidth: number;
}

/** Position a panel below its anchor, flipping above it when that leaves more room; the panel keeps its natural height and may extend past the viewport. */
export function placeAnchored(
  anchor: RectLike,
  panel: Pick<RectLike, "width" | "height">,
  viewport: ViewportLike,
  gap = 6,
  edge = 8,
): AnchoredPosition {
  const below = viewport.height - (anchor.top + anchor.height) - gap - edge;
  const above = anchor.top - gap - edge;
  const side: AnchorSide =
    below >= panel.height || below >= above ? "bottom" : "top";
  const unclampedLeft = anchor.left;
  const maxWidth = Math.max(0, viewport.width - edge * 2);
  const width = Math.min(panel.width, maxWidth);
  const left = Math.max(
    edge,
    Math.min(unclampedLeft, viewport.width - width - edge),
  );
  const top =
    side === "bottom"
      ? anchor.top + anchor.height + gap
      : anchor.top - panel.height - gap;
  return {
    left: Math.round(left),
    top: Math.round(top),
    side,
    maxWidth: Math.floor(maxWidth),
  };
}
