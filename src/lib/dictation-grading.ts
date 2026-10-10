/**
 * Pure, server-side dictation grading. NEVER publish the correct transcript
 * in a pre-submission student API response.
 */
export type DictationGradingPolicy = {
  ignoreCase?: boolean;
  ignorePunctuation?: boolean;
  ignoreDiacritics?: boolean;
};
export type DictationTokenFeedback = {
  kind: "match" | "different" | "missing" | "extra";
  expected: string | null;
  received: string | null;
};
export type DictationGrade = {
  scorePercent: number;
  wordErrorRate: number;
  errorCount: number;
  expectedWords: number;
  receivedWords: number;
  feedback: DictationTokenFeedback[];
};
const MAX_WORDS = 200;

function normalizeDictationWord(value: string, policy: DictationGradingPolicy): string {
  let text = value.normalize("NFKC").replace(/[’‘]/g, "'");
  if (policy.ignoreCase !== false) text = text.toLocaleLowerCase();
  if (policy.ignoreDiacritics === true) text = text.normalize("NFD").replace(/\p{M}/gu, "");
  if (policy.ignorePunctuation !== false) text = text.replace(/[\p{P}\p{S}]/gu, "");
  return text;
}

function tokenize(text: string, policy: DictationGradingPolicy) {
  return text.trim().split(/\s+/u).map((raw) => ({
    raw,
    normalized: normalizeDictationWord(raw, policy),
  })).filter((word) => word.normalized.length > 0);
}

export function gradeDictation(
  expected: string,
  received: string,
  policy: DictationGradingPolicy = {},
): DictationGrade {
  const reference = tokenize(expected, policy);
  const actual = tokenize(received, policy);
  const n = reference.length, m = actual.length;
  if (n === 0) throw new Error("Teacher transcript must contain text.");
  if (n > MAX_WORDS || m > MAX_WORDS) throw new Error("Dictation exceeds the 200-word grading limit.");

  // Levenshtein word alignment: substitution, omission and insertion
  // each count one error. Deterministic tie-breaking ensures stable review UI.
  const cost = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) cost[i]![0] = i;
  for (let j = 0; j <= m; j++) cost[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const change = reference[i - 1]!.normalized === actual[j - 1]!.normalized ? 0 : 1;
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + change,
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }
  const reversed: DictationTokenFeedback[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const change = i && j && reference[i - 1]!.normalized !== actual[j - 1]!.normalized ? 1 : 0;
    if (i > 0 && j > 0 && cost[i]![j] === cost[i - 1]![j - 1]! + change) {
      reversed.push({ kind: change ? "different" : "match", expected: reference[i - 1]!.raw, received: actual[j - 1]!.raw });
      i--; j--;
    } else if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      reversed.push({ kind: "missing", expected: reference[i - 1]!.raw, received: null });
      i--;
    } else {
      reversed.push({ kind: "extra", expected: null, received: actual[j - 1]!.raw });
      j--;
    }
  }
  const errors = cost[n]![m]!;
  return {
    scorePercent: Math.max(0, Math.round(100 * (1 - errors / n))),
    wordErrorRate: errors / n,
    errorCount: errors,
    expectedWords: n,
    receivedWords: m,
    feedback: reversed.reverse(),
  };
}
