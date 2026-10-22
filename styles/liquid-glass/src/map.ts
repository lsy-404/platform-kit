// The rounded-edge displacement lens is adapted from Shu Ding's MIT-licensed Liquid Glass demo; see NOTICE.

/** The demo pane's short side, and the rim it bends at that size (measured from its rendered map). */
const DEMO_SHORT_SIDE = 200
const DEMO_RIM = 45
const DEMO_EDGE_SHIFT = 17.5
const DEMO_FALLOFF = 2.2

export interface DisplacementMap {
  /** RGBA pixels, row-major: red shifts x, green shifts y, 128 is neutral. */
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
  /** The feDisplacementMap scale the channels were encoded for. */
  scale: number
}

/** Signed distance to a rounded rectangle centred on the origin: negative inside, zero on the edge. */
export function roundedRectSdf(x: number, y: number, halfW: number, halfH: number, radius: number): number {
  const qx = Math.abs(x) - halfW + radius
  const qy = Math.abs(y) - halfH + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

/**
 * The rim displacement for a `width`×`height` rounded rectangle. The rim and its shift scale with the short side
 * up to the demo's 200px pane, so a 32px field bends a few pixels and a large card bends like the demo.
 */
export function displacementMap(width: number, height: number, radius: number): DisplacementMap {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const k = Math.min(1, Math.min(w, h) / DEMO_SHORT_SIDE)
  const rim = DEMO_RIM * k
  const edgeShift = DEMO_EDGE_SHIFT * k
  // Twice the largest shift, so every shift fits the 0..1 channel around its neutral 0.5.
  const scale = 2 * edgeShift
  const halfW = w / 2
  const halfH = h / 2
  const r = Math.max(0, Math.min(radius, halfW, halfH))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - halfH
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - halfW
      const i = (y * w + x) * 4
      data[i] = 128
      data[i + 1] = 128
      data[i + 3] = 255
      const e = -roundedRectSdf(px, py, halfW, halfH, r)
      if (scale === 0 || e >= rim) continue
      const shift = edgeShift * (1 - Math.max(0, e) / rim) ** DEMO_FALLOFF
      // The distance field's gradient points outward; sampling against it pulls the page in from the edge.
      const gx = roundedRectSdf(px + 1, py, halfW, halfH, r) - roundedRectSdf(px - 1, py, halfW, halfH, r)
      const gy = roundedRectSdf(px, py + 1, halfW, halfH, r) - roundedRectSdf(px, py - 1, halfW, halfH, r)
      const length = Math.hypot(gx, gy) || 1
      data[i] = Math.round((0.5 - (gx / length) * shift / scale) * 255)
      data[i + 1] = Math.round((0.5 - (gy / length) * shift / scale) * 255)
    }
  }
  return { data, width: w, height: h, scale }
}
