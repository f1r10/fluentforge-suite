import { describe, expect, it } from "vitest";
import {
  autoMapQuestionImportHeaders,
  buildMappedImportRows,
  buildQuestionInputFromImportRow,
  parseDelimitedText,
} from "@/lib/question-import";
import { validateQuestionInput } from "@/lib/question-schema";

const defaults = {
  question_type: "single_choice",
  learning_language: "en",
  level: "B1",
  status: "draft" as const,
  topicIds: [],
  tags: [],
};

describe("question spreadsheet import", () => {
  it("parses quoted CSV including commas", () => {
    const rows = parseDelimitedText(
      'question,type,option_a,option_b,correct\n"Capital of France, please?",single_choice,Paris,London,A',
    );
    expect(rows).toEqual([
      ["question", "type", "option_a", "option_b", "correct"],
      ["Capital of France, please?", "single_choice", "Paris", "London", "A"],
    ]);
  });

  it("parses tab-separated bulk paste", () => {
    const rows = parseDelimitedText(
      "question\ttype\tcorrect\nEarth is round\ttrue_false\tTrue",
    );
    expect(rows[1]).toEqual(["Earth is round", "true_false", "True"]);
  });

  it("automatically maps common header aliases", () => {
    const headers = ["Question", "Type", "Option A", "Option B", "Correct Answer"];
    expect(autoMapQuestionImportHeaders(headers)).toMatchObject({
      prompt: "Question",
      question_type: "Type",
      option_a: "Option A",
      option_b: "Option B",
      correct: "Correct Answer",
    });
  });

  it("builds and validates a single-choice row", () => {
    const headers = ["Question", "Type", "Option A", "Option B", "Correct"];
    const mapping = autoMapQuestionImportHeaders(headers);
    const [row] = buildMappedImportRows(
      headers,
      [["Capital of France?", "single_choice", "Paris", "London", "A"]],
      mapping,
      "Questions",
    );

    const input = validateQuestionInput(
      buildQuestionInputFromImportRow(row!, defaults),
    );

    expect(input.question_type).toBe("single_choice");
    expect(input.status).toBe("draft");
    expect(input.answer_key).toEqual({ correct: ["a"] });
    expect(input.payload).toEqual({
      options: [
        { id: "a", text: "Paris" },
        { id: "b", text: "London" },
      ],
    });
  });

  it("supports text alternatives and multiple blanks", () => {
    const input = validateQuestionInput(
      buildQuestionInputFromImportRow(
        {
          rowNumber: 2,
          values: {
            question_type: "cloze",
            prompt: "Complete the text",
            answers: "color|colour;;centre|center",
          },
        },
        defaults,
      ),
    );

    expect(input.answer_key).toEqual({
      blanks: [
        ["color", "colour"],
        ["centre", "center"],
      ],
    });
    expect(input.payload).toMatchObject({ blank_count: 2 });
  });

  it("supports matching and ordering compact formats", () => {
    const matching = validateQuestionInput(
      buildQuestionInputFromImportRow(
        {
          rowNumber: 2,
          values: {
            question_type: "matching_pairs",
            prompt: "Match",
            pairs: "cat=>pişik;;dog=>it",
          },
        },
        defaults,
      ),
    );
    expect(matching.answer_key).toEqual({
      pairs: [
        { left: "cat", right: "pişik" },
        { left: "dog", right: "it" },
      ],
    });

    const ordering = validateQuestionInput(
      buildQuestionInputFromImportRow(
        {
          rowNumber: 3,
          values: {
            question_type: "ordering",
            prompt: "Order",
            order: "first;;second;;third",
          },
        },
        defaults,
      ),
    );
    expect(ordering.answer_key).toEqual({
      order: ["first", "second", "third"],
    });
  });

  it("supports advanced payload_json and answer_json", () => {
    const mediaId = "11111111-1111-4111-8111-111111111111";
    const labelId = "22222222-2222-4222-8222-222222222222";
    const input = validateQuestionInput(
      buildQuestionInputFromImportRow(
        {
          rowNumber: 2,
          values: {
            question_type: "image_labelling",
            prompt: "Label the image",
            payload_json: JSON.stringify({
              media_id: mediaId,
              labels: [{ id: labelId, x: 30, y: 40 }],
            }),
            answer_json: JSON.stringify({
              pairs: [{ left: labelId, right: "Heart" }],
            }),
          },
        },
        defaults,
      ),
    );

    expect((input.payload as { media_id: string }).media_id).toBe(mediaId);
  });

  it("rejects malformed JSON import fields", () => {
    expect(() =>
      buildQuestionInputFromImportRow(
        {
          rowNumber: 2,
          values: {
            question_type: "single_choice",
            prompt: "Broken",
            payload_json: "{not-json}",
          },
        },
        defaults,
      ),
    ).toThrow(/payload_json/i);
  });
});
