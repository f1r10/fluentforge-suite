import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreBlanks,
  scoreMatching,
  scoreMultipleChoice,
  scoreOrdering,
  type Normalization,
  type Scoring,
} from "./grading";
import { QUESTION_TYPES, TYPE_BY_ID } from "./question-types";
import {
  gradeVocabularyResponse,
  initialVocabularyState,
  nextVocabularyState,
} from "./vocabulary-practice";

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

const historyModeSchema = z.enum(["all", "mistakes", "unused"]);
const poolSourceSchema = z.enum(["all", "catalog", "specific"]);

const commonPoolSchema = z.object({
  source: poolSourceSchema.default("all"),
  catalogId: z.string().uuid().nullable().default(null),
  specificIds: z.array(z.string().uuid()).max(200).default([]),
  language: z.string().max(10).nullable().default(null),
  level: z.string().max(20).nullable().default(null),
});

const questionPoolSchema = commonPoolSchema.extend({
  count: z.number().int().min(0).max(100).default(10),
  types: z.array(z.string().max(60)).max(50).default([]),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  sourceFileId: z.string().uuid().nullable().default(null),
  difficulty: z.number().int().min(1).max(5).nullable().default(null),
  historyMode: historyModeSchema.default("all"),
  excludeAnswered: z.boolean().default(false),
});

const vocabularyPoolSchema = commonPoolSchema.extend({
  count: z.number().int().min(0).max(100).default(0),
  direction: z
    .enum(["word_to_translation", "translation_to_word", "mixed"])
    .default("word_to_translation"),
  translationLanguage: z.string().trim().min(2).max(10).default("az"),
});

const readingPoolSchema = commonPoolSchema.extend({
  count: z.number().int().min(0).max(20).default(0),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
});

const listeningPoolSchema = commonPoolSchema.extend({
  count: z.number().int().min(0).max(20).default(0),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
});

const generatorSchema = z.object({
  sessionMode: z.enum(["practice", "mock_exam"]).default("practice"),
  durationMinutes: z.number().int().min(5).max(240).default(30),
  feedbackMode: z.enum(["instant", "end"]).default("instant"),
  questions: questionPoolSchema,
  vocabulary: vocabularyPoolSchema,
  readings: readingPoolSchema,
  listenings: listeningPoolSchema,
});

export type SelfPracticeGenerator = z.infer<typeof generatorSchema>;

const responseSchema = z
  .object({
    selected: z.array(z.string().max(100)).max(200).optional(),
    answers: z.array(z.string().max(10_000)).max(200).optional(),
    pairs: z
      .array(
        z.object({
          left: z.string().max(10_000),
          right: z.string().max(10_000),
        }),
      )
      .max(200)
      .optional(),
    order: z.array(z.string().max(10_000)).max(200).optional(),
    text: z.string().max(100_000).optional(),
  })
  .strict();

export type SelfPracticeResponse = z.infer<typeof responseSchema>;

const answerSchema = z.object({
  questionId: z.string().uuid(),
  response: responseSchema,
  duration_ms: z.number().int().min(0).max(86_400_000).default(0),
});

const vocabularyAnswerSchema = z.object({
  entryId: z.string().uuid(),
  direction: z.enum(["word_to_translation", "translation_to_word"]),
  targetLanguage: z.string().trim().min(2).max(10),
  response: z.string().max(10_000),
  duration_ms: z.number().int().min(0).max(86_400_000).default(0),
});

export type SelfPracticeVocabularyAnswer = z.infer<
  typeof vocabularyAnswerSchema
>;

export type SelfPracticeVocabularyItem = {
  entryId: string;
  prompt: string;
  direction: "word_to_translation" | "translation_to_word";
  targetLanguage: string;
  learningLanguage: string;
  level: string | null;
  partOfSpeech: string | null;
};

type LoadedQuestion = {
  id: string;
  question_type: string;
  prompt: string;
  instructions: string | null;
  payload: unknown;
  answer_key: unknown;
  scoring: unknown;
  normalization: unknown;
  explanation: string | null;
  grading_mode: string;
  current_version: number;
  learning_language: string | null;
  level: string | null;
  context_kind: "none" | "reading" | "listening";
  reading_question_set_id: string | null;
  listening_question_set_id: string | null;
};

async function getStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

async function assignedCatalogIds(admin: Admin, studentId: string) {
  const { data: memberships, error: membershipsError } = await admin
    .from("group_memberships")
    .select("group_id")
    .eq("student_id", studentId);
  if (membershipsError) throw new Error(membershipsError.message);

  const groupIds = (memberships ?? []).map((row) => row.group_id);
  const [direct, grouped] = await Promise.all([
    admin.from("catalog_assignments").select("catalog_id").eq("student_id", studentId),
    groupIds.length
      ? admin.from("catalog_assignments").select("catalog_id").in("group_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (direct.error) throw new Error(direct.error.message);
  if (grouped.error) throw new Error(grouped.error.message);

  return [...new Set([...(direct.data ?? []), ...(grouped.data ?? [])].map((row) => row.catalog_id))];
}

function shuffle<T>(input: T[]) {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function publicQuestion(question: LoadedQuestion) {
  const def = TYPE_BY_ID[question.question_type];
  const payload =
    question.payload && typeof question.payload === "object"
      ? { ...(question.payload as Record<string, unknown>) }
      : {};

  if (def?.editor === "matching") {
    const answer =
      question.answer_key && typeof question.answer_key === "object"
        ? (question.answer_key as Record<string, unknown>)
        : {};
    const pairs = Array.isArray(answer["pairs"])
      ? (answer["pairs"] as Array<{ left: string; right: string }>)
      : [];
    payload["left_items"] = pairs.map((pair) => pair.left);
    payload["right_options"] = shuffle([...new Set(pairs.map((pair) => pair.right))]);
  }

  if (def?.editor === "ordering") {
    const answer =
      question.answer_key && typeof question.answer_key === "object"
        ? (question.answer_key as Record<string, unknown>)
        : {};
    const order = Array.isArray(answer["order"]) ? (answer["order"] as string[]) : [];
    payload["items"] = shuffle(order);
  }

  return {
    id: question.id,
    question_type: question.question_type,
    prompt: question.prompt,
    instructions: question.instructions,
    payload,
    scoring: question.scoring,
    grading_mode: question.grading_mode,
    current_version: question.current_version,
    learning_language: question.learning_language,
    level: question.level,
  };
}

function numericScoring(value: unknown): Scoring {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    points: typeof source["points"] === "number" ? source["points"] : 1,
    partial: source["partial"] === true,
    negative: typeof source["negative"] === "number" ? source["negative"] : 0,
  };
}

function answerNormalization(value: unknown): Normalization {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    case_sensitive: source["case_sensitive"] === true,
    trim_whitespace: source["trim_whitespace"] !== false,
    ignore_punctuation: source["ignore_punctuation"] === true,
    ignore_diacritics: source["ignore_diacritics"] === true,
  };
}

function gradeQuestion(question: LoadedQuestion, response: SelfPracticeResponse) {
  const def = TYPE_BY_ID[question.question_type];
  const scoring = numericScoring(question.scoring);
  const normal = answerNormalization(question.normalization);
  const answer =
    question.answer_key && typeof question.answer_key === "object"
      ? (question.answer_key as Record<string, unknown>)
      : {};

  if (!def || def.editor === "open" || question.grading_mode !== "automatic") {
    return {
      score: null as number | null,
      max_score: scoring.points ?? 1,
      is_correct: null as boolean | null,
      needs_review: true,
    };
  }

  let score = 0;
  if (def.editor === "choice" || def.editor === "fixed_choice") {
    const correct = Array.isArray(answer["correct"]) ? (answer["correct"] as string[]) : [];
    score = scoreMultipleChoice(response.selected ?? [], correct, scoring);
  } else if (def.editor === "text") {
    const blanks = Array.isArray(answer["blanks"]) ? (answer["blanks"] as string[][]) : [];
    score = scoreBlanks(response.answers ?? [], blanks, normal, scoring);
  } else if (def.editor === "matching") {
    const pairs = Array.isArray(answer["pairs"])
      ? (answer["pairs"] as Array<{ left: string; right: string }>)
      : [];
    score = scoreMatching(response.pairs ?? [], pairs, normal, scoring);
  } else if (def.editor === "ordering") {
    const order = Array.isArray(answer["order"]) ? (answer["order"] as string[]) : [];
    score = scoreOrdering(response.order ?? [], order, normal, scoring);
  }

  const maxScore = scoring.points ?? 1;
  return {
    score,
    max_score: maxScore,
    is_correct: Math.abs(score - maxScore) < 1e-9,
    needs_review: false,
  };
}

async function loadSelfPracticeQuestions(admin: Admin, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, LoadedQuestion>();

  const { data, error } = await admin
    .from("questions")
    .select(
      "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,learning_language,level,context_kind,reading_question_set_id,listening_question_set_id",
    )
    .in("id", unique)
    .eq("status", "active")
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as LoadedQuestion[];
  const readingSetIds = [
    ...new Set(
      rows
        .filter((row) => row.context_kind === "reading")
        .map((row) => row.reading_question_set_id)
        .filter((value): value is string => !!value),
    ),
  ];
  const listeningSetIds = [
    ...new Set(
      rows
        .filter((row) => row.context_kind === "listening")
        .map((row) => row.listening_question_set_id)
        .filter((value): value is string => !!value),
    ),
  ];

  const [readingSets, listeningSets] = await Promise.all([
    readingSetIds.length
      ? admin
          .from("reading_question_sets")
          .select("id,readings!inner(id,status,deleted_at)")
          .in("id", readingSetIds)
          .eq("readings.status", "active")
          .is("readings.deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    listeningSetIds.length
      ? admin
          .from("listening_question_sets")
          .select("id,listenings!inner(id,status,deleted_at)")
          .in("id", listeningSetIds)
          .eq("listenings.status", "active")
          .is("listenings.deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (readingSets.error) throw new Error(readingSets.error.message);
  if (listeningSets.error) throw new Error(listeningSets.error.message);

  const validReadingSets = new Set(
    (readingSets.data ?? []).map((row) => row.id),
  );
  const validListeningSets = new Set(
    (listeningSets.data ?? []).map((row) => row.id),
  );

  return new Map(
    rows
      .filter((row) => {
        if (row.context_kind === "none") return true;
        if (row.context_kind === "reading") {
          return (
            !!row.reading_question_set_id &&
            validReadingSets.has(row.reading_question_set_id)
          );
        }
        if (row.context_kind === "listening") {
          return (
            !!row.listening_question_set_id &&
            validListeningSets.has(row.listening_question_set_id)
          );
        }
        return false;
      })
      .map((row) => [row.id, row]),
  );
}

async function gradeAnswers(
  admin: Admin,
  answers: Array<z.infer<typeof answerSchema>>,
) {
  const loaded = await loadSelfPracticeQuestions(
    admin,
    answers.map((answer) => answer.questionId),
  );

  if (loaded.size !== new Set(answers.map((answer) => answer.questionId)).size) {
    throw new Error("One or more questions are no longer available for self-practice.");
  }

  return answers.map((answer) => {
    const question = loaded.get(answer.questionId)!;
    const grade = gradeQuestion(question, answer.response);
    return {
      question_id: question.id,
      question_version: question.current_version,
      question_type: question.question_type,
      ...grade,
      explanation: question.explanation,
      answer_key: question.answer_key,
      response: answer.response,
      duration_ms: answer.duration_ms,
    };
  });
}

async function logPracticeAnswers(
  admin: Admin,
  studentId: string,
  sessionId: string,
  results: Awaited<ReturnType<typeof gradeAnswers>>,
  practiceKind = "self",
  contextId: string | null = null,
) {
  if (!results.length) return;

  const { error } = await admin.from("activity_events").insert(
    results.map((result) => ({
      student_id: studentId,
      category: "practice",
      event_type: "practice_answer",
      entity_type: "question",
      entity_id: result.question_id,
      is_correct: result.is_correct,
      response: result.response as never,
      duration_ms: result.duration_ms,
      details: {
        practice_kind: practiceKind,
        context_id: contextId,
        session_id: sessionId,
        score: result.score,
        max_score: result.max_score,
        question_version: result.question_version,
        question_type: result.question_type,
        needs_review: result.needs_review,
      } as never,
    })),
  );
  if (error) throw new Error(error.message);
}

async function gradeAndLog(
  admin: Admin,
  studentId: string,
  sessionId: string,
  answers: Array<z.infer<typeof answerSchema>>,
  practiceKind = "self",
  contextId: string | null = null,
) {
  const results = await gradeAnswers(admin, answers);
  await logPracticeAnswers(
    admin,
    studentId,
    sessionId,
    results,
    practiceKind,
    contextId,
  );
  return results.map(({ response, duration_ms, ...result }) => result);
}

export const getSelfPracticeOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);
    const assignedIds = await assignedCatalogIds(admin, studentId);

    const [
      topicsResult,
      catalogsResult,
      questionsResult,
      vocabularyResult,
      readingsResult,
      listeningsResult,
      catalogItemsResult,
    ] = await Promise.all([
      admin
        .from("topics")
        .select("id,name,parent_id,sort_order")
        .order("sort_order")
        .order("name"),
      assignedIds.length
        ? admin
            .from("catalogs")
            .select("id,name,parent_id")
            .in("id", assignedIds)
            .eq("status", "active")
            .is("deleted_at", null)
            .order("sort_order")
            .order("name")
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("questions")
        .select("id,prompt,question_type,learning_language,level")
        .eq("status", "active")
        .eq("context_kind", "none")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1_000),
      admin
        .from("vocabulary_entries")
        .select(
          "id,word,part_of_speech,learning_language,level,vocabulary_translations(language,value)",
        )
        .eq("status", "active")
        .is("deleted_at", null)
        .order("word")
        .limit(1_000),
      admin
        .from("readings")
        .select("id,title,learning_language,level")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("title")
        .limit(1_000),
      admin
        .from("listenings")
        .select("id,title,learning_language,level,media_id")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("title")
        .limit(1_000),
      assignedIds.length
        ? admin
            .from("catalog_items")
            .select("catalog_id,entity_type,entity_id")
            .in("catalog_id", assignedIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [
      topicsResult,
      catalogsResult,
      questionsResult,
      vocabularyResult,
      readingsResult,
      listeningsResult,
      catalogItemsResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const memberships = new Map<string, string[]>();
    for (const row of catalogItemsResult.data ?? []) {
      const key = `${row.entity_type}:${row.entity_id}`;
      memberships.set(key, [
        ...(memberships.get(key) ?? []),
        row.catalog_id,
      ]);
    }

    const withCatalogs = <
      T extends { id: string },
    >(
      kind: "question" | "vocabulary" | "reading" | "listening",
      rows: T[],
    ) =>
      rows.map((row) => ({
        ...row,
        catalogIds: memberships.get(`${kind}:${row.id}`) ?? [],
      }));

    const vocabulary = withCatalogs(
      "vocabulary",
      (vocabularyResult.data ?? []).map((row) => ({
        id: row.id,
        word: row.word,
        part_of_speech: row.part_of_speech,
        learning_language: row.learning_language,
        level: row.level,
        translationLanguages: [
          ...new Set(
            (
              (row.vocabulary_translations ?? []) as Array<{
                language: string;
                value: string;
              }>
            )
              .map((translation) => translation.language)
              .filter(Boolean),
          ),
        ],
      })),
    );

    const languages = [
      ...new Set(
        [
          ...(questionsResult.data ?? []),
          ...(vocabularyResult.data ?? []),
          ...(readingsResult.data ?? []),
          ...(listeningsResult.data ?? []),
        ]
          .map((row) => row.learning_language)
          .filter((value): value is string => !!value),
      ),
    ].sort();

    const translationLanguages = [
      ...new Set(
        vocabulary.flatMap((row) => row.translationLanguages),
      ),
    ].sort();

    return {
      topics: topicsResult.data ?? [],
      catalogs: catalogsResult.data ?? [],
      languages,
      translationLanguages,
      questionTypes: QUESTION_TYPES.map((type) => ({
        id: type.id,
        label: type.label,
      })),
      questions: withCatalogs("question", questionsResult.data ?? []),
      vocabulary,
      readings: withCatalogs("reading", readingsResult.data ?? []),
      listenings: withCatalogs("listening", listeningsResult.data ?? []),
    };
  });

async function ensurePoolCatalogAccess(
  admin: Admin,
  assignedIds: string[],
  catalogId: string | null,
) {
  if (!catalogId) {
    throw new Error("Choose a catalog for this content section.");
  }
  if (!assignedIds.includes(catalogId)) {
    throw new Error("This catalog is not assigned to you.");
  }

  const { data: catalog, error } = await admin
    .from("catalogs")
    .select("id")
    .eq("id", catalogId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!catalog) {
    throw new Error("This catalog is not currently available.");
  }
}

async function catalogEntityIds(
  admin: Admin,
  catalogId: string,
  entityType: "question" | "vocabulary" | "reading" | "listening",
) {
  const { data, error } = await admin
    .from("catalog_items")
    .select("entity_id")
    .eq("catalog_id", catalogId)
    .eq("entity_type", entityType);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.entity_id);
}

async function selectQuestionPracticeIds(
  admin: Admin,
  studentId: string,
  assignedIds: string[],
  pool: SelfPracticeGenerator["questions"],
) {
  if (pool.source === "specific") {
    if (!pool.specificIds.length) return [];
    const { data, error } = await admin
      .from("questions")
      .select("id")
      .in("id", pool.specificIds)
      .eq("status", "active")
      .eq("context_kind", "none")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const available = new Set((data ?? []).map((row) => row.id));
    return pool.specificIds.filter((id) => available.has(id));
  }

  let catalogId: string | null = null;
  if (pool.source === "catalog") {
    await ensurePoolCatalogAccess(admin, assignedIds, pool.catalogId);
    catalogId = pool.catalogId;
  }

  if (pool.count <= 0) return [];
  const result = await admin.rpc("select_self_practice_question_ids", {
    p_student_id: studentId,
    p_count: pool.count,
    p_language: pool.language,
    p_level: pool.level,
    p_types: pool.types.length ? pool.types : null,
    p_topic_ids: pool.topicIds.length ? pool.topicIds : null,
    p_catalog_id: catalogId,
    p_source_file_id: pool.sourceFileId,
    p_history_mode: pool.historyMode,
    p_exclude_answered: pool.excludeAnswered,
    p_difficulty: pool.difficulty,
  });
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as Array<{ question_id: string }>).map(
    (row) => row.question_id,
  );
}

async function selectContextPracticeIds(
  admin: Admin,
  assignedIds: string[],
  kind: "reading" | "listening",
  pool:
    | SelfPracticeGenerator["readings"]
    | SelfPracticeGenerator["listenings"],
) {
  const table = kind === "reading" ? "readings" : "listenings";
  let allowedIds: string[] | null = null;

  if (pool.source === "specific") {
    allowedIds = pool.specificIds;
    if (!allowedIds.length) return [];
  } else if (pool.source === "catalog") {
    await ensurePoolCatalogAccess(admin, assignedIds, pool.catalogId);
    allowedIds = await catalogEntityIds(
      admin,
      pool.catalogId!,
      kind,
    );
    if (!allowedIds.length) return [];
  } else if (pool.count <= 0) {
    return [];
  }

  if (pool.topicIds.length) {
    const relationTable =
      kind === "reading" ? "reading_topics" : "listening_topics";
    const parentColumn =
      kind === "reading" ? "reading_id" : "listening_id";
    const { data: tagged, error: taggedError } = await admin
      .from(relationTable)
      .select(parentColumn)
      .in("topic_id", pool.topicIds);
    if (taggedError) throw new Error(taggedError.message);
    const taggedIds = [
      ...new Set(
        (tagged ?? [])
          .map((row) =>
            String((row as Record<string, unknown>)[parentColumn] ?? ""),
          )
          .filter(Boolean),
      ),
    ];
    if (!taggedIds.length) return [];
    allowedIds =
      allowedIds == null
        ? taggedIds
        : allowedIds.filter((id) => taggedIds.includes(id));
    if (!allowedIds.length) return [];
  }

  let query = admin
    .from(table)
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1_000);

  if (pool.language) query = query.eq("learning_language", pool.language);
  if (pool.level) query = query.eq("level", pool.level);
  if (allowedIds) query = query.in("id", allowedIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const candidateIds = (data ?? []).map((row) => row.id);
  if (!candidateIds.length) return [];

  const questionSetTable =
    kind === "reading"
      ? "reading_question_sets"
      : "listening_question_sets";
  const parentColumn =
    kind === "reading" ? "reading_id" : "listening_id";
  const questionSetColumn =
    kind === "reading"
      ? "reading_question_set_id"
      : "listening_question_set_id";

  const { data: questionSets, error: questionSetError } = await admin
    .from(questionSetTable)
    .select(`id,${parentColumn}`)
    .in(parentColumn, candidateIds);
  if (questionSetError) throw new Error(questionSetError.message);

  const setIds = (questionSets ?? []).map((row) => row.id);
  if (!setIds.length) return [];

  const { data: linkedQuestions, error: linkedError } = await admin
    .from("questions")
    .select(questionSetColumn)
    .in(questionSetColumn, setIds)
    .eq("status", "active")
    .is("deleted_at", null);
  if (linkedError) throw new Error(linkedError.message);

  const setsWithQuestions = new Set(
    (linkedQuestions ?? [])
      .map((row) =>
        String(
          (row as Record<string, unknown>)[questionSetColumn] ?? "",
        ),
      )
      .filter(Boolean),
  );
  const parentsWithQuestions = new Set(
    (questionSets ?? [])
      .filter((row) => setsWithQuestions.has(row.id))
      .map((row) =>
        String((row as Record<string, unknown>)[parentColumn] ?? ""),
      )
      .filter(Boolean),
  );

  const usable = candidateIds.filter((id) =>
    parentsWithQuestions.has(id),
  );
  if (pool.source === "specific") {
    const usableSet = new Set(usable);
    return pool.specificIds.filter((id) => usableSet.has(id));
  }
  return shuffle(usable).slice(0, pool.count);
}

async function selectVocabularyPracticeItems(
  admin: Admin,
  assignedIds: string[],
  pool: SelfPracticeGenerator["vocabulary"],
): Promise<SelfPracticeVocabularyItem[]> {
  let allowedIds: string[] | null = null;

  if (pool.source === "specific") {
    allowedIds = pool.specificIds;
    if (!allowedIds.length) return [];
  } else if (pool.source === "catalog") {
    await ensurePoolCatalogAccess(admin, assignedIds, pool.catalogId);
    allowedIds = await catalogEntityIds(
      admin,
      pool.catalogId!,
      "vocabulary",
    );
    if (!allowedIds.length) return [];
  } else if (pool.count <= 0) {
    return [];
  }

  let query = admin
    .from("vocabulary_entries")
    .select(
      "id,word,part_of_speech,learning_language,level,vocabulary_translations(language,value)",
    )
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1_000);

  if (pool.language) query = query.eq("learning_language", pool.language);
  if (pool.level) query = query.eq("level", pool.level);
  if (allowedIds) query = query.in("id", allowedIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const candidates = (data ?? []).flatMap((row) => {
    const translations = (row.vocabulary_translations ?? []) as Array<{
      language: string;
      value: string;
    }>;
    const target = translations.find(
      (translation) =>
        translation.language.toLowerCase() ===
        pool.translationLanguage.toLowerCase(),
    );
    if (!target) return [];

    const direction =
      pool.direction === "mixed"
        ? Math.random() < 0.5
          ? ("word_to_translation" as const)
          : ("translation_to_word" as const)
        : pool.direction;

    return [
      {
        entryId: row.id,
        prompt:
          direction === "word_to_translation" ? row.word : target.value,
        direction,
        targetLanguage: target.language,
        learningLanguage: row.learning_language,
        level: row.level,
        partOfSpeech: row.part_of_speech,
      },
    ];
  });

  if (pool.source === "specific") {
    const byId = new Map(candidates.map((row) => [row.entryId, row]));
    return pool.specificIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }
  return shuffle(candidates).slice(0, pool.count);
}

function requestedPoolCount(
  source: "all" | "catalog" | "specific",
  count: number,
  specificIds: string[],
) {
  return source === "specific" ? specificIds.length : count;
}

export const generateSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => generatorSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);
    const assignedIds = await assignedCatalogIds(admin, studentId);

    const [questionIds, vocabulary, readingIds, listeningIds] =
      await Promise.all([
        selectQuestionPracticeIds(
          admin,
          studentId,
          assignedIds,
          data.questions,
        ),
        selectVocabularyPracticeItems(
          admin,
          assignedIds,
          data.vocabulary,
        ),
        selectContextPracticeIds(
          admin,
          assignedIds,
          "reading",
          data.readings,
        ),
        selectContextPracticeIds(
          admin,
          assignedIds,
          "listening",
          data.listenings,
        ),
      ]);

    const loaded = await loadSelfPracticeQuestions(admin, questionIds);
    const ordered = questionIds
      .map((id) => loaded.get(id))
      .filter((question): question is LoadedQuestion => !!question);

    const { hydrateQuestionMedia } = await import("./media.server");
    const hydrated = await hydrateQuestionMedia(
      admin,
      ordered,
      6 * 60 * 60,
    );

    const {
      loadReadingPracticeData,
      loadListeningPracticeData,
    } = await import("./student-library.functions");
    const [readings, listenings] = await Promise.all([
      loadReadingPracticeData(admin, readingIds),
      loadListeningPracticeData(admin, listeningIds),
    ]);

    const requested =
      requestedPoolCount(
        data.questions.source,
        data.questions.count,
        data.questions.specificIds,
      ) +
      requestedPoolCount(
        data.vocabulary.source,
        data.vocabulary.count,
        data.vocabulary.specificIds,
      ) +
      requestedPoolCount(
        data.readings.source,
        data.readings.count,
        data.readings.specificIds,
      ) +
      requestedPoolCount(
        data.listenings.source,
        data.listenings.count,
        data.listenings.specificIds,
      );

    return {
      requested,
      generated:
        hydrated.length +
        vocabulary.length +
        readings.length +
        listenings.length,
      questions: hydrated.map(publicQuestion),
      vocabulary,
      readings,
      listenings,
      filters: data,
    };
  });

async function gradeVocabularyAnswers(
  admin: Admin,
  answers: SelfPracticeVocabularyAnswer[],
) {
  if (!answers.length) return [];

  const ids = [...new Set(answers.map((answer) => answer.entryId))];
  const { data: entries, error } = await admin
    .from("vocabulary_entries")
    .select(
      "id,word,vocabulary_translations(language,value)",
    )
    .in("id", ids)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  if (byId.size !== ids.length) {
    throw new Error(
      "One or more vocabulary entries are no longer available.",
    );
  }

  return answers.map((answer) => {
    const entry = byId.get(answer.entryId)!;
    const translations = (entry.vocabulary_translations ?? []) as Array<{
      language: string;
      value: string;
    }>;
    const target = translations.find(
      (translation) =>
        translation.language.toLowerCase() ===
        answer.targetLanguage.toLowerCase(),
    );
    if (!target) {
      throw new Error(
        "A selected vocabulary item no longer has the required translation.",
      );
    }

    const expected =
      answer.direction === "translation_to_word"
        ? [entry.word]
        : [target.value];
    const grade = gradeVocabularyResponse(answer.response, expected);
    return {
      entry_id: entry.id,
      direction: answer.direction,
      target_language: target.language,
      correct: grade.correct,
      expected: grade.accepted,
      response: answer.response,
      duration_ms: answer.duration_ms,
    };
  });
}

async function logVocabularyPracticeAnswers(
  admin: Admin,
  studentId: string,
  sessionId: string,
  results: Awaited<ReturnType<typeof gradeVocabularyAnswers>>,
) {
  if (!results.length) return;

  const ids = results.map((result) => result.entry_id);
  const { data: states, error: stateError } = await admin
    .from("student_vocabulary_state")
    .select("entry_id,state,correct_count,incorrect_count,correct_streak")
    .eq("student_id", studentId)
    .in("entry_id", ids);
  if (stateError) throw new Error(stateError.message);

  const stateById = new Map(
    (states ?? []).map((row) => [row.entry_id, row]),
  );
  const practicedAt = new Date().toISOString();

  const stateRows = results.map((result) => {
    const existing = stateById.get(result.entry_id);
    const current = existing
      ? {
          state: existing.state as "new" | "learning" | "known",
          correct_count: existing.correct_count,
          incorrect_count: existing.incorrect_count,
          correct_streak: existing.correct_streak,
        }
      : initialVocabularyState();
    const next = nextVocabularyState(current, {
      kind: "answer",
      correct: result.correct,
    });
    return {
      student_id: studentId,
      entry_id: result.entry_id,
      state: next.state,
      correct_count: next.correct_count,
      incorrect_count: next.incorrect_count,
      correct_streak: next.correct_streak,
      last_result: result.correct,
      last_mode:
        result.direction === "translation_to_word"
          ? "reverse_recall"
          : "translation_recall",
      last_practiced_at: practicedAt,
      updated_at: practicedAt,
    };
  });

  const { error: upsertError } = await admin
    .from("student_vocabulary_state")
    .upsert(stateRows, { onConflict: "student_id,entry_id" });
  if (upsertError) throw new Error(upsertError.message);

  const { error: activityError } = await admin.from("activity_events").insert(
    results.map((result) => ({
      student_id: studentId,
      category: "practice",
      event_type: "vocabulary_answer",
      entity_type: "vocabulary",
      entity_id: result.entry_id,
      is_correct: result.correct,
      response: {
        value: result.response,
        target_language: result.target_language,
      } as never,
      duration_ms: result.duration_ms,
      details: {
        practice_kind: "self",
        session_id: sessionId,
        mode:
          result.direction === "translation_to_word"
            ? "reverse_recall"
            : "translation_recall",
        target_language: result.target_language,
        expected: result.expected,
      } as never,
    })),
  );
  if (activityError) throw new Error(activityError.message);
}

export const submitSelfPracticeVocabularyAnswer = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        answer: vocabularyAnswerSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);
    const [result] = await gradeVocabularyAnswers(admin, [data.answer]);
    if (!result) throw new Error("Vocabulary answer could not be graded.");
    await logVocabularyPracticeAnswers(
      admin,
      studentId,
      data.sessionId,
      [result],
    );
    const { response: _response, duration_ms: _duration, ...publicResult } =
      result;
    return { result: publicResult };
  });

export const submitSelfPracticeAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        answer: answerSchema,
        practiceKind: z
          .enum(["self", "question_bank", "reading", "listening"])
          .default("self"),
        contextId: z.string().uuid().nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const [result] = await gradeAndLog(
      admin,
      studentId,
      data.sessionId,
      [data.answer],
      data.practiceKind,
      data.contextId,
    );
    return { result };
  });

export const finishSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        answers: z.array(answerSchema).max(500),
        vocabularyAnswers: z
          .array(vocabularyAnswerSchema)
          .max(500)
          .default([]),
        filters: generatorSchema,
        practiceKind: z
          .enum(["self", "question_bank", "reading", "listening"])
          .default("self"),
        contextId: z.string().uuid().nullable().default(null),
        alreadyLoggedQuestionIds: z
          .array(z.string().uuid())
          .max(500)
          .default([]),
        alreadyLoggedVocabularyIds: z
          .array(z.string().uuid())
          .max(500)
          .default([]),
        presentedQuestionIds: z
          .array(z.string().uuid())
          .max(500)
          .default([]),
        presentedVocabularyIds: z
          .array(z.string().uuid())
          .max(500)
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const [gradedWithPrivate, vocabularyWithPrivate] = await Promise.all([
      gradeAnswers(admin, data.answers),
      gradeVocabularyAnswers(admin, data.vocabularyAnswers),
    ]);

    const alreadyLogged = new Set(data.alreadyLoggedQuestionIds);
    await logPracticeAnswers(
      admin,
      studentId,
      data.sessionId,
      gradedWithPrivate.filter(
        (result) => !alreadyLogged.has(result.question_id),
      ),
      data.practiceKind,
      data.contextId,
    );

    const alreadyLoggedVocabulary = new Set(
      data.alreadyLoggedVocabularyIds,
    );
    await logVocabularyPracticeAnswers(
      admin,
      studentId,
      data.sessionId,
      vocabularyWithPrivate.filter(
        (result) => !alreadyLoggedVocabulary.has(result.entry_id),
      ),
    );

    const answeredIds = new Set(
      data.answers.map((answer) => answer.questionId),
    );
    const skippedIds = [
      ...new Set(
        data.presentedQuestionIds.filter(
          (questionId) => !answeredIds.has(questionId),
        ),
      ),
    ];
    if (skippedIds.length) {
      const skippedQuestions = await loadSelfPracticeQuestions(
        admin,
        skippedIds,
      );
      if (skippedQuestions.size !== skippedIds.length) {
        throw new Error(
          "One or more skipped questions are not valid for self-practice.",
        );
      }
      const { error: skipError } = await admin
        .from("activity_events")
        .insert(
          skippedIds.map((questionId) => ({
            student_id: studentId,
            category: "practice",
            event_type: "practice_question_skipped",
            entity_type: "question",
            entity_id: questionId,
            is_correct: null,
            duration_ms: 0,
            details: {
              practice_kind: data.practiceKind,
              context_id: data.contextId,
              session_id: data.sessionId,
            } as never,
          })),
        );
      if (skipError) throw new Error(skipError.message);
    }

    const vocabularyAnsweredIds = new Set(
      data.vocabularyAnswers.map((answer) => answer.entryId),
    );
    const skippedVocabularyIds = [
      ...new Set(
        data.presentedVocabularyIds.filter(
          (entryId) => !vocabularyAnsweredIds.has(entryId),
        ),
      ),
    ];
    if (skippedVocabularyIds.length) {
      const { error: skipVocabularyError } = await admin
        .from("activity_events")
        .insert(
          skippedVocabularyIds.map((entryId) => ({
            student_id: studentId,
            category: "practice",
            event_type: "practice_vocabulary_skipped",
            entity_type: "vocabulary",
            entity_id: entryId,
            is_correct: null,
            duration_ms: 0,
            details: {
              practice_kind: "self",
              session_id: data.sessionId,
            } as never,
          })),
        );
      if (skipVocabularyError) {
        throw new Error(skipVocabularyError.message);
      }
    }

    const results = gradedWithPrivate.map(
      ({ response, duration_ms, ...result }) => result,
    );
    const vocabularyResults = vocabularyWithPrivate.map(
      ({ response, duration_ms, ...result }) => result,
    );
    const graded = results.filter((result) => result.score != null);
    const questionScore = graded.reduce(
      (sum, result) => sum + (result.score ?? 0),
      0,
    );
    const questionMaxScore = graded.reduce(
      (sum, result) => sum + result.max_score,
      0,
    );
    const vocabularyScore = vocabularyResults.filter(
      (result) => result.correct,
    ).length;
    const vocabularyMaxScore = vocabularyResults.length;
    const score = questionScore + vocabularyScore;
    const maxScore = questionMaxScore + vocabularyMaxScore;

    const summary = {
      answered: results.length + vocabularyResults.length,
      graded: graded.length + vocabularyResults.length,
      score,
      max_score: maxScore,
      accuracy: maxScore > 0 ? score / maxScore : null,
    };

    const { error } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type: "practice_finished",
      entity_type: "self_practice",
      entity_id: null,
      details: {
        practice_kind: data.practiceKind,
        context_id: data.contextId,
        session_id: data.sessionId,
        filters: data.filters,
        vocabulary_answered: vocabularyResults.length,
        ...summary,
      } as never,
    });
    if (error) throw new Error(error.message);

    return { results, vocabularyResults, summary };
  });

export const getMyPracticeProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const [
      statsResult,
      topicResult,
      dailyResult,
      recentResult,
      finishedResult,
      monthResult,
      streakResult,
      domainResult,
    ] = await Promise.all([
      admin.rpc("student_practice_stats", { p_student_id: studentId }),
      admin.rpc("student_topic_practice_stats", { p_student_id: studentId, p_limit: 12 }),
      admin.rpc("student_practice_daily_stats", { p_student_id: studentId, p_days: 14 }),
      admin
        .from("activity_events")
        .select("id,event_type,entity_type,entity_id,is_correct,duration_ms,details,created_at")
        .eq("student_id", studentId)
        .eq("category", "practice")
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("activity_events")
        .select("id,entity_type,entity_id,details,created_at")
        .eq("student_id", studentId)
        .eq("category", "practice")
        .eq("event_type", "practice_finished")
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("activity_events")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("category", "practice")
        .eq("event_type", "practice_answer")
        .gte(
          "created_at",
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        ),
      admin.rpc("student_streak_stats", {
        p_student_id: studentId,
      }),
      admin.rpc("student_domain_progress", {
        p_student_id: studentId,
      }),
    ]);

    for (const result of [
      statsResult,
      topicResult,
      dailyResult,
      recentResult,
      finishedResult,
      monthResult,
      streakResult,
      domainResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const stats = statsResult.data?.[0] ?? {
      total_answers: 0,
      correct_answers: 0,
      wrong_answers: 0,
      manual_answers: 0,
      questions_seen: 0,
      total_time_ms: 0,
      today_answers: 0,
      week_answers: 0,
      current_mistakes: 0,
    };

    const finishedRows = finishedResult.data ?? [];
    const catalogIds = [
      ...new Set(
        finishedRows
          .map((row) => {
            const details = row.details as Record<string, unknown>;
            return typeof details["catalog_id"] === "string" ? details["catalog_id"] : null;
          })
          .filter((value): value is string => !!value),
      ),
    ];
    const { data: catalogRows, error: catalogError } = catalogIds.length
      ? await admin.from("catalogs").select("id,name").in("id", catalogIds)
      : { data: [], error: null };
    if (catalogError) throw new Error(catalogError.message);
    const catalogNames = new Map((catalogRows ?? []).map((row) => [row.id, row.name]));

    const history = finishedRows.map((row) => {
      const details = row.details as Record<string, unknown>;
      const catalogId = typeof details["catalog_id"] === "string" ? details["catalog_id"] : null;
      const practiceKind = details["practice_kind"] === "self" || row.entity_type === "self_practice"
        ? "self"
        : "catalog";
      return {
        id: row.id,
        at: row.created_at,
        kind: practiceKind as "self" | "catalog",
        title: catalogId ? catalogNames.get(catalogId) ?? "Catalog practice" : "Self practice",
        catalog_id: catalogId,
        answered: Number(details["answered"] ?? 0),
        graded: Number(details["graded"] ?? 0),
        score: typeof details["score"] === "number" ? details["score"] : null,
        max_score: typeof details["max_score"] === "number" ? details["max_score"] : null,
        accuracy: typeof details["accuracy"] === "number" ? details["accuracy"] : null,
      };
    });

    return {
      stats: {
        ...stats,
        accuracy:
          stats.correct_answers + stats.wrong_answers > 0
            ? stats.correct_answers / (stats.correct_answers + stats.wrong_answers)
            : null,
        month_answers: monthResult.count ?? 0,
        current_streak:
          Number(streakResult.data?.[0]?.current_streak ?? 0),
        longest_streak:
          Number(streakResult.data?.[0]?.longest_streak ?? 0),
        last_active_day:
          streakResult.data?.[0]?.last_active_day ?? null,
      },
      topics: topicResult.data ?? [],
      domains: (domainResult.data ?? []).map((row) => ({
        domain: row.domain,
        attempts: Number(row.attempts ?? 0),
        correct: Number(row.correct ?? 0),
        incorrect: Number(row.incorrect ?? 0),
        accuracy: row.accuracy == null ? null : Number(row.accuracy),
      })),
      daily: dailyResult.data ?? [],
      recent: recentResult.data ?? [],
      history,
    };
  });
