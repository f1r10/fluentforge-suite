import { describe, expect, it } from "vitest";
import { selectPrintableContent } from "@/lib/print-selection";

const q1 = "00000000-0000-4000-8000-000000000001";
const q2 = "00000000-0000-4000-8000-000000000002";
const q3 = "00000000-0000-4000-8000-000000000003";
const topicA = "00000000-0000-4000-8000-000000000004";

describe("print content filters", () => {
  const tables = {
    questions: [
      { id: q1, prompt: "A book", level: "A1", learning_language: "en" },
      { id: q2, prompt: "A cat", level: "A2", learning_language: "en" },
      { id: q3, prompt: "A car", level: "A1", learning_language: "fr" },
    ],
    question_topics: [
      { question_id: q1, topic_id: topicA },
      { question_id: q2, topic_id: topicA },
    ],
  };

  it("limits to the intersection of teacher-chosen level and topic", () => {
    const result = selectPrintableContent("questions", tables, { level: "A1", topicId: topicA });
    expect(result.questions.map((row) => row.id)).toEqual([q1]);
    expect(tables.questions).toHaveLength(3);
  });

  it("preserves selected ordering and does not include non-selected questions", () => {
    const result = selectPrintableContent("questions", tables, {
      selectedIds: [q2, q1],
    });
    expect(result.questions.map((row) => row.id)).toEqual([q2, q1]);
  });

  it("never silently prints entire bank for a filter that matches nothing", () => {
    expect(() => selectPrintableContent("questions", tables, { language: "de" }))
      .toThrow("No content matches");
  });

  it("rejects inaccessible or stale explicitly selected question IDs", () => {
    expect(() => selectPrintableContent("questions", tables, {
      selectedIds: [q1, "00000000-0000-4000-8000-000000000099"],
    })).toThrow("unavailable or not authorized");
  });

  it("rejects duplicate or empty explicit selections", () => {
    expect(() => selectPrintableContent("questions", tables, {
      selectedIds: [q1, q1],
    })).toThrow("Duplicate items");
    expect(() => selectPrintableContent("questions", tables, {
      selectedIds: [],
    })).toThrow("Select at least one");
  });

  it("filters vocabulary by POS and level, preserving source data", () => {
    const words = {
      vocabulary_entries: [
        { id: q1, word: "run", part_of_speech: "verb", level: "B1" },
        { id: q2, word: "run", part_of_speech: "noun", level: "B1" },
        { id: q3, word: "runner", part_of_speech: "noun", level: "A2" },
      ],
      vocabulary_topics: [{ entry_id: q2, topic_id: topicA }],
    };
    const result = selectPrintableContent("vocabulary", words, {
      partOfSpeech: "noun", level: "B1", topicId: topicA, search: "run",
    });
    expect(result.vocabulary_entries.map((row) => row.id)).toEqual([q2]);
  });
});
