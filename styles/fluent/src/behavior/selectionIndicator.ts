export type SelectionIndicatorAxis = "x" | "y";

const durations = { slide: 300, stretch: 600, fade: 167 } as const;

/** Reads the indicator's drawn rect and cancels its animations so a retarget continues from the visible position. */
export function captureSelectionIndicator(indicator: HTMLElement | null | undefined): DOMRect | null {
  if (!indicator) return null;
  const rect = indicator.getBoundingClientRect();
  if (typeof indicator.getAnimations === "function") {
    for (const animation of indicator.getAnimations({ subtree: true })) animation.cancel();
  }
  return rect;
}

/**
 * Animates an indicator that has just been placed inside its new item from `from`
 * (its previous on-screen rect) to its CSS rest geometry.
 */
export function animateSelectionIndicator(
  indicator: HTMLElement | null | undefined,
  axis: SelectionIndicatorAxis,
  from: DOMRect | null,
): void {
  const host = indicator?.parentElement;
  if (!indicator || !host || !from || typeof indicator.animate !== "function") return;
  const style = getComputedStyle(indicator);
  const motion = style.getPropertyValue("--fluent-indicator-motion").trim();
  const scale = Number.parseFloat(style.getPropertyValue("--fluent-motion-scale"));
  if (!Number.isFinite(scale) || scale <= 0) return;
  if (motion !== "slide" && motion !== "stretch" && motion !== "fade") return;
  const ease = style.getPropertyValue("--fluent-ease").trim() || "linear";
  const accelerate = style.getPropertyValue("--fluent-ease-accelerate").trim() || "linear";
  const duration = durations[motion] * scale;

  if (motion === "fade") {
    const options = { duration, easing: ease };
    indicator.animate([{ opacity: 0 }, { opacity: 1 }], options);
    if (axis === "x") {
      indicator.animate([{ transform: "scaleX(0.25)" }, { transform: "none" }], { ...options, pseudoElement: "::after" });
    } else {
      indicator.animate([{ transform: "scaleY(0.25)" }, { transform: "none" }], options);
    }
    return;
  }

  const [startProp, sizeProp] = axis === "x" ? (["left", "width"] as const) : (["top", "height"] as const);
  const hostRect = host.getBoundingClientRect();
  const origin = axis === "x" ? hostRect.left + host.clientLeft : hostRect.top + host.clientTop;
  const rest = indicator.getBoundingClientRect();
  const geometry = (start: number, size: number) => ({ [startProp]: `${start}px`, [sizeProp]: `${size}px` });
  const oldStart = (axis === "x" ? from.left : from.top) - origin;
  const oldSize = axis === "x" ? from.width : from.height;
  const newStart = (axis === "x" ? rest.left : rest.top) - origin;
  const newSize = axis === "x" ? rest.width : rest.height;

  if (motion === "slide") {
    indicator.animate([geometry(oldStart, oldSize), geometry(newStart, newSize)], { duration, easing: ease });
    return;
  }
  const lo = Math.min(oldStart, newStart);
  const hi = Math.max(oldStart + oldSize, newStart + newSize);
  indicator.animate(
    [
      { ...geometry(oldStart, oldSize), offset: 0, easing: accelerate },
      { ...geometry(lo, hi - lo), offset: 0.333, easing: ease },
      { ...geometry(newStart, newSize), offset: 1 },
    ],
    { duration },
  );
}
