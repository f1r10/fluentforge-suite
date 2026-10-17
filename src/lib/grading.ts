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


export type MatchingPair = { left: string; right: string };

/** Score matching pairs by normalized left->right correspondence. */
export function scoreMatching(
  response: MatchingPair[],
  correctPairs: MatchingPair[],
  n: Normalization = {},
  s: Scoring = {},
) {
  const points = s.points ?? 1;
  if (!correctPairs.length) return 0;

  const responseMap = new Map(
    response.map((pair) => [normalizeAnswer(pair.left, n), normalizeAnswer(pair.right, n)]),
  );

  const correct = correctPairs.filter((pair) => {
    const left = normalizeAnswer(pair.left, n);
    const right = normalizeAnswer(pair.right, n);
    return responseMap.get(left) === right;
  }).length;

  if (correct === correctPairs.length && response.length === correctPairs.length) return points;
  return s.partial ? (correct / correctPairs.length) * points : 0;
}

/** Score ordering/sequencing questions. */
export function scoreOrdering(
  response: string[],
  correctOrder: string[],
  n: Normalization = {},
  s: Scoring = {},
) {
  const points = s.points ?? 1;
  if (!correctOrder.length) return 0;

  const normalizedResponse = response.map((x) => normalizeAnswer(x, n));
  const normalizedCorrect = correctOrder.map((x) => normalizeAnswer(x, n));

  const exact =
    normalizedResponse.length === normalizedCorrect.length &&
    normalizedResponse.every((value, index) => value === normalizedCorrect[index]);

  if (exact) return points;
  if (!s.partial) return 0;

  const matches = normalizedCorrect.filter(
    (value, index) => normalizedResponse[index] === value,
  ).length;

  return (matches / normalizedCorrect.length) * points;
}
