import { describe, it, expect } from "vitest";
import {
  centeredCrop,
  FULL_CROP,
  updateCropField,
  DEFAULT_CHROMA,
  DEFAULT_MASK,
} from "../src/components/VisualTools";
describe("source crop controls", () => {
  it("centers a maximal square crop in a landscape source", () => {
    expect(centeredCrop(1920, 1080, 1)).toEqual({
      x: 0.21875,
      y: 0,
      width: 0.5625,
      height: 1,
    });
  });
  it("centers a horizontal crop in portrait footage", () => {
    const crop = centeredCrop(1080, 1920, 16 / 9);
    expect(crop.width).toBe(1);
    expect(crop.height).toBeCloseTo(0.31640625);
    expect(crop.y).toBeCloseTo((1 - crop.height) / 2);
  });
  it("leaves matching proportions untouched and handles unavailable dimensions safely", () => {
    expect(centeredCrop(1920, 1080, 16 / 9)).toEqual(FULL_CROP);
    expect(centeredCrop(0, 0, 1)).toEqual(FULL_CROP);
  });
  it("keeps position edits inside source while preserving crop dimensions", () => {
    expect(
      updateCropField({ x: 0.1, y: 0.1, width: 0.5, height: 0.7 }, "x", 0.9),
    ).toEqual({ x: 0.5, y: 0.1, width: 0.5, height: 0.7 });
  });
  it("limits extent edits to remaining source and disallows zero-size crops", () => {
    const crop = { x: 0.2, y: 0.1, width: 0.5, height: 0.7 };
    expect(updateCropField(crop, "width", 2).width).toBe(0.8);
    expect(updateCropField(crop, "height", 0).height).toBe(0.01);
    expect(updateCropField(crop, "x", NaN)).toBe(crop);
  });
});
describe("optional tools defaults", () => {
  it("starts chroma on a familiar green with modest tolerance and a real soft edge", () => {
    expect(DEFAULT_CHROMA).toEqual({
      enabled: true,
      color: "#00ff00",
      similarity: 0.1,
      blend: 0.05,
    });
  });
  it("starts with a full non-inverted rectangular mask", () => {
    expect(DEFAULT_MASK).toEqual({
      shape: "rectangle",
      width: 1,
      height: 1,
      feather: 0,
      invert: false,
    });
  });
});
