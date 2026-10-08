import { describe, expect, it } from "vitest";
import { validateQuestionInput } from "@/lib/question-schema";

const base = {
  prompt: "Example question",
  instructions: null,
  scoring: { points: 1, partial: false, negative: 0 },
  normalization: {
    case_sensitive: false,
    trim_whitespace: true,
    ignore_punctuation: false,
    ignore_diacritics: false,
  },
  explanation: null,
  teacher_notes: null,
  learning_language: "en",
  level: "B1",
  difficulty: 2,
  grading_mode: "automatic" as const,
  status: "active" as const,
  reusable_independently: false,
  topicIds: [],
  tags: [],
  force: false,
};

describe("question schema", () => {
  it("accepts a valid single-choice question", () => {
    const q = validateQuestionInput({
      ...base,
      question_type: "single_choice",
      payload: {
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
      },
      answer_key: { correct: ["a"] },
    });
    expect(q.answer_key).toEqual({ correct: ["a"] });
  });

  it("rejects more than one correct answer for single choice", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "single_choice",
        payload: {
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
        },
        answer_key: { correct: ["a", "b"] },
      }),
    ).toThrow(/exactly one/i);
  });

  it("rejects choice answers that reference missing options", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "multiple_choice",
        payload: {
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
        },
        answer_key: { correct: ["missing"] },
      }),
    ).toThrow(/does not exist/i);
  });

  it("accepts alternative spellings for text answers", () => {
    const q = validateQuestionInput({
      ...base,
      question_type: "short_answer",
      payload: { blank_count: 1 },
      answer_key: { blanks: [["color", "colour"]] },
    });
    expect((q.answer_key as { blanks: string[][] }).blanks[0]).toEqual(["color", "colour"]);
  });

  it("requires every text blank to have an accepted answer", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "cloze",
        payload: { blank_count: 2 },
        answer_key: { blanks: [["one"], []] },
      }),
    ).toThrow();
  });

  it("rejects mismatched blank counts", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "fill_blank",
        payload: { blank_count: 2 },
        answer_key: { blanks: [["answer"]] },
      }),
    ).toThrow(/Blank count/i);
  });

  it("requires matching pairs to contain both sides", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "matching_pairs",
        payload: {},
        answer_key: { pairs: [{ left: "A", right: "" }] },
      }),
    ).toThrow();
  });

  it("accepts a valid visual labelling question", () => {
    const labelId = "11111111-1111-4111-8111-111111111111";
    const mediaId = "22222222-2222-4222-8222-222222222222";
    const q = validateQuestionInput({
      ...base,
      question_type: "image_labelling",
      payload: {
        media_id: mediaId,
        labels: [{ id: labelId, x: 25.5, y: 61.25 }],
      },
      answer_key: {
        pairs: [{ left: labelId, right: "heart" }],
      },
    });

    expect((q.payload as { media_id: string }).media_id).toBe(mediaId);
  });

  it("requires media for visual labelling questions", () => {
    const labelId = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "diagram_labelling",
        payload: {
          labels: [{ id: labelId, x: 10, y: 20 }],
        },
        answer_key: {
          pairs: [{ left: labelId, right: "A" }],
        },
      }),
    ).toThrow(/require media/i);
  });

  it("requires every visual label to have one matching answer", () => {
    const labelId = "11111111-1111-4111-8111-111111111111";
    const otherId = "33333333-3333-4333-8333-333333333333";
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "map_labelling",
        payload: {
          media_id: "22222222-2222-4222-8222-222222222222",
          labels: [{ id: labelId, x: 50, y: 50 }],
        },
        answer_key: {
          pairs: [{ left: otherId, right: "Station" }],
        },
      }),
    ).toThrow(/exactly one matching answer/i);
  });

  it("requires media for listening transcription", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "listening_transcription",
        payload: { blank_count: 1 },
        answer_key: { blanks: [["hello"]] },
      }),
    ).toThrow(/require audio or video media/i);
  });

  it("accepts dictation with attached media", () => {
    const q = validateQuestionInput({
      ...base,
      question_type: "dictation",
      payload: {
        blank_count: 1,
        media_id: "44444444-4444-4444-8444-444444444444",
      },
      answer_key: { blanks: [["hello world"]] },
    });
    expect((q.payload as { media_id: string }).media_id).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("requires at least two ordering items", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "ordering",
        payload: {},
        answer_key: { order: ["only one"] },
      }),
    ).toThrow(/at least two/i);
  });

  it("rejects unknown question types", () => {
    expect(() =>
      validateQuestionInput({
        ...base,
        question_type: "unknown_type",
        payload: {},
        answer_key: {},
      }),
    ).toThrow(/Unsupported question type/i);
  });
});
