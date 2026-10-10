/** Teacher-supervised import policy for optional vocabulary metadata.
 *
 * Missing POS/CEFR is not malformed source data. Keep it visible for teacher
 * review, and permit a deliberate per-item approval without fabricating values.
 * Bulk/high-confidence approval must NEVER silently approve these warnings.
 */
export type VocabularyReviewMetadata = {
  learning_language: string;
  part_of_speech?: string | null;
  level?: string | null;
};

export function vocabularyMetadataWarning(
  item: VocabularyReviewMetadata,
): string | null {
  if (item.learning_language.toLowerCase().split("-")[0] !== "en") return null;
  const missing: string[] = [];
  if (!item.part_of_speech?.trim()) missing.push("part of speech");
  if (!item.level?.trim()) missing.push("CEFR level");
  return missing.length
    ? `Missing ${missing.join(" and ")}. The teacher may approve this word without these details, or edit it first.`
    : null;
}

export function isTeacherApprovableValidationState(state: string): boolean {
  return state === "ready" || state === "ready_with_warning";
}
