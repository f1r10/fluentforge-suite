import { TYPE_BY_ID } from "./question-types";

export const QUESTION_IMPORT_FIELDS = [
  "question_type",
  "prompt",
  "instructions",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "option_f",
  "option_g",
  "option_h",
  "correct",
  "answers",
  "pairs",
  "order",
  "model_answer",
  "learning_language",
  "level",
  "difficulty",
  "points",
  "partial",
  "negative",
  "grading_mode",
  "status",
  "tags",
  "topic_ids",
  "media_id",
  "payload_json",
  "answer_json",
  "explanation",
  "teacher_notes",
  "case_sensitive",
  "ignore_punctuation",
  "ignore_diacritics",
] as const;

export type QuestionImportField = (typeof QUESTION_IMPORT_FIELDS)[number];

export type QuestionImportRow = {
  rowNumber: number;
  sourceSheet?: string | null;
  values: Partial<Record<QuestionImportField, string>>;
};

export type QuestionImportDefaults = {
  question_type: string;
  learning_language: string | null;
  level: string | null;
  status: "active" | "draft" | "archived";
  topicIds: string[];
  tags: string[];
};

export const QUESTION_IMPORT_FIELD_LABELS: Record<QuestionImportField, string> = {
  question_type: "Question type",
  prompt: "Question / prompt",
  instructions: "Instructions",
  option_a: "Option A",
  option_b: "Option B",
  option_c: "Option C",
  option_d: "Option D",
  option_e: "Option E",
  option_f: "Option F",
  option_g: "Option G",
  option_h: "Option H",
  correct: "Correct answer",
  answers: "Accepted answers / blanks",
  pairs: "Matching pairs",
  order: "Ordering items",
  model_answer: "Model answer",
  learning_language: "Learning language",
  level: "Level",
  difficulty: "Difficulty",
  points: "Points",
  partial: "Partial scoring",
  negative: "Negative score",
  grading_mode: "Grading mode",
  status: "Status",
  tags: "Tags",
  topic_ids: "Topic IDs",
  media_id: "Media ID",
  payload_json: "Payload JSON",
  answer_json: "Answer JSON",
  explanation: "Explanation",
  teacher_notes: "Teacher notes",
  case_sensitive: "Case sensitive",
  ignore_punctuation: "Ignore punctuation",
  ignore_diacritics: "Ignore diacritics",
};

const aliases: Record<QuestionImportField, string[]> = {
  question_type: ["question_type", "type", "question type", "questiontype"],
  prompt: ["prompt", "question", "question_text", "question text", "text"],
  instructions: ["instructions", "instruction", "directions"],
  option_a: ["option_a", "option a", "a", "choice_a", "choice a"],
  option_b: ["option_b", "option b", "b", "choice_b", "choice b"],
  option_c: ["option_c", "option c", "c", "choice_c", "choice c"],
  option_d: ["option_d", "option d", "d", "choice_d", "choice d"],
  option_e: ["option_e", "option e", "e", "choice_e", "choice e"],
  option_f: ["option_f", "option f", "f", "choice_f", "choice f"],
  option_g: ["option_g", "option g", "g", "choice_g", "choice g"],
  option_h: ["option_h", "option h", "h", "choice_h", "choice h"],
  correct: ["correct", "correct_answer", "correct answer", "answer", "key"],
  answers: ["answers", "accepted_answers", "accepted answers", "blanks"],
  pairs: ["pairs", "matching", "matches"],
  order: ["order", "ordering", "sequence"],
  model_answer: ["model_answer", "model answer", "sample_answer", "sample answer"],
  learning_language: ["learning_language", "language", "lang"],
  level: ["level", "cefr"],
  difficulty: ["difficulty"],
  points: ["points", "score", "marks"],
  partial: ["partial", "partial_scoring", "partial scoring"],
  negative: ["negative", "negative_marking", "negative marking"],
  grading_mode: ["grading_mode", "grading mode", "grading"],
  status: ["status"],
  tags: ["tags", "tag"],
  topic_ids: ["topic_ids", "topic ids", "topics"],
  media_id: ["media_id", "media id"],
  payload_json: ["payload_json", "payload json", "payload"],
  answer_json: ["answer_json", "answer json", "answer_key_json", "answer key json"],
  explanation: ["explanation", "feedback"],
  teacher_notes: ["teacher_notes", "teacher notes", "notes"],
  case_sensitive: ["case_sensitive", "case sensitive"],
  ignore_punctuation: ["ignore_punctuation", "ignore punctuation"],
  ignore_diacritics: ["ignore_diacritics", "ignore diacritics"],
};

export function autoMapQuestionImportHeaders(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const mapping: Partial<Record<QuestionImportField, string>> = {};

  for (const field of QUESTION_IMPORT_FIELDS) {
    const candidates = new Set(aliases[field].map(normalizeHeader));
    const index = normalized.findIndex((header) => candidates.has(header));
    if (index >= 0) mapping[field] = headers[index]!;
  }

  return mapping;
}

export function buildMappedImportRows(
  headers: string[],
  matrixRows: string[][],
  mapping: Partial<Record<QuestionImportField, string>>,
  sourceSheet?: string | null,
): QuestionImportRow[] {
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  return matrixRows
    .map((row, rowIndex) => {
      const values: Partial<Record<QuestionImportField, string>> = {};
      for (const field of QUESTION_IMPORT_FIELDS) {
        const header = mapping[field];
        if (!header) continue;
        const index = indexByHeader.get(header);
        if (index == null) continue;
        const value = String(row[index] ?? "").trim();
        if (value) values[field] = value;
      }
      return {
        rowNumber: rowIndex + 2,
        sourceSheet: sourceSheet ?? null,
        values,
      };
    })
    .filter((row) => Object.values(row.values).some((value) => !!value));
}

export function buildQuestionInputFromImportRow(
  row: QuestionImportRow,
  defaults: QuestionImportDefaults,
) {
  const value = (field: QuestionImportField) => row.values[field]?.trim() ?? "";
  const questionType = value("question_type") || defaults.question_type || "single_choice";
  const def = TYPE_BY_ID[questionType];

  let payload: Record<string, unknown> = {};
  let answerKey: Record<string, unknown> = {};

  const payloadJson = value("payload_json");
  if (payloadJson) {
    payload = parseJsonObject(payloadJson, "payload_json");
  }

  const answerJson = value("answer_json");
  if (answerJson) {
    answerKey = parseJsonObject(answerJson, "answer_json");
  }

  if (!payloadJson || !answerJson) {
    if (def?.editor === "choice") {
      const optionFields = [
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "option_e",
        "option_f",
        "option_g",
        "option_h",
      ] as const;
      const options = optionFields
        .map((field, index) => ({
          id: String.fromCharCode(97 + index),
          text: value(field),
        }))
        .filter((option) => !!option.text);

      if (!payloadJson) payload = { ...payload, options };
      if (!answerJson) {
        answerKey = {
          correct: parseChoiceAnswers(value("correct"), options),
        };
      }
    } else if (def?.editor === "fixed_choice") {
      if (!payloadJson) payload = { ...payload, options: def.fixedOptions ?? [] };
      if (!answerJson) answerKey = { correct: [value("correct")] };
    } else if (def?.editor === "text") {
      if (!payloadJson) {
        payload = {
          ...payload,
          blank_count: Math.max(1, parseBlankAnswers(value("answers") || value("correct")).length),
          ...(value("media_id") ? { media_id: value("media_id") } : {}),
        };
      }
      if (!answerJson) {
        answerKey = {
          blanks: parseBlankAnswers(value("answers") || value("correct")),
        };
      }
    } else if (def?.editor === "matching") {
      if (!payloadJson && value("media_id")) {
        payload = { ...payload, media_id: value("media_id") };
      }
      if (!answerJson) {
        answerKey = { pairs: parsePairs(value("pairs")) };
      }
    } else if (def?.editor === "ordering") {
      if (!answerJson) {
        answerKey = { order: splitDoubleSemicolon(value("order")) };
      }
    } else if (def?.editor === "open") {
      if (!answerJson && value("model_answer")) {
        answerKey = { model_answer: value("model_answer") };
      }
    }
  }

  const rowTags = splitLoose(value("tags"));
  const rowTopics = splitLoose(value("topic_ids"));

  return {
    question_type: questionType,
    prompt: value("prompt"),
    instructions: value("instructions") || null,
    payload,
    answer_key: answerKey,
    scoring: {
      points: numberOr(value("points"), 1),
      partial: booleanValue(value("partial"), false),
      negative: numberOr(value("negative"), 0),
    },
    normalization: {
      case_sensitive: booleanValue(value("case_sensitive"), false),
      trim_whitespace: true,
      ignore_punctuation: booleanValue(value("ignore_punctuation"), false),
      ignore_diacritics: booleanValue(value("ignore_diacritics"), false),
    },
    explanation: value("explanation") || null,
    teacher_notes: value("teacher_notes") || null,
    learning_language: value("learning_language") || defaults.learning_language || null,
    level: value("level") || defaults.level || null,
    difficulty: nullableInteger(value("difficulty")),
    grading_mode:
      normalizeGradingMode(value("grading_mode")) ??
      def?.defaultGrading ??
      (def?.editor === "open" ? "manual" : "automatic"),
    status: normalizeStatus(value("status")) ?? defaults.status,
    reusable_independently: false,
    topicIds: [...new Set([...defaults.topicIds, ...rowTopics])],
    tags: [...new Set([...defaults.tags, ...rowTags].map((tag) => tag.toLowerCase()))],
    force: false,
  };
}

export function parseDelimitedText(input: string): string[][] {
  const normalized = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalized);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!;
    const next = normalized[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function detectDelimiter(input: string) {
  const sample = input.split(/\r?\n/).slice(0, 5).join("\n");
  const candidates = ["\t", ",", ";"] as const;
  let best: (typeof candidates)[number] = "\t";
  let bestScore = -1;

  for (const delimiter of candidates) {
    let score = 0;
    let quoted = false;
    for (const char of sample) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) score++;
    }
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }

  return best;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function parseJsonObject(value: string, field: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseChoiceAnswers(
  raw: string,
  options: Array<{ id: string; text: string }>,
) {
  const tokens = splitLoose(raw);
  return tokens.map((token) => {
    const upper = token.toUpperCase();
    if (/^[A-H]$/.test(upper)) return upper.toLowerCase();
    if (/^[1-8]$/.test(token)) {
      const option = options[Number(token) - 1];
      return option?.id ?? token;
    }
    const exact = options.find(
      (option) => option.text.trim().toLowerCase() === token.trim().toLowerCase(),
    );
    return exact?.id ?? token;
  });
}

function parseBlankAnswers(raw: string) {
  const blanks = splitDoubleSemicolon(raw);
  if (!blanks.length) return [[]];
  return blanks.map((blank) =>
    blank
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parsePairs(raw: string) {
  return splitDoubleSemicolon(raw)
    .map((entry) => {
      const parts = entry.split(/\s*(?:=>|→|=)\s*/, 2);
      return {
        left: parts[0]?.trim() ?? "",
        right: parts[1]?.trim() ?? "",
      };
    })
    .filter((pair) => pair.left || pair.right);
}

function splitDoubleSemicolon(value: string) {
  return value
    .split(/;;|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLoose(value: string) {
  return value
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOr(value: string, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableInteger(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function booleanValue(value: string, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeStatus(value: string) {
  if (value === "active" || value === "draft" || value === "archived") {
    return value;
  }
  return null;
}

function normalizeGradingMode(value: string) {
  if (
    value === "automatic" ||
    value === "manual" ||
    value === "ai_assisted"
  ) {
    return value;
  }
  return null;
}
