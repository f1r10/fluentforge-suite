import { describe, expect, it } from "vitest";
import { publicPracticeQuestion } from "@/lib/student-library.functions";

describe("student learning library payloads", () => {
  it("never exposes answer keys for normal questions", () => {
    const result = publicPracticeQuestion({
      id: "00000000-0000-4000-8000-000000000001",
      question_type: "single_choice",
      prompt: "Pick one",
      instructions: null,
      payload: {
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
      },
      answer_key: { correct: ["a"] },
      scoring: { points: 1, partial: false, negative: 0 },
      grading_mode: "automatic",
      current_version: 1,
    });

    expect(result).not.toHaveProperty("answer_key");
    expect(result.payload).toEqual({
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
    });
  });

  it("derives matching choices without leaking pair answers", () => {
    const result = publicPracticeQuestion({
      id: "00000000-0000-4000-8000-000000000002",
      question_type: "matching_pairs",
      prompt: "Match",
      instructions: null,
      payload: {},
      answer_key: {
        pairs: [
          { left: "one", right: "1" },
          { left: "two", right: "2" },
        ],
      },
      scoring: { points: 2, partial: true, negative: 0 },
      grading_mode: "automatic",
      current_version: 1,
    });

    expect(result).not.toHaveProperty("answer_key");
    expect(result.payload["left_items"]).toEqual(["one", "two"]);
    expect(new Set(result.payload["right_options"] as string[])).toEqual(
      new Set(["1", "2"]),
    );
  });

  it("shuffles ordering items without exposing the canonical order field", () => {
    const result = publicPracticeQuestion({
      id: "00000000-0000-4000-8000-000000000003",
      question_type: "ordering",
      prompt: "Order",
      instructions: null,
      payload: {},
      answer_key: { order: ["first", "second", "third"] },
      scoring: { points: 1, partial: false, negative: 0 },
      grading_mode: "automatic",
      current_version: 1,
    });

    expect(result).not.toHaveProperty("answer_key");
    expect(new Set(result.payload["items"] as string[])).toEqual(
      new Set(["first", "second", "third"]),
    );
  });
});
