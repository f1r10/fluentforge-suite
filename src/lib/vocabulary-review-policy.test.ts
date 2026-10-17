import { describe, expect, it } from "vitest";
import {
  isTeacherApprovableValidationState,
  vocabularyMetadataWarning,
} from "./vocabulary-review-policy";

describe("teacher-supervised optional vocabulary metadata", () => {
  it("warns but permits an English word with missing POS", () => {
    const message = vocabularyMetadataWarning({
      learning_language: "en",
      part_of_speech: null,
      level: "A1",
    });
    expect(message).toContain("part of speech");
    expect(message).not.toContain(" and CEFR level");
    expect(isTeacherApprovableValidationState("ready_with_warning")).toBe(true);
  });

  it("warns for a missing CEFR level without losing a teacher-assigned POS", () => {
    const message = vocabularyMetadataWarning({
      learning_language: "en",
      part_of_speech: "noun",
      level: null,
    });
    expect(message).toContain("CEFR level");
    expect(message).not.toContain("Missing part of speech");
  });

  it("warns for both fields while keeping them optional", () => {
    const message = vocabularyMetadataWarning({
      learning_language: "en-US",
      part_of_speech: "",
      level: "",
    });
    expect(message).toContain("part of speech and CEFR level");
  });

  it("does not raise metadata warnings for a complete or non-English word", () => {
    expect(vocabularyMetadataWarning({
      learning_language: "en",
      part_of_speech: "verb",
      level: "A1",
    })).toBeNull();
    expect(vocabularyMetadataWarning({
      learning_language: "tr",
      part_of_speech: null,
      level: null,
    })).toBeNull();
  });

  it("continues to block unparsed and invalid content", () => {
    expect(isTeacherApprovableValidationState("needs_fix")).toBe(false);
    expect(isTeacherApprovableValidationState("not_importable")).toBe(false);
    expect(isTeacherApprovableValidationState("ready")).toBe(true);
  });
});
