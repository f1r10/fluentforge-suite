import { describe, expect, it } from "vitest";
import { sourceNeedsVisualProvenance } from "./import-source-retention";

describe("source asset retention while visual crops are not yet stored", () => {
  it("preserves PDF sources regardless of upload MIME detection", () => {
    expect(sourceNeedsVisualProvenance("application/pdf", "paper.dat")).toBe(true);
    expect(sourceNeedsVisualProvenance("application/octet-stream", "paper.PDF")).toBe(true);
    expect(sourceNeedsVisualProvenance(null, "worksheet.pdf")).toBe(true);
  });
  it("preserves image sources needed for OCR and source geometry", () => {
    expect(sourceNeedsVisualProvenance("image/png", "chart")).toBe(true);
    expect(sourceNeedsVisualProvenance(null, "clock.JPEG")).toBe(true);
  });
  it("keeps the existing cleanup policy for nonvisual sources", () => {
    expect(sourceNeedsVisualProvenance("text/csv", "words.csv")).toBe(false);
    expect(sourceNeedsVisualProvenance("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "worksheet.docx")).toBe(false);
  });
});
