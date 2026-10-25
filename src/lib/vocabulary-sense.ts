/** Conservative identity rules for dictionary senses.
 *
 * A lemma is NOT a sense: one spelling may have many POS, definitions,
 * translations and source glosses (e.g. run/WORKING and run/PUBLISH).
 * Only exact, corroborated senses may be blocked as duplicates.
 */
export type SenseTranslation = { language: string; value: string };
export type SenseRecord = {
  word: string;
  learning_language: string;
  part_of_speech?: string | null;
  definition?: string | null;
  notes?: string | null;
  translations?: SenseTranslation[] | null;
};

export type SenseMatch = "different" | "exact" | "review";

function normalized(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC").trim().replace(/\s+/g, " ")
    .toLocaleLowerCase("en")
    // Unicode lowercasing of capital dotted İ produces i + combining dot.
    .replace(/i\u0307/g, "i");
}

function language(value: string | null | undefined): string {
  return normalized(value).replace(/_/g, "-");
}

function translationMap(values: SenseTranslation[] | null | undefined): Map<string, Set<string>> {
  const translations = new Map<string, Set<string>>();
  for (const translation of values ?? []) {
    const lang = language(translation.language);
    const value = normalized(translation.value);
    if (!lang || !value) continue;
    const list = translations.get(lang) ?? new Set<string>();
    list.add(value);
    translations.set(lang, list);
  }
  return translations;
}

/** Returns exact only if independent meaning evidence matches.
 * Returns review for ambiguous same-lemma entries: never automatically block
 * them or automatically approve them as distinct senses.
 */
export function compareVocabularySenses(incoming: SenseRecord, existing: SenseRecord): SenseMatch {
  if (
    normalized(incoming.word) !== normalized(existing.word) ||
    language(incoming.learning_language) !== language(existing.learning_language)
  ) return "different";

  const fields: Array<keyof Pick<SenseRecord, "part_of_speech" | "definition" | "notes">> = [
    "part_of_speech", "definition", "notes",
  ];
  let evidence = 0;
  let asymmetricMetadata = false;
  for (const field of fields) {
    const a = normalized(incoming[field]);
    const b = normalized(existing[field]);
    if (!a || !b) {
      // A missing gloss or POS is not evidence that a new record represents
      // the same sense. Even a matching translation can be polysemous.
      if (Boolean(a) !== Boolean(b)) asymmetricMetadata = true;
      continue;
    }
    if (a !== b) return "different";
    if (field !== "part_of_speech") evidence += 1;
  }

  const left = translationMap(incoming.translations);
  const right = translationMap(existing.translations);
  for (const [lang, values] of left) {
    const other = right.get(lang);
    if (!other) continue;
    const overlap = [...values].some((value) => other.has(value));
    if (!overlap) return "different";
    evidence += 1;
  }
  return evidence > 0 && !asymmetricMetadata ? "exact" : "review";
}

export function classifySenseAgainstExisting(
  incoming: SenseRecord,
  existing: Array<SenseRecord & { id: string }>,
): { exactDuplicateId: string | null; needsTeacherReview: boolean } {
  let needsTeacherReview = false;
  for (const item of existing) {
    const match = compareVocabularySenses(incoming, item);
    if (match === "exact") {
      return { exactDuplicateId: item.id, needsTeacherReview: false };
    }
    if (match === "review") needsTeacherReview = true;
  }
  return { exactDuplicateId: null, needsTeacherReview };
}
