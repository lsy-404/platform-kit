import { describe, expect, it } from "vitest";
import { displacementMap, roundedRectSdf } from "../styles/liquid-glass/src/map.js";

const pixel = (map: ReturnType<typeof displacementMap>, x: number, y: number) => {
  const i = (y * map.width + x) * 4;
  return [map.data[i], map.data[i + 1], map.data[i + 2], map.data[i + 3]];
};

describe("liquid glass displacement map", () => {
  it("measures a rounded rectangle", () => {
    expect(roundedRectSdf(0, 0, 10, 5, 2)).toBe(-5);
    expect(roundedRectSdf(10, 0, 10, 5, 2)).toBeCloseTo(0);
    expect(roundedRectSdf(12, 0, 10, 5, 0)).toBeCloseTo(2);
  });

  it("leaves the middle neutral and pulls the rim inward", () => {
    const map = displacementMap(200, 120, 12);
    expect(map.scale).toBeCloseTo(2 * 17.5 * 0.6);
    expect(pixel(map, 100, 60)).toEqual([128, 128, 0, 255]);
    // At the left edge the outward gradient points left, so red rises: sample further right, into the surface.
    expect(pixel(map, 0, 60)[0]).toBeGreaterThan(200);
    expect(pixel(map, 199, 60)[0]).toBeLessThan(56);
    expect(pixel(map, 100, 0)[1]).toBeGreaterThan(200);
    expect(pixel(map, 100, 119)[1]).toBeLessThan(56);
  });

  it("scales the rim with the short side up to the demo pane", () => {
    expect(displacementMap(32, 300, 6).scale).toBeCloseTo(2 * 17.5 * 0.16);
    expect(displacementMap(400, 400, 16).scale).toBeCloseTo(35);
    const field = displacementMap(240, 32, 6);
    expect(pixel(field, 120, 16)).toEqual([128, 128, 0, 255]);
  });

  it("survives degenerate sizes", () => {
    const tiny = displacementMap(0.2, 0, 40);
    expect([tiny.width, tiny.height]).toEqual([1, 1]);
    expect(tiny.data).toHaveLength(4);
  });
});
