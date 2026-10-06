/** Deterministic answer normalization and grading. No typo tolerance: wrong spellings stay wrong unless listed. */
export type Normalization = {
  case_sensitive?: boolean;
  trim_whitespace?: boolean; // default true
  ignore_punctuation?: boolean;
  ignore_diacritics?: boolean;
};

export function normalizeAnswer(value: string, n: Normalization = {}) {
  let v = value ?? "";
  if (n.trim_whitespace !== false) v = v.trim().replace(/\s+/g, " ");
  if (!n.case_sensitive) v = v.toLocaleLowerCase();
  if (n.ignore_punctuation) v = v.replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  if (n.ignore_diacritics) v = v.normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
  return v;
}

export function matchesAccepted(response: string, accepted: string[], n: Normalization = {}) {
  const r = normalizeAnswer(response, n);
  if (!r) return false;
  return accepted.some((a) => normalizeAnswer(a, n) === r);
}

export type Scoring = { points?: number; partial?: boolean; negative?: number };

/** Score a multiple-choice selection. Partial: correct picks minus wrong picks, floored at 0. */
export function scoreMultipleChoice(selected: string[], correct: string[], s: Scoring = {}) {
  const points = s.points ?? 1;
  const set = new Set(correct);
  const right = selected.filter((x) => set.has(x)).length;
  const wrong = selected.length - right;
  const exact = right === correct.length && wrong === 0;
  if (exact) return points;
  if (!s.partial || correct.length === 0) return selected.length && s.negative ? -s.negative : 0;
  return Math.max(0, ((right - wrong) / correct.length) * points);
}

/** Score blanks: each blank has its own accepted answers. */
export function scoreBlanks(responses: string[], blanks: string[][], n: Normalization, s: Scoring = {}) {
  const points = s.points ?? 1;
  if (!blanks.length) return 0;
  const correct = blanks.filter((acc, i) => matchesAccepted(responses[i] ?? "", acc, n)).length;
  if (correct === blanks.length) return points;
  return s.partial ? (correct / blanks.length) * points : 0;
}
