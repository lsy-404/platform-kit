import type { BrowserContext, Page } from "playwright";

const helpers = new WeakMap<BrowserContext, Promise<Page>>();

export function helperPage(context: BrowserContext): Promise<Page> {
  let page = helpers.get(context);
  if (!page) {
    page = context.newPage().then(async created => { await created.goto("about:blank"); return created; });
    helpers.set(context, page);
  }
  return page;
}

// Decodes both PNGs in the browser so no image library is needed on the Node side.
export async function comparePixels(page: Page, beforeBase64: string, afterBase64: string, threshold = 16): Promise<{ changed: number; width: number; height: number }> {
  return page.evaluate(async ([before, after, limit]) => {
    const decode = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [a, b] = await Promise.all([decode(before as string), decode(after as string)]);
    if (a.width !== b.width || a.height !== b.height) return { changed: Math.max(a.width * a.height, b.width * b.height), width: a.width, height: a.height };
    let changed = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!), Math.abs(a.data[i + 3]! - b.data[i + 3]!));
      if (delta >= (limit as number)) changed++;
    }
    return { changed, width: a.width, height: a.height };
  }, [beforeBase64, afterBase64, threshold] as const);
}
