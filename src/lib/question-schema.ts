import { z } from "zod";
import { TYPE_BY_ID } from "./question-types";

const id = z.string().min(1).max(80);
const shortText = z.string().trim().max(1_000);
const answerText = z.string().trim().min(1).max(1_000);

const optionSchema = z.object({
  id,
  text: z.string().trim().min(1, "Option text is required.").max(2_000),
});

const scoringSchema = z
  .object({
    points: z.number().min(0).max(10_000).default(1),
    partial: z.boolean().default(false),
    negative: z.number().min(0).max(10_000).default(0),
  })
  .default({ points: 1, partial: false, negative: 0 });

const normalizationSchema = z
  .object({
    case_sensitive: z.boolean().default(false),
    trim_whitespace: z.boolean().default(true),
    ignore_punctuation: z.boolean().default(false),
    ignore_diacritics: z.boolean().default(false),
  })
  .default({
    case_sensitive: false,
    trim_whitespace: true,
    ignore_punctuation: false,
    ignore_diacritics: false,
  });

const payloadRecord = z.record(z.string(), z.unknown()).default({});
const answerRecord = z.record(z.string(), z.unknown()).default({});

export const questionInputBaseSchema = z.object({
  id: z.string().uuid().optional(),
  question_type: z.string().min(1).max(60),
  prompt: z.string().trim().min(1, "Question text is required.").max(20_000),
  instructions: z.string().max(5_000).nullable().default(null),
  payload: payloadRecord,
  answer_key: answerRecord,
  scoring: scoringSchema,
  normalization: normalizationSchema,
  explanation: z.string().max(10_000).nullable().default(null),
  teacher_notes: z.string().max(10_000).nullable().default(null),
  learning_language: z.string().max(10).nullable().default(null),
  level: z.string().max(20).nullable().default(null),
  difficulty: z.number().int().min(1).max(5).nullable().default(null),
  grading_mode: z.enum(["automatic", "manual", "ai_assisted"]).default("automatic"),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  reusable_independently: z.boolean().default(false),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  force: z.boolean().default(false),
});

export type QuestionInput = z.infer<typeof questionInputBaseSchema>;

function fail(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: "custom", path, message }]);
}

function parseChoice(input: QuestionInput, multiple: boolean) {
  const payload = z.object({ options: z.array(optionSchema).min(2).max(100) }).parse(input.payload);
  const answer = z.object({ correct: z.array(id).min(1).max(100) }).parse(input.answer_key);

  const optionIds = new Set(payload.options.map((o) => o.id));
  const uniqueCorrect = [...new Set(answer.correct)];

  if (uniqueCorrect.some((x) => !optionIds.has(x))) {
    fail(["answer_key", "correct"], "Correct answer references an option that does not exist.");
  }
  if (!multiple && uniqueCorrect.length !== 1) {
    fail(["answer_key", "correct"], "Single-choice questions require exactly one correct answer.");
  }

  return {
    payload,
    answer_key: { correct: uniqueCorrect },
  };
}

function parseFixedChoice(input: QuestionInput, fixedOptions: string[]) {
  const payload = z
    .object({
      options: z.array(shortText).default(fixedOptions),
    })
    .parse(input.payload);
  const answer = z.object({ correct: z.array(answerText).length(1) }).parse(input.answer_key);
  if (!fixedOptions.includes(answer.correct[0]!)) {
    fail(["answer_key", "correct"], "Correct answer is not valid for this question type.");
  }
  return {
    payload: { ...payload, options: fixedOptions },
    answer_key: answer,
  };
}

function parseText(input: QuestionInput) {
  const answer = z
    .object({
      blanks: z
        .array(z.array(answerText).min(1, "Every blank needs at least one accepted answer.").max(50))
        .min(1, "At least one answer is required.")
        .max(200),
    })
    .parse(input.answer_key);

  const payload = z
    .object({
      blank_count: z.number().int().min(1).max(200).optional(),
      source_sentence: z.string().max(20_000).optional(),
      base_word: z.string().max(500).optional(),
      keyword: z.string().max(500).optional(),
      media_id: z.string().uuid().nullable().optional(),
      transcript: z.string().max(100_000).optional(),
    })
    .passthrough()
    .parse(input.payload);

  if (payload.blank_count != null && payload.blank_count !== answer.blanks.length) {
    fail(["payload", "blank_count"], "Blank count must match the number of answer slots.");
  }

  return {
    payload: { ...payload, blank_count: answer.blanks.length },
    answer_key: answer,
  };
}

function parseOpen(input: QuestionInput) {
  const payload = z
    .object({
      min_words: z.number().int().min(0).max(20_000).nullable().optional(),
      max_words: z.number().int().min(1).max(50_000).nullable().optional(),
      rubric: z.string().max(20_000).optional(),
    })
    .passthrough()
    .parse(input.payload);

  if (payload.min_words != null && payload.max_words != null && payload.min_words > payload.max_words) {
    fail(["payload", "max_words"], "Maximum words must be greater than or equal to minimum words.");
  }

  const answer = z
    .object({
      model_answer: z.string().max(100_000).optional(),
    })
    .passthrough()
    .parse(input.answer_key);

  return { payload, answer_key: answer };
}

function parseMatching(input: QuestionInput) {
  const payload = z
    .object({
      media_id: z.string().uuid().nullable().optional(),
      allow_reuse: z.boolean().optional(),
      labels: z
        .array(
          z.object({
            id,
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
          }),
        )
        .max(100)
        .optional(),
    })
    .passthrough()
    .parse(input.payload);

  const answer = z
    .object({
      pairs: z
        .array(
          z.object({
            left: answerText,
            right: answerText,
          }),
        )
        .min(1, "At least one pair is required.")
        .max(200),
    })
    .parse(input.answer_key);

  return { payload, answer_key: answer };
}

function parseOrdering(input: QuestionInput) {
  const payload = z.record(z.string(), z.unknown()).default({}).parse(input.payload);
  const answer = z
    .object({
      order: z.array(answerText).min(2, "Ordering questions need at least two items.").max(200),
    })
    .parse(input.answer_key);
  return { payload, answer_key: answer };
}

export function validateQuestionInput(raw: unknown): QuestionInput {
  const input = questionInputBaseSchema.parse(raw);
  const def = TYPE_BY_ID[input.question_type];
  if (!def) {
    fail(["question_type"], "Unsupported question type.");
  }

  let typed: { payload: Record<string, unknown>; answer_key: Record<string, unknown> };

  switch (def.editor) {
    case "choice":
      typed = parseChoice(input, !!def.multiple);
      break;
    case "fixed_choice":
      typed = parseFixedChoice(input, def.fixedOptions ?? []);
      break;
    case "text":
      typed = parseText(input);
      break;
    case "open":
      typed = parseOpen(input);
      break;
    case "matching":
      typed = parseMatching(input);
      break;
    case "ordering":
      typed = parseOrdering(input);
      break;
    default:
      fail(["question_type"], "Question type has no validator.");
  }

  const uniqueTopics = [...new Set(input.topicIds)];
  const uniqueTags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

  return {
    ...input,
    payload: typed.payload,
    answer_key: typed.answer_key,
    topicIds: uniqueTopics,
    tags: uniqueTags,
  };
}
