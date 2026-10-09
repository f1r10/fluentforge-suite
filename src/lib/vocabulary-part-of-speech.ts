export type PartOfSpeechRepairReason =
  | "restore_previous"
  | "restore_import"
  | "fill_missing_import"
  | "fill_missing_dictionary";

export type PartOfSpeechRepairDecision = {
  value: string | null;
  reason: PartOfSpeechRepairReason;
};

export function choosePartOfSpeechRepair(input: {
  current: string | null | undefined;
  imported: string | null | undefined;
  dictionary: string | null | undefined;
  previousBeforeRepair: string | null | undefined;
  previousWasRecorded: boolean;
}): PartOfSpeechRepairDecision | null {
  const current = clean(input.current);
  const imported = clean(input.imported);
  const dictionary = clean(input.dictionary);

  // If the old automatic repair feature touched this row, undo that change
  // first. This is intentionally exact: a null previous value is restored to
  // null rather than replaced by another dictionary guess.
  if (input.previousWasRecorded) {
    const previous = clean(input.previousBeforeRepair);
    if (previous !== current) {
      return { value: previous, reason: "restore_previous" };
    }
    return null;
  }

  // Never overwrite an existing teacher/import value merely because a
  // dictionary exposes another valid sense. Ambiguous lemmas commonly have
  // several parts of speech.
  if (current) return null;

  // When the database field is missing, the original import payload is more
  // authoritative than enrichment data because it reflects the source
  // document selected and approved by the teacher.
  if (imported) {
    return { value: imported, reason: "fill_missing_import" };
  }

  if (dictionary) {
    return { value: dictionary, reason: "fill_missing_dictionary" };
  }

  return null;
}

function clean(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
