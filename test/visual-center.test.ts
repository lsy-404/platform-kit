import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { analyzePixels, type PixelImage } from "../tooling/visual-center/src/index.js";

function image(width: number, height: number, pixels: Array<[number, number, number, number]>): PixelImage {
  return { width, height, data: new Uint8ClampedArray(pixels.flat()) };
}
const clear: [number, number, number, number] = [255, 0, 255, 0];
const ink: [number, number, number, number] = [0, 0, 0, 255];

describe("visual center measurement", () => {
  it("finds the analytic center and full alpha bounds of a rectangular mark", () => {
    const result = analyzePixels(image(6, 4, Array.from({length:24}, (_, i) => i % 6 >= 1 && i % 6 < 3 && i >= 6 && i < 18 ? ink : clear)), {background:"white"});
    expect(result.bounds).toEqual({x:1,y:1,width:2,height:2});
    expect(result.center?.x).toBeCloseTo(2, 10);
    expect(result.center?.y).toBeCloseTo(2, 10);
    expect(result.offset?.x).toBeCloseTo(1, 10);
    expect(result.offset?.y).toBeCloseTo(0, 10);
    expect(result.paintTouchesViewport).toBe(false);
  });

  it("changes color weight with the background without discarding same-color paint from crop bounds", () => {
    const input = image(4,1,[ink,ink,[255,255,255,255],[255,255,255,255]]);
    const light = analyzePixels(input,{background:"white"});
    const dark = analyzePixels(input,{background:"black"});
    expect(light.center?.x).toBeCloseTo(1, 8);
    expect(dark.center?.x).toBeCloseTo(3, 8);
    expect(light.bounds).toEqual({x:0,y:0,width:4,height:1});
    expect(dark.bounds).toEqual(light.bounds);
    expect(light.paintTouchesViewport).toBe(true);
  });

  it("does not invent a center for empty or zero-contrast images", () => {
    expect(analyzePixels(image(1,1,[clear]),{background:"white"})).toMatchObject({status:"empty",bounds:null,center:null,offset:null});
    expect(analyzePixels(image(1,1,[ink]),{background:"black"})).toMatchObject({status:"no-contrast",bounds:{x:0,y:0,width:1,height:1},center:null,offset:null});
  });

  it("preserves reflection symmetry across many asymmetric alpha masks", () => {
    fc.assert(fc.property(fc.array(fc.integer({min:1,max:255}),{minLength:1,maxLength:30}), values => {
      const pixels = values.map(alpha => [10,40,90,alpha] as [number,number,number,number]);
      const a = analyzePixels(image(values.length,1,pixels),{background:"white"});
      const b = analyzePixels(image(values.length,1,pixels.toReversed()),{background:"white"});
      expect(a.center!.x + b.center!.x).toBeCloseTo(values.length, 8);
      expect(a.center!.y).toBeCloseTo(0.5, 8);
      expect(a.offset!.x + b.offset!.x).toBeCloseTo(0, 8);
    }),{numRuns:100});
  });

  it("requires complete RGBA samples and an explicit opaque background", () => {
    expect(() => analyzePixels({width:2,height:2,data:new Uint8Array(3)},{background:"white"})).toThrow(/RGBA/);
    expect(() => analyzePixels(image(1,1,[ink]),{background:"transparent"})).toThrow(/opaque/);
  });
});
