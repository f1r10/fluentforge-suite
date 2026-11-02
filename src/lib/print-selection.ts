/** Pure, side-effect-free selection of printable question / vocabulary rows.
 * The caller MUST first query only the authenticated teacher's tenant.
 * Never use this helper as a substitute for database tenant authorization.
 */
export type PrintSelection = {
  level?: string;
  language?: string;
  topicId?: string;
  partOfSpeech?: string;
  search?: string;
  selectedIds?: string[];
};

type Row = Record<string, unknown>;

function norm(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function selectedTopicIds(
  links: Row[],
  foreignKey: "question_id" | "entry_id",
  topicId: string,
): Set<string> {
  return new Set(
    links
      .filter((link) => link["topic_id"] === topicId)
      .map((link) => String(link[foreignKey] ?? "")),
  );
}

export function selectPrintableContent(
  kind: "questions" | "vocabulary",
  tables: Record<string, Row[]>,
  filter: PrintSelection,
): Record<string, Row[]> {
  const main = kind === "questions" ? "questions" : "vocabulary_entries";
  // Explicit selections must never produce an incomplete paper silently.
  // A missing ID may indicate the teacher does not own that record.
  if (filter.selectedIds && filter.selectedIds.length === 0) {
    throw new Error("Select at least one item before printing.");
  }
  const selected = filter.selectedIds ? new Set(filter.selectedIds) : null;
  if (selected) {
    if (selected.size !== filter.selectedIds!.length) {
      throw new Error("Duplicate items in print selection.");
    }
    const visibleIds = new Set((tables[main] ?? []).map((row) => String(row["id"] ?? "")));
    if ([...selected].some((id) => !visibleIds.has(id))) {
      throw new Error("Some selected items are unavailable or not authorized for printing.");
    }
  }
  const topicMembers = filter.topicId
    ? selectedTopicIds(
      tables[kind === "questions" ? "question_topics" : "vocabulary_topics"] ?? [],
      kind === "questions" ? "question_id" : "entry_id",
      filter.topicId,
    )
    : null;
  const query = norm(filter.search);
  const rows = (tables[main] ?? []).filter((row) => {
    const id = String(row["id"] ?? "");
    if (selected && !selected.has(id)) return false;
    if (topicMembers && !topicMembers.has(id)) return false;
    if (filter.level && norm(row["level"]) !== norm(filter.level)) return false;
    if (filter.language && norm(row["learning_language"]) !== norm(filter.language)) return false;
    if (kind === "vocabulary" && filter.partOfSpeech &&
      norm(row["part_of_speech"]) !== norm(filter.partOfSpeech)) return false;
    if (query && !norm(row[kind === "questions" ? "prompt" : "word"]).includes(query)) return false;
    return true;
  });
  // Preserve an explicitly selected question order; otherwise stable source order.
  if (selected && filter.selectedIds) {
    const positions = new Map(filter.selectedIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (positions.get(String(a["id"])) ?? Infinity) -
      (positions.get(String(b["id"])) ?? Infinity));
  }
  if (!rows.length) throw new Error("No content matches the selected print filters.");
  return { ...tables, [main]: rows };
}
