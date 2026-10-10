import { converter } from "culori";

export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface PixelImage { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export interface CenterOptions { background: string }
export interface CenterMeasurement {
  width: number;
  height: number;
  bounds: Bounds | null;
  alphaCenter: Point | null;
  center: Point | null;
  offset: Point | null;
  status: "estimated" | "empty" | "no-contrast";
  algorithm: "oklab-contrast-centroid-v1";
  paintTouchesViewport: boolean;
}
const rgb = converter("rgb");
const oklab = converter("oklab");

export function analyzePixels(image: PixelImage, options: CenterOptions): CenterMeasurement {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_194_304 || data.length !== width * height * 4) throw new Error("Expected a complete RGBA image of at most 4 megapixels");
  const background = rgb(options.background);
  if (!background || (background.alpha ?? 1) !== 1 || [background.r, background.g, background.b].some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("An opaque sRGB background is required");
  const backdrop = oklab(background)!;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let total = 0, weightedX = 0, weightedY = 0, alphaMass = 0, alphaX = 0, alphaY = 0;
  const weights = new Map<number, number>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const r = data[index]!, g = data[index + 1]!, b = data[index + 2]!, a = data[index + 3]!;
    if (!a) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    const alpha = a / 255;
    alphaMass += alpha; alphaX += (x + 0.5) * alpha; alphaY += (y + 0.5) * alpha;
    const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    let weight = weights.get(key);
    if (weight === undefined) {
      const color = oklab({mode:"rgb",r:r / 255 * alpha + background.r * (1 - alpha),g:g / 255 * alpha + background.g * (1 - alpha),b:b / 255 * alpha + background.b * (1 - alpha)})!;
      weight = Math.hypot(color.l - backdrop.l, color.a - backdrop.a, color.b - backdrop.b);
      if (weights.size < 4096) weights.set(key, weight);
    }
    total += weight; weightedX += (x + 0.5) * weight; weightedY += (y + 0.5) * weight;
  }
  const bounds = alphaMass ? {x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1} : null;
  const center = total > Number.EPSILON * width * height ? {x:weightedX/total,y:weightedY/total} : null;
  return {
    width, height, bounds, center,
    alphaCenter: alphaMass ? {x:alphaX/alphaMass,y:alphaY/alphaMass} : null,
    offset: center ? {x:width/2-center.x,y:height/2-center.y} : null,
    status: !bounds ? "empty" : center ? "estimated" : "no-contrast",
    algorithm: "oklab-contrast-centroid-v1",
    paintTouchesViewport: !!bounds && (minX === 0 || minY === 0 || maxX === width-1 || maxY === height-1),
  };
}
