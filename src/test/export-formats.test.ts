import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMATS,
  defaultExportFormat,
  isExportFormatAllowed,
} from "@/lib/export-formats";

describe("export format policy", () => {
  it("offers vocabulary as spreadsheet and printable PDF", () => {
    expect(EXPORT_FORMATS.vocabulary).toEqual([
      "xlsx",
      "pdf",
      "json",
      "csv",
    ]);
    expect(isExportFormatAllowed("vocabulary", "pdf")).toBe(true);
  });

  it("keeps reading exports document-oriented", () => {
    expect(EXPORT_FORMATS.readings).toEqual(["pdf", "docx"]);
    expect(isExportFormatAllowed("readings", "xlsx")).toBe(false);
    expect(defaultExportFormat("readings")).toBe("pdf");
  });

  it("keeps portable content packages as JSON rather than spreadsheets", () => {
    expect(EXPORT_FORMATS.content_package).toEqual(["json"]);
    expect(isExportFormatAllowed("content_package", "xlsx")).toBe(false);
  });
});
