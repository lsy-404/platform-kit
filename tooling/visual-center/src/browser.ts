import { analyzePixels } from "./index.js";
import type { CenterMeasurement, CenterOptions, Point } from "./index.js";

export interface SvgOptions extends CenterOptions {
  width?: number;
  height?: number;
  sampleScale?: number;
  color?: string;
}
export interface SvgMeasurement extends CenterMeasurement {
  svg: string;
  sampleScale: number;
}

export function prepareSvg(source: string, options: Pick<SvgOptions, "width" | "height" | "color"> = {}): string {
  if (source.length > 1_048_576 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("Expected a standalone SVG smaller than 1 MB without document entities");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("Invalid SVG document");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set"].includes(element.localName)) throw new Error("Only static SVG graphics are supported");
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name)) throw new Error("SVG event handlers are unsupported");
      if (attribute.localName === "href" && !attribute.value.startsWith("#") && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(attribute.value)) throw new Error("SVG resources must be embedded");
      checkCss(attribute.value);
    }
    if (element.localName === "style") checkCss(element.textContent ?? "");
  }
  if (options.color !== undefined && (!CSS.supports("color", options.color) || /var\(|currentcolor|inherit|initial|unset|revert/i.test(options.color))) throw new Error("SVG color must be a resolved CSS color");
  const width = options.width ?? 32, height = options.height ?? 32;
  if (![width,height].every(value => Number.isFinite(value) && value > 0 && value <= 2048)) throw new Error("SVG viewport must be between 0 and 2048 pixels");
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("style", (root.getAttribute("style") ?? "") + ";width:" + width + "px;height:" + height + "px;color:" + (options.color ?? "black"));
  return new XMLSerializer().serializeToString(document);
}

function checkCss(value: string): void {
  if (/@import|@font-face|@keyframes|\banimation\s*:/i.test(value) || /url\(\s*["']?(?!#)[^)]/i.test(value.replace(/url\(\s*["']?#[^)]*\)/gi,""))) throw new Error("SVG must use static styles and local fragment references");
}

export async function measureSvg(source: string, options: SvgOptions): Promise<SvgMeasurement> {
  const width = options.width ?? 32, height = options.height ?? 32, sampleScale = options.sampleScale ?? 4;
  if (!Number.isInteger(sampleScale) || sampleScale < 1 || sampleScale > 8) throw new Error("sampleScale must be an integer from 1 to 8");
  const svg = prepareSvg(source, options);
  const pixelWidth = Math.ceil(width * sampleScale), pixelHeight = Math.ceil(height * sampleScale);
  if (pixelWidth * pixelHeight > 4_194_304) throw new Error("SVG sampling is limited to 4 megapixels");
  const url = URL.createObjectURL(new Blob([svg], {type:"image/svg+xml"}));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    const context = canvas.getContext("2d", {willReadFrequently:true});
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const result = analyzePixels(context.getImageData(0,0,pixelWidth,pixelHeight), options);
    const sx = width / pixelWidth, sy = height / pixelHeight;
    const point = (value: Point | null): Point | null => value ? {x:value.x*sx,y:value.y*sy} : null;
    return {
      ...result, width, height, svg, sampleScale,
      bounds: result.bounds ? {...point(result.bounds)!,width:result.bounds.width*sx,height:result.bounds.height*sy} : null,
      center: point(result.center), alphaCenter: point(result.alphaCenter), offset: point(result.offset),
    };
  } finally { URL.revokeObjectURL(url); }
}
