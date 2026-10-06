export type VocabularyLearnerState = "new" | "learning" | "known";
export type VocabularyPracticeMode =
  | "flashcard"
  | "translation_recall"
  | "reverse_recall"
  | "multiple_choice";

export type VocabularyStateSnapshot = {
  state: VocabularyLearnerState;
  correct_count: number;
  incorrect_count: number;
  correct_streak: number;
};

export function normalizeVocabularyText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
}

export function acceptedVocabularyAnswers(values: string[]) {
  return [
    ...new Set(
      values
        .flatMap((value) => value.split("|"))
        .map(normalizeVocabularyText)
        .filter(Boolean),
    ),
  ];
}

export function gradeVocabularyResponse(
  response: string,
  accepted: string[],
) {
  const normalized = normalizeVocabularyText(response);
  const normalizedAccepted = acceptedVocabularyAnswers(accepted);
  return {
    correct: !!normalized && normalizedAccepted.includes(normalized),
    normalized,
    accepted: normalizedAccepted,
  };
}

export function nextVocabularyState(
  current: VocabularyStateSnapshot,
  input:
    | { kind: "rating"; rating: "known" | "learning" }
    | { kind: "answer"; correct: boolean },
): VocabularyStateSnapshot {
  if (input.kind === "rating") {
    return {
      ...current,
      state: input.rating,
      correct_streak:
        input.rating === "known"
          ? Math.max(current.correct_streak, 3)
          : 0,
    };
  }

  if (input.correct) {
    const streak = current.correct_streak + 1;
    return {
      state:
        current.state === "known" || streak >= 3
          ? "known"
          : "learning",
      correct_count: current.correct_count + 1,
      incorrect_count: current.incorrect_count,
      correct_streak: streak,
    };
  }

  return {
    state: "learning",
    correct_count: current.correct_count,
    incorrect_count: current.incorrect_count + 1,
    correct_streak: 0,
  };
}

export function initialVocabularyState(): VocabularyStateSnapshot {
  return {
    state: "new",
    correct_count: 0,
    incorrect_count: 0,
    correct_streak: 0,
  };
}
