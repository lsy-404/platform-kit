// The rounded-edge displacement lens is adapted from Shu Ding's MIT-licensed Liquid Glass demo; see NOTICE.

/** The demo pane's short side, and the rim it bends at that size (measured from its rendered map). */
const DEMO_SHORT_SIDE = 200
const DEMO_RIM = 45
const DEMO_EDGE_SHIFT = 17.5
const DEMO_FALLOFF = 2.2

export interface LensTuning {
  /** How far the rim bends the page, as a multiple of the demo's bend (default 1; 0 is flat). */
  refraction?: number
  /** How wide the refracting band is, as a multiple of the demo's rim (default 1). */
  rimWidth?: number
}

export interface DisplacementMap {
  /** RGBA pixels, row-major: red shifts x, green shifts y, 128 is neutral; blue weighs the rim band (edge blur mask). */
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

interface RimField {
  w: number
  h: number
  rim: number
  radius: number
  scale: number
  /** Writes the RGBA pixel for the point (x, y) of the element, in whole pixels from its top-left corner. */
  write(data: Uint8ClampedArray, i: number, x: number, y: number): void
}

function rimField(width: number, height: number, radius: number, tuning: LensTuning): RimField {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const k = Math.min(1, Math.min(w, h) / DEMO_SHORT_SIDE)
  const rim = DEMO_RIM * k * Math.max(0, tuning.rimWidth ?? 1)
  const edgeShift = DEMO_EDGE_SHIFT * k * Math.max(0, tuning.refraction ?? 1)
  // Twice the largest shift, so every shift fits the 0..1 channel around its neutral 0.5.
  const scale = 2 * edgeShift
  const halfW = w / 2
  const halfH = h / 2
  const r = Math.max(0, Math.min(radius, halfW, halfH))
  const write = (data: Uint8ClampedArray, i: number, x: number, y: number) => {
    const px = x + 0.5 - halfW
    const py = y + 0.5 - halfH
    data[i] = 128
    data[i + 1] = 128
    data[i + 2] = 0
    data[i + 3] = 255
    const e = -roundedRectSdf(px, py, halfW, halfH, r)
    if (e >= rim) return
    const band = 1 - Math.max(0, e) / rim
    data[i + 2] = Math.round(band * 255)
    if (scale === 0) return
    const shift = edgeShift * band ** DEMO_FALLOFF
    // The distance field's gradient points outward; sampling against it pulls the page in from the edge.
    const gx = roundedRectSdf(px + 1, py, halfW, halfH, r) - roundedRectSdf(px - 1, py, halfW, halfH, r)
    const gy = roundedRectSdf(px, py + 1, halfW, halfH, r) - roundedRectSdf(px, py - 1, halfW, halfH, r)
    const length = Math.hypot(gx, gy) || 1
    data[i] = Math.round((0.5 - (gx / length) * shift / scale) * 255)
    data[i + 1] = Math.round((0.5 - (gy / length) * shift / scale) * 255)
  }
  return { w, h, rim, radius: r, scale, write }
}

function tile(field: RimField, x: number, y: number, width: number, height: number, dataWidth = width, dataHeight = height): MapSlice {
  const data = new Uint8ClampedArray(dataWidth * dataHeight * 4)
  for (let ty = 0; ty < dataHeight; ty++) {
    for (let tx = 0; tx < dataWidth; tx++) field.write(data, (ty * dataWidth + tx) * 4, x + tx, y + ty)
  }
  return { x, y, width, height, data, dataWidth, dataHeight }
}

/**
 * The rim displacement for a `width`×`height` rounded rectangle. The rim and its shift scale with the short side
 * up to the demo's 200px pane, so a 32px field bends a few pixels and a large card bends like the demo.
 */
export function displacementMap(width: number, height: number, radius: number, tuning: LensTuning = {}): DisplacementMap {
  const field = rimField(width, height, radius, tuning)
  const { data } = tile(field, 0, 0, field.w, field.h)
  return { data, width: field.w, height: field.h, scale: field.scale }
}

/** A piece of a displacement map: `data` is `dataWidth`×`dataHeight` pixels, stretched over the box it covers. */
export interface MapSlice {
  x: number
  y: number
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
  dataWidth: number
  dataHeight: number
}

export interface SlicedDisplacementMap {
  width: number
  height: number
  scale: number
  /** Laid over a neutral (128, 128, 0) fill, these make up the whole map. */
  slices: MapSlice[]
}

/**
 * The same map as `displacementMap`, cut nine ways: four corners, and four edges that do not change along their
 * length, so each is one line of pixels stretched over it; the middle is neutral. A browser hands a lens's map image
 * to its compositor again for every frame the page behind the glass changes, so the pixels it carries stay a few
 * kilobytes whatever the element's size. Shapes too small to cut come back as one slice.
 */
export function slicedDisplacementMap(width: number, height: number, radius: number, tuning: LensTuning = {}): SlicedDisplacementMap {
  const field = rimField(width, height, radius, tuning)
  const { w, h } = field
  // Past this far from a corner every edge row (column) is the same; the extra pixel covers the gradient's reach.
  const corner = Math.ceil(Math.max(field.rim, field.radius)) + 2
  if (2 * corner >= w || 2 * corner >= h) return { width: w, height: h, scale: field.scale, slices: [tile(field, 0, 0, w, h)] }
  const c = corner
  const along = w - 2 * c
  const down = h - 2 * c
  return {
    width: w,
    height: h,
    scale: field.scale,
    slices: [
      tile(field, 0, 0, c, c),
      tile(field, w - c, 0, c, c),
      tile(field, 0, h - c, c, c),
      tile(field, w - c, h - c, c, c),
      tile(field, c, 0, along, c, 1, c),
      tile(field, c, h - c, along, c, 1, c),
      tile(field, 0, c, c, down, c, 1),
      tile(field, w - c, c, c, down, c, 1),
    ],
  }
}
