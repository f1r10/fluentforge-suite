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

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

const historyModeSchema = z.enum(["all", "mistakes", "unused"]);

const generatorSchema = z.object({
  count: z.number().int().min(1).max(100).default(20),
  language: z.string().max(10).nullable().default(null),
  level: z.string().max(20).nullable().default(null),
  types: z.array(z.string().max(60)).max(50).default([]),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  catalogId: z.string().uuid().nullable().default(null),
  sourceFileId: z.string().uuid().nullable().default(null),
  historyMode: historyModeSchema.default("all"),
  excludeAnswered: z.boolean().default(false),
  feedbackMode: z.enum(["instant", "end"]).default("instant"),
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
      "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,learning_language,level",
    )
    .in("id", unique)
    .eq("status", "active")
    .eq("context_kind", "none")
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  return new Map((data ?? []).map((row) => [row.id, row as LoadedQuestion]));
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
        practice_kind: "self",
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
) {
  const results = await gradeAnswers(admin, answers);
  await logPracticeAnswers(admin, studentId, sessionId, results);
  return results.map(({ response, duration_ms, ...result }) => result);
}

export const getSelfPracticeOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    await getStudentId(context.supabase);

    const studentId = await getStudentId(context.supabase);
    const assignedIds = await assignedCatalogIds(admin, studentId);

    const [topicsResult, catalogsResult, sourcesResult, languageResult] = await Promise.all([
      admin.from("topics").select("id,name,parent_id,sort_order").order("sort_order").order("name"),
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
        .from("source_files")
        .select("id,original_filename,created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("questions")
        .select("learning_language")
        .eq("status", "active")
        .eq("context_kind", "none")
        .is("deleted_at", null)
        .not("learning_language", "is", null)
        .limit(2_000),
    ]);

    for (const result of [topicsResult, catalogsResult, sourcesResult, languageResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const languages = [
      ...new Set(
        (languageResult.data ?? [])
          .map((row) => row.learning_language)
          .filter((value): value is string => !!value),
      ),
    ].sort();

    return {
      topics: topicsResult.data ?? [],
      catalogs: catalogsResult.data ?? [],
      sources: sourcesResult.data ?? [],
      languages,
      questionTypes: QUESTION_TYPES.map((type) => ({ id: type.id, label: type.label })),
    };
  });

export const generateSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => generatorSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    if (data.catalogId) {
      const assignedIds = await assignedCatalogIds(admin, studentId);
      if (!assignedIds.includes(data.catalogId)) {
        throw new Error("This catalog is not assigned to you.");
      }
      const { data: catalog, error } = await admin
        .from("catalogs")
        .select("id")
        .eq("id", data.catalogId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!catalog) throw new Error("Catalog not found.");
    }

    if (data.sourceFileId) {
      const { data: source, error } = await admin
        .from("source_files")
        .select("id")
        .eq("id", data.sourceFileId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!source) throw new Error("Source not found.");
    }

    const { data: selected, error: selectError } = await admin.rpc(
      "select_self_practice_question_ids",
      {
        p_student_id: studentId,
        p_count: data.count,
        p_language: data.language,
        p_level: data.level,
        p_types: data.types.length ? data.types : null,
        p_topic_ids: data.topicIds.length ? data.topicIds : null,
        p_catalog_id: data.catalogId,
        p_source_file_id: data.sourceFileId,
        p_history_mode: data.historyMode,
        p_exclude_answered: data.excludeAnswered,
      },
    );

    if (selectError) throw new Error(selectError.message);

    const ids = (selected ?? []).map((row) => row.question_id);
    const loaded = await loadSelfPracticeQuestions(admin, ids);
    const ordered = ids
      .map((id) => loaded.get(id))
      .filter((question): question is LoadedQuestion => !!question);

    const { hydrateQuestionMedia } = await import("./media.server");
    const hydrated = await hydrateQuestionMedia(admin, ordered, 6 * 60 * 60);

    return {
      requested: data.count,
      generated: hydrated.length,
      questions: hydrated.map(publicQuestion),
      filters: data,
    };
  });

export const submitSelfPracticeAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        answer: answerSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const [result] = await gradeAndLog(admin, studentId, data.sessionId, [data.answer]);
    return { result };
  });

export const finishSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        answers: z.array(answerSchema).min(1).max(100),
        filters: generatorSchema,
        alreadyLoggedQuestionIds: z.array(z.string().uuid()).max(100).default([]),
        presentedQuestionIds: z.array(z.string().uuid()).max(100).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const gradedWithPrivate = await gradeAnswers(admin, data.answers);
    const alreadyLogged = new Set(data.alreadyLoggedQuestionIds);
    await logPracticeAnswers(
      admin,
      studentId,
      data.sessionId,
      gradedWithPrivate.filter((result) => !alreadyLogged.has(result.question_id)),
    );

    const answeredIds = new Set(data.answers.map((answer) => answer.questionId));
    const skippedIds = [
      ...new Set(
        data.presentedQuestionIds.filter(
          (questionId) => !answeredIds.has(questionId),
        ),
      ),
    ];
    if (skippedIds.length) {
      const skippedQuestions = await loadSelfPracticeQuestions(admin, skippedIds);
      if (skippedQuestions.size !== skippedIds.length) {
        throw new Error(
          "One or more skipped questions are not valid for self-practice.",
        );
      }
      const { error: skipError } = await admin.from("activity_events").insert(
        skippedIds.map((questionId) => ({
          student_id: studentId,
          category: "practice",
          event_type: "practice_question_skipped",
          entity_type: "question",
          entity_id: questionId,
          is_correct: null,
          duration_ms: 0,
          details: {
            practice_kind: "self",
            session_id: data.sessionId,
          } as never,
        })),
      );
      if (skipError) throw new Error(skipError.message);
    }

    const results = gradedWithPrivate.map(({ response, duration_ms, ...result }) => result);
    const graded = results.filter((result) => result.score != null);
    const score = graded.reduce((sum, result) => sum + (result.score ?? 0), 0);
    const maxScore = graded.reduce((sum, result) => sum + result.max_score, 0);

    const summary = {
      answered: results.length,
      graded: graded.length,
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
        practice_kind: "self",
        session_id: data.sessionId,
        filters: data.filters,
        ...summary,
      } as never,
    });
    if (error) throw new Error(error.message);

    return { results, summary };
  });

export const getMyPracticeProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await getStudentId(context.supabase);

    const [statsResult, topicResult, dailyResult, recentResult, finishedResult] = await Promise.all([
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
    ]);

    for (const result of [statsResult, topicResult, dailyResult, recentResult, finishedResult]) {
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
      },
      topics: topicResult.data ?? [],
      daily: dailyResult.data ?? [],
      recent: recentResult.data ?? [],
      history,
    };
  });
