export type Easing = (progress: number) => number;

const parts = (source: string) => source.split(",").map((part) => part.trim());

function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const axis = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0, high = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (axis(x1, x2, mid) < progress) low = mid; else high = mid;
    }
    return axis(y1, y2, (low + high) / 2);
  };
}

function linearStops(source: string): Easing {
  const stops = parts(source).map((entry) => {
    const [value, position] = entry.split(/\s+/);
    return { y: Number(value), x: position === undefined ? undefined : Number.parseFloat(position) / 100 };
  });
  if (stops.length < 2 || stops.some((stop) => Number.isNaN(stop.y))) throw new Error(`Unsupported linear() easing: ${source}`);
  stops[0]!.x ??= 0;
  stops[stops.length - 1]!.x ??= 1;
  let previous = 0;
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i]!;
    if (stop.x === undefined) continue;
    const start = stops[previous]!.x!;
    stop.x = Math.max(stop.x, start);
    for (let j = previous + 1; j < i; j++) stops[j]!.x = start + ((stop.x - start) * (j - previous)) / (i - previous);
    previous = i;
  }
  return (progress) => {
    if (progress <= stops[0]!.x!) return stops[0]!.y;
    for (let i = 1; i < stops.length; i++) {
      const from = stops[i - 1]!, to = stops[i]!;
      if (progress <= to.x!) return to.x === from.x ? to.y : from.y + ((to.y - from.y) * (progress - from.x!)) / (to.x! - from.x!);
    }
    return stops[stops.length - 1]!.y;
  };
}

export function parseEasing(value: string): Easing {
  const text = value.trim();
  if (text === "linear") return (progress) => progress;
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(text);
  if (bezier) {
    const [x1, y1, x2, y2] = parts(bezier[1]!).map(Number);
    if ([x1, y1, x2, y2].some((n) => n === undefined || Number.isNaN(n))) throw new Error(`Unsupported cubic-bezier() easing: ${text}`);
    return cubicBezier(x1!, y1!, x2!, y2!);
  }
  const stops = /^linear\(([^)]*)\)$/.exec(text);
  if (stops) return linearStops(stops[1]!);
  throw new Error(`Unsupported easing: ${text}`);
}

export function easingPath(easing: Easing, width: number, height: number, min: number, max: number, count = 64): string {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return `${i ? "L" : "M"}${(t * width).toFixed(2)} ${(height - ((easing(t) - min) / (max - min)) * height).toFixed(2)}`;
  }).join("");
}
