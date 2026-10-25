import { describe, expect, it } from "vitest";
import { importedQuestionImageCrop } from "./import-visual-crop";

describe("approved PDF question image geometry", () => {
  it("combines adjacent diagrams and clamps padding into page bounds", () => {
    const crop = importedQuestionImageCrop({ assets: [
      { kind: "table", crop: { x: 0, y: 0, width: 1, height: 1 } },
      { kind: "image_region", crop: { x: 0, y: 0.4, width: 0.2, height: 0.1 } },
      { kind: "image_region", crop: { x: 0.3, y: 0.5, width: 0.15, height: 0.2 } },
    ] });
    expect(crop).not.toBeNull();
    expect(crop?.x).toBe(0);
    expect(crop?.y).toBeCloseTo(0.392);
    expect(crop?.width).toBeCloseTo(0.458);
    expect(crop?.height).toBeCloseTo(0.316);
  });
  it("retains a PDF table as a renderable stimulus when no image is embedded", () => {
    const crop = importedQuestionImageCrop({ assets: [
      { kind: "table", crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.4 } },
    ] });
    expect(crop?.x).toBeCloseTo(0.092);
    expect(crop?.width).toBeCloseTo(0.716);
  });

  it("returns null for a text-only question", () => {
    expect(importedQuestionImageCrop({ assets: [] })).toBeNull();
    expect(importedQuestionImageCrop(null)).toBeNull();
  });
  it("rejects malformed geometry rather than silently dropping an image", () => {
    expect(() => importedQuestionImageCrop({ assets: [{kind:"image_region"}] })).toThrow();
    expect(() => importedQuestionImageCrop({ assets: [{kind:"image_region",crop:{
      x:0.8,y:0.1,width:0.4,height:0.1,
    }}] })).toThrow();
  });
});
