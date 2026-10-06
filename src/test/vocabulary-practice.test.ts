import { describe, expect, it } from "vitest";
import {
  acceptedVocabularyAnswers,
  gradeVocabularyResponse,
  initialVocabularyState,
  nextVocabularyState,
  normalizeVocabularyText,
} from "@/lib/vocabulary-practice";

describe("vocabulary practice", () => {
  it("normalizes case, unicode, outer punctuation and whitespace", () => {
    expect(normalizeVocabularyText("  HELLO   World!  ")).toBe("hello world");
  });

  it("supports explicit alternative translations separated by pipes", () => {
    expect(acceptedVocabularyAnswers(["rəng | rəngi", "RƏNG"])).toEqual([
      "rəng",
      "rəngi",
    ]);
  });

  it("grades exact normalized recall without fuzzy typo correction", () => {
    expect(gradeVocabularyResponse("  Paris ", ["paris"]).correct).toBe(true);
    expect(gradeVocabularyResponse("pariis", ["paris"]).correct).toBe(false);
  });

  it("moves a new word to known after three consecutive correct answers", () => {
    let state = initialVocabularyState();
    state = nextVocabularyState(state, { kind: "answer", correct: true });
    expect(state.state).toBe("learning");
    state = nextVocabularyState(state, { kind: "answer", correct: true });
    expect(state.state).toBe("learning");
    state = nextVocabularyState(state, { kind: "answer", correct: true });
    expect(state.state).toBe("known");
    expect(state.correct_count).toBe(3);
    expect(state.correct_streak).toBe(3);
  });

  it("a wrong answer resets the streak and returns the word to learning", () => {
    const state = nextVocabularyState(
      {
        state: "known",
        correct_count: 5,
        incorrect_count: 1,
        correct_streak: 5,
      },
      { kind: "answer", correct: false },
    );
    expect(state).toEqual({
      state: "learning",
      correct_count: 5,
      incorrect_count: 2,
      correct_streak: 0,
    });
  });

  it("supports explicit flashcard self-rating", () => {
    expect(
      nextVocabularyState(initialVocabularyState(), {
        kind: "rating",
        rating: "known",
      }).state,
    ).toBe("known");

    expect(
      nextVocabularyState(
        {
          state: "known",
          correct_count: 3,
          incorrect_count: 0,
          correct_streak: 3,
        },
        { kind: "rating", rating: "learning" },
      ),
    ).toMatchObject({ state: "learning", correct_streak: 0 });
  });
});
