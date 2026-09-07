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
  maxHeight: number;
  maxWidth: number;
}

/** Position a panel below its anchor, flipping above it when that leaves more room. */
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
  const maxHeight = Math.max(0, side === "bottom" ? below : above);
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
      : Math.max(edge, anchor.top - Math.min(panel.height, maxHeight) - gap);
  return {
    left: Math.round(left),
    top: Math.round(top),
    side,
    maxHeight: Math.floor(maxHeight),
    maxWidth: Math.floor(maxWidth),
  };
}
