import { createServerFn } from "@tanstack/react-start";
import { createHmac, timingSafeEqual } from "crypto";
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
import { TYPE_BY_ID } from "./question-types";

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

type CatalogPracticeSettings = {
  shuffle_questions: boolean;
  shuffle_vocabulary: boolean;
  preserve_context: true;
  feedback_mode: "instant" | "end";
  show_explanations: boolean;
  allow_self_practice: boolean;
};

const DEFAULT_SETTINGS: CatalogPracticeSettings = {
  shuffle_questions: true,
  shuffle_vocabulary: true,
  preserve_context: true,
  feedback_mode: "instant",
  show_explanations: true,
  allow_self_practice: true,
};

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

export type PracticeResponse = z.infer<typeof responseSchema>;

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
  context_kind: "none" | "reading" | "listening";
  reading_question_set_id: string | null;
  listening_question_set_id: string | null;
};

function normalizeCatalogSettings(value: unknown): CatalogPracticeSettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    shuffle_questions: source["shuffle_questions"] !== false,
    shuffle_vocabulary: source["shuffle_vocabulary"] !== false,
    preserve_context: true,
    feedback_mode: source["feedback_mode"] === "end" ? "end" : "instant",
    show_explanations: source["show_explanations"] !== false,
    allow_self_practice: source["allow_self_practice"] !== false,
  };
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
    const pairs = Array.isArray((question.answer_key as Record<string, unknown> | null)?.["pairs"])
      ? ((question.answer_key as Record<string, unknown>)["pairs"] as Array<{ left: string; right: string }>)
      : [];
    payload["left_items"] = pairs.map((pair) => pair.left);
    payload["right_options"] = shuffle([...new Set(pairs.map((pair) => pair.right))]);
  }

  if (def?.editor === "ordering") {
    const order = Array.isArray((question.answer_key as Record<string, unknown> | null)?.["order"])
      ? ((question.answer_key as Record<string, unknown>)["order"] as string[])
      : [];
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
  };
}

async function currentStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

async function assignedCatalogIds(admin: Admin, studentId: string) {
  const { data: memberships, error: membershipError } = await admin
    .from("group_memberships")
    .select("group_id")
    .eq("student_id", studentId);
  if (membershipError) throw new Error(membershipError.message);

  const groupIds = (memberships ?? []).map((row) => row.group_id);

  const [direct, viaGroups] = await Promise.all([
    admin.from("catalog_assignments").select("catalog_id").eq("student_id", studentId),
    groupIds.length
      ? admin.from("catalog_assignments").select("catalog_id").in("group_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (direct.error) throw new Error(direct.error.message);
  if (viaGroups.error) throw new Error(viaGroups.error.message);

  return [...new Set([...(direct.data ?? []), ...(viaGroups.data ?? [])].map((row) => row.catalog_id))];
}

async function accessibleCatalog(admin: Admin, studentId: string, catalogId: string) {
  const ids = await assignedCatalogIds(admin, studentId);
  if (!ids.includes(catalogId)) throw new Error("This catalog is not assigned to you.");

  const { data, error } = await admin
    .from("catalogs")
    .select("id,name,description,settings,status")
    .eq("id", catalogId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog is not available.");

  return {
    ...data,
    settings: normalizeCatalogSettings(data.settings),
  };
}

export const listStudentCatalogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const ids = await assignedCatalogIds(admin, studentId);
    if (!ids.length) return [];

    const { data, error } = await admin
      .from("catalogs")
      .select("id,name,description,parent_id,settings,updated_at,catalog_items(count)")
      .in("id", ids)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("sort_order")
      .order("name");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      parent_id: row.parent_id,
      settings: normalizeCatalogSettings(row.settings),
      updated_at: row.updated_at,
      items: (row.catalog_items as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    }));
  });

export const getStudentCatalogPractice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ catalogId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const catalog = await accessibleCatalog(admin, studentId, data.catalogId);

    const { data: rawItems, error: itemsError } = await admin
      .from("catalog_items")
      .select("id,entity_type,entity_id,sort_order")
      .eq("catalog_id", data.catalogId)
      .order("sort_order")
      .order("created_at");
    if (itemsError) throw new Error(itemsError.message);

    const items = rawItems ?? [];
    const directQuestionIds = items.filter((x) => x.entity_type === "question").map((x) => x.entity_id);
    const vocabularyIds = items.filter((x) => x.entity_type === "vocabulary").map((x) => x.entity_id);
    const readingIds = items.filter((x) => x.entity_type === "reading").map((x) => x.entity_id);
    const listeningIds = items.filter((x) => x.entity_type === "listening").map((x) => x.entity_id);

    const [directQuestionsResult, vocabularyResult, readingsResult, listeningsResult] = await Promise.all([
      directQuestionIds.length
        ? admin
            .from("questions")
            .select(
              "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id",
            )
            .in("id", directQuestionIds)
            .eq("status", "active")
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      vocabularyIds.length
        ? admin
            .from("vocabulary_entries")
            .select(
              "id,word,definition,ipa,part_of_speech,learning_language,level,vocabulary_translations(language,value),vocabulary_examples(sentence,translation,sort_order)",
            )
            .in("id", vocabularyIds)
            .eq("status", "active")
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      readingIds.length
        ? admin
            .from("readings")
            .select("id,title,body,learning_language,level,word_count,display_layout")
            .in("id", readingIds)
            .eq("status", "active")
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      listeningIds.length
        ? admin
            .from("listenings")
            .select("id,title,media_id,transcript,learning_language,level,playback_rules")
            .in("id", listeningIds)
            .eq("status", "active")
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [directQuestionsResult, vocabularyResult, readingsResult, listeningsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const readingSetResult = readingIds.length
      ? await admin
          .from("reading_question_sets")
          .select("id,reading_id,title,instructions,sort_order")
          .in("reading_id", readingIds)
          .order("sort_order")
      : { data: [], error: null };
    if (readingSetResult.error) throw new Error(readingSetResult.error.message);

    const listeningSectionResult = listeningIds.length
      ? await admin
          .from("listening_sections")
          .select("id,listening_id,title,start_seconds,end_seconds,sort_order")
          .in("listening_id", listeningIds)
          .order("sort_order")
      : { data: [], error: null };
    if (listeningSectionResult.error) throw new Error(listeningSectionResult.error.message);

    const listeningSetResult = listeningIds.length
      ? await admin
          .from("listening_question_sets")
          .select("id,listening_id,section_id,title,instructions,sort_order")
          .in("listening_id", listeningIds)
          .order("sort_order")
      : { data: [], error: null };
    if (listeningSetResult.error) throw new Error(listeningSetResult.error.message);

    const readingSetIds = (readingSetResult.data ?? []).map((x) => x.id);
    const listeningSetIds = (listeningSetResult.data ?? []).map((x) => x.id);

    const [readingQuestionsResult, listeningQuestionsResult] = await Promise.all([
      readingSetIds.length
        ? admin
            .from("questions")
            .select(
              "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id,context_sort",
            )
            .in("reading_question_set_id", readingSetIds)
            .eq("status", "active")
            .is("deleted_at", null)
            .order("context_sort")
        : Promise.resolve({ data: [], error: null }),
      listeningSetIds.length
        ? admin
            .from("questions")
            .select(
              "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id,context_sort",
            )
            .in("listening_question_set_id", listeningSetIds)
            .eq("status", "active")
            .is("deleted_at", null)
            .order("context_sort")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (readingQuestionsResult.error) throw new Error(readingQuestionsResult.error.message);
    if (listeningQuestionsResult.error) throw new Error(listeningQuestionsResult.error.message);

    const listeningMediaIds = (listeningsResult.data ?? [])
      .map((x) => x.media_id)
      .filter((x): x is string => !!x);

    const mediaResult = listeningMediaIds.length
      ? await admin
          .from("media_assets")
          .select("id,kind,external_url,mime_type,duration_seconds")
          .in("id", listeningMediaIds)
          .is("deleted_at", null)
      : { data: [], error: null };
    if (mediaResult.error) throw new Error(mediaResult.error.message);

    const directQuestions = new Map(
      (directQuestionsResult.data ?? []).map((question) => [
        question.id,
        publicQuestion(question as LoadedQuestion),
      ]),
    );
    const vocabulary = new Map((vocabularyResult.data ?? []).map((entry) => [entry.id, entry]));
    const readings = new Map((readingsResult.data ?? []).map((reading) => [reading.id, reading]));
    const listenings = new Map((listeningsResult.data ?? []).map((listening) => [listening.id, listening]));
    const media = new Map((mediaResult.data ?? []).map((asset) => [asset.id, asset]));

    const readingQuestionsBySet = new Map<string, ReturnType<typeof publicQuestion>[]>();
    for (const question of readingQuestionsResult.data ?? []) {
      if (!question.reading_question_set_id) continue;
      const list = readingQuestionsBySet.get(question.reading_question_set_id) ?? [];
      list.push(publicQuestion(question as LoadedQuestion));
      readingQuestionsBySet.set(question.reading_question_set_id, list);
    }

    const listeningQuestionsBySet = new Map<string, ReturnType<typeof publicQuestion>[]>();
    for (const question of listeningQuestionsResult.data ?? []) {
      if (!question.listening_question_set_id) continue;
      const list = listeningQuestionsBySet.get(question.listening_question_set_id) ?? [];
      list.push(publicQuestion(question as LoadedQuestion));
      listeningQuestionsBySet.set(question.listening_question_set_id, list);
    }

    const readingSetsByReading = new Map<string, Array<Record<string, unknown>>>();
    for (const set of readingSetResult.data ?? []) {
      const list = readingSetsByReading.get(set.reading_id) ?? [];
      list.push({
        id: set.id,
        title: set.title,
        instructions: set.instructions,
        questions: readingQuestionsBySet.get(set.id) ?? [],
      });
      readingSetsByReading.set(set.reading_id, list);
    }

    const sectionsByListening = new Map<string, Array<Record<string, unknown>>>();
    for (const section of listeningSectionResult.data ?? []) {
      const list = sectionsByListening.get(section.listening_id) ?? [];
      list.push({
        id: section.id,
        title: section.title,
        start_seconds: section.start_seconds,
        end_seconds: section.end_seconds,
      });
      sectionsByListening.set(section.listening_id, list);
    }

    const listeningSetsByListening = new Map<string, Array<Record<string, unknown>>>();
    for (const set of listeningSetResult.data ?? []) {
      const list = listeningSetsByListening.get(set.listening_id) ?? [];
      list.push({
        id: set.id,
        section_id: set.section_id,
        title: set.title,
        instructions: set.instructions,
        questions: listeningQuestionsBySet.get(set.id) ?? [],
      });
      listeningSetsByListening.set(set.listening_id, list);
    }

    const blocks = items.flatMap((item) => {
      if (item.entity_type === "question") {
        const question = directQuestions.get(item.entity_id);
        return question ? [{ kind: "question" as const, item_id: item.id, question }] : [];
      }

      if (item.entity_type === "vocabulary") {
        const entry = vocabulary.get(item.entity_id);
        if (!entry) return [];
        return [
          {
            kind: "vocabulary" as const,
            item_id: item.id,
            entry: {
              id: entry.id,
              word: entry.word,
              definition: entry.definition,
              ipa: entry.ipa,
              part_of_speech: entry.part_of_speech,
              learning_language: entry.learning_language,
              level: entry.level,
              translations: (entry.vocabulary_translations ?? []) as Array<{ language: string; value: string }>,
              examples: ((entry.vocabulary_examples ?? []) as Array<{
                sentence: string;
                translation: string | null;
                sort_order: number;
              }>)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((x) => ({ sentence: x.sentence, translation: x.translation })),
            },
          },
        ];
      }

      if (item.entity_type === "reading") {
        const reading = readings.get(item.entity_id);
        if (!reading) return [];
        return [
          {
            kind: "reading" as const,
            item_id: item.id,
            reading: {
              ...reading,
              question_sets: readingSetsByReading.get(reading.id) ?? [],
            },
          },
        ];
      }

      const listening = listenings.get(item.entity_id);
      if (!listening) return [];
      const rules = normalizePlaybackRules(listening.playback_rules);
      const asset = listening.media_id ? media.get(listening.media_id) : null;
      return [
        {
          kind: "listening" as const,
          item_id: item.id,
          listening: {
            id: listening.id,
            title: listening.title,
            learning_language: listening.learning_language,
            level: listening.level,
            transcript: rules.show_transcript ? listening.transcript : null,
            playback_rules: rules,
            media: asset
              ? {
                  id: asset.id,
                  kind: asset.kind,
                  external_url: asset.external_url,
                  mime_type: asset.mime_type,
                  duration_seconds: asset.duration_seconds,
                }
              : null,
            sections: sectionsByListening.get(listening.id) ?? [],
            question_sets: listeningSetsByListening.get(listening.id) ?? [],
          },
        },
      ];
    });

    return {
      catalog: {
        id: catalog.id,
        name: catalog.name,
        description: catalog.description,
        settings: catalog.settings,
      },
      blocks,
    };
  });

function normalizePlaybackRules(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    max_plays:
      typeof source["max_plays"] === "number" && source["max_plays"] > 0
        ? Math.floor(source["max_plays"])
        : null,
    allow_pause: source["allow_pause"] !== false,
    allow_seek: source["allow_seek"] !== false,
    allow_rewind: source["allow_rewind"] !== false,
    show_transcript: source["show_transcript"] === true,
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

function normalization(value: unknown): Normalization {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    case_sensitive: source["case_sensitive"] === true,
    trim_whitespace: source["trim_whitespace"] !== false,
    ignore_punctuation: source["ignore_punctuation"] === true,
    ignore_diacritics: source["ignore_diacritics"] === true,
  };
}

function gradeLoadedQuestion(question: LoadedQuestion, response: PracticeResponse) {
  const def = TYPE_BY_ID[question.question_type];
  const scoring = numericScoring(question.scoring);
  const normal = normalization(question.normalization);
  const answer =
    question.answer_key && typeof question.answer_key === "object"
      ? (question.answer_key as Record<string, unknown>)
      : {};

  if (!def || def.editor === "open" || question.grading_mode !== "automatic") {
    return {
      score: null,
      max_score: scoring.points ?? 1,
      is_correct: null,
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

async function loadAllowedQuestions(
  admin: Admin,
  catalogId: string,
  questionIds: string[],
) {
  const unique = [...new Set(questionIds)];
  if (!unique.length) return new Map<string, LoadedQuestion>();

  const { data: questions, error } = await admin
    .from("questions")
    .select(
      "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id",
    )
    .in("id", unique)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const { data: catalogItems, error: catalogError } = await admin
    .from("catalog_items")
    .select("entity_type,entity_id")
    .eq("catalog_id", catalogId);
  if (catalogError) throw new Error(catalogError.message);

  const directQuestions = new Set(
    (catalogItems ?? []).filter((x) => x.entity_type === "question").map((x) => x.entity_id),
  );
  const readingIds = new Set(
    (catalogItems ?? []).filter((x) => x.entity_type === "reading").map((x) => x.entity_id),
  );
  const listeningIds = new Set(
    (catalogItems ?? []).filter((x) => x.entity_type === "listening").map((x) => x.entity_id),
  );

  const readingSetIds = (questions ?? [])
    .map((q) => q.reading_question_set_id)
    .filter((x): x is string => !!x);
  const listeningSetIds = (questions ?? [])
    .map((q) => q.listening_question_set_id)
    .filter((x): x is string => !!x);

  const [readingSets, listeningSets] = await Promise.all([
    readingSetIds.length
      ? admin.from("reading_question_sets").select("id,reading_id").in("id", readingSetIds)
      : Promise.resolve({ data: [], error: null }),
    listeningSetIds.length
      ? admin.from("listening_question_sets").select("id,listening_id").in("id", listeningSetIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (readingSets.error) throw new Error(readingSets.error.message);
  if (listeningSets.error) throw new Error(listeningSets.error.message);

  const readingBySet = new Map((readingSets.data ?? []).map((x) => [x.id, x.reading_id]));
  const listeningBySet = new Map((listeningSets.data ?? []).map((x) => [x.id, x.listening_id]));

  const allowed = new Map<string, LoadedQuestion>();
  for (const row of questions ?? []) {
    let permitted = directQuestions.has(row.id);
    if (
      !permitted &&
      row.context_kind === "reading" &&
      row.reading_question_set_id &&
      readingIds.has(readingBySet.get(row.reading_question_set_id) ?? "")
    ) {
      permitted = true;
    }
    if (
      !permitted &&
      row.context_kind === "listening" &&
      row.listening_question_set_id &&
      listeningIds.has(listeningBySet.get(row.listening_question_set_id) ?? "")
    ) {
      permitted = true;
    }
    if (permitted) allowed.set(row.id, row as LoadedQuestion);
  }

  return allowed;
}

const answerInputSchema = z.object({
  questionId: z.string().uuid(),
  response: responseSchema,
  duration_ms: z.number().int().min(0).max(86_400_000).default(0),
});

async function gradeAndLog(
  admin: Admin,
  studentId: string,
  catalogId: string,
  sessionId: string,
  answers: Array<z.infer<typeof answerInputSchema>>,
  showExplanations: boolean,
) {
  const loaded = await loadAllowedQuestions(
    admin,
    catalogId,
    answers.map((answer) => answer.questionId),
  );

  if (loaded.size !== new Set(answers.map((answer) => answer.questionId)).size) {
    throw new Error("One or more questions are not available in this catalog.");
  }

  const results = answers.map((answer) => {
    const question = loaded.get(answer.questionId)!;
    const grade = gradeLoadedQuestion(question, answer.response);
    return {
      question_id: question.id,
      question_version: question.current_version,
      question_type: question.question_type,
      ...grade,
      explanation: showExplanations ? question.explanation : null,
      answer_key: question.answer_key,
      response: answer.response,
      duration_ms: answer.duration_ms,
    };
  });

  if (results.length) {
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
          catalog_id: catalogId,
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

  return results.map(({ response, duration_ms, ...result }) => result);
}

export const submitPracticeAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        sessionId: z.string().uuid(),
        answer: answerInputSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const catalog = await accessibleCatalog(admin, studentId, data.catalogId);

    const [result] = await gradeAndLog(
      admin,
      studentId,
      data.catalogId,
      data.sessionId,
      [data.answer],
      catalog.settings.show_explanations,
    );

    if (catalog.settings.feedback_mode === "end") {
      return {
        deferred: true as const,
        question_id: data.answer.questionId,
      };
    }

    return {
      deferred: false as const,
      result,
    };
  });

export const finishPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        sessionId: z.string().uuid(),
        answers: z.array(answerInputSchema).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const catalog = await accessibleCatalog(admin, studentId, data.catalogId);

    const results = await gradeAndLog(
      admin,
      studentId,
      data.catalogId,
      data.sessionId,
      data.answers,
      catalog.settings.show_explanations,
    );

    const graded = results.filter((result) => result.score != null);
    const score = graded.reduce((sum, result) => sum + (result.score ?? 0), 0);
    const maxScore = graded.reduce((sum, result) => sum + result.max_score, 0);

    const { error } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type: "practice_finished",
      entity_type: "catalog",
      entity_id: data.catalogId,
      details: {
        catalog_id: data.catalogId,
        session_id: data.sessionId,
        answered: results.length,
        graded: graded.length,
        score,
        max_score: maxScore,
        accuracy: maxScore > 0 ? score / maxScore : null,
      } as never,
    });
    if (error) throw new Error(error.message);

    return {
      results,
      summary: {
        answered: results.length,
        graded: graded.length,
        score,
        max_score: maxScore,
        accuracy: maxScore > 0 ? score / maxScore : null,
      },
    };
  });


type SelfPracticeFilters = {
  language: string;
  level: string;
  type: string;
  topicId: string | null;
  catalogId: string | null;
  sourceFileId: string | null;
  mode: "all" | "mistakes" | "unused";
  count: number;
};

const selfPracticeFiltersSchema = z.object({
  language: z.string().max(10).default(""),
  level: z.string().max(20).default(""),
  type: z.string().max(60).default(""),
  topicId: z.string().uuid().nullable().default(null),
  catalogId: z.string().uuid().nullable().default(null),
  sourceFileId: z.string().uuid().nullable().default(null),
  mode: z.enum(["all", "mistakes", "unused"]).default("all"),
  count: z.number().int().min(1).max(100).default(20),
});

type SelfPracticeTokenPayload = {
  v: 1;
  studentId: string;
  sessionId: string;
  questionIds: string[];
  filters: SelfPracticeFilters;
  exp: number;
};

function practiceSigningSecret() {
  const secret =
    process.env["SELF_PRACTICE_SIGNING_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    process.env["SETUP_TOKEN"];
  if (!secret) {
    throw new Error("SELF_PRACTICE_SIGNING_KEY is not configured.");
  }
  return secret;
}

function signSelfPracticePayload(payload: SelfPracticeTokenPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", practiceSigningSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySelfPracticeToken(token: string, studentId: string): SelfPracticeTokenPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("Invalid practice session.");

  const expected = createHmac("sha256", practiceSigningSecret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("Invalid practice session.");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid practice session.");
  }

  let payload: SelfPracticeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SelfPracticeTokenPayload;
  } catch {
    throw new Error("Invalid practice session.");
  }

  if (payload.v !== 1 || payload.studentId !== studentId || payload.exp < Date.now()) {
    throw new Error("Practice session expired or is invalid.");
  }
  return payload;
}

export const getSelfPracticeOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    await currentStudentId(context.supabase);

    const [topics, sources, catalogs] = await Promise.all([
      admin
        .from("topics")
        .select("id,name,parent_id")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      admin
        .from("source_files")
        .select("id,original_filename")
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("catalogs")
        .select("id,name")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name"),
    ]);

    for (const result of [topics, sources, catalogs]) {
      if (result.error) throw new Error(result.error.message);
    }

    return {
      topics: topics.data ?? [],
      sources: sources.data ?? [],
      catalogs: catalogs.data ?? [],
      questionTypes: Object.values(TYPE_BY_ID).map((def) => ({
        id: def.id,
        label: def.label,
      })),
    };
  });

export const createSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => selfPracticeFiltersSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);

    let catalogQuestionIds: string[] | null = null;
    if (data.catalogId) {
      const { data: items, error } = await admin
        .from("catalog_items")
        .select("entity_id")
        .eq("catalog_id", data.catalogId)
        .eq("entity_type", "question");
      if (error) throw new Error(error.message);
      catalogQuestionIds = (items ?? []).map((x) => x.entity_id);
      if (!catalogQuestionIds.length) {
        return {
          sessionId: crypto.randomUUID(),
          token: "",
          filters: data,
          questions: [],
        };
      }
    }

    let select =
      "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id,learning_language,level,source_file_id" +
      (data.topicId ? ",qt:question_topics!inner(topic_id)" : "");

    let q = admin
      .from("questions")
      .select(select)
      .eq("status", "active")
      .is("deleted_at", null)
      .or("context_kind.eq.none,reusable_independently.eq.true")
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (data.language) q = q.eq("learning_language", data.language);
    if (data.level) q = q.eq("level", data.level);
    if (data.type) q = q.eq("question_type", data.type);
    if (data.topicId) q = q.eq("qt.topic_id", data.topicId);
    if (data.sourceFileId) q = q.eq("source_file_id", data.sourceFileId);
    if (catalogQuestionIds) q = q.in("id", catalogQuestionIds);

    const { data: candidatesRaw, error } = await q;
    if (error) throw new Error(error.message);

    let candidates = (candidatesRaw ?? []) as unknown as Array<
      LoadedQuestion & {
        learning_language: string | null;
        level: string | null;
        source_file_id: string | null;
      }
    >;

    if (candidates.length && data.mode !== "all") {
      const candidateIds = candidates.map((x) => x.id);
      const { data: activity, error: activityError } = await admin
        .from("activity_events")
        .select("entity_id,is_correct,created_at")
        .eq("student_id", studentId)
        .eq("entity_type", "question")
        .in("entity_id", candidateIds)
        .order("created_at", { ascending: false });
      if (activityError) throw new Error(activityError.message);

      if (data.mode === "unused") {
        const seen = new Set((activity ?? []).map((row) => row.entity_id).filter(Boolean));
        candidates = candidates.filter((question) => !seen.has(question.id));
      } else {
        const latest = new Map<string, boolean | null>();
        for (const row of activity ?? []) {
          if (!row.entity_id || latest.has(row.entity_id)) continue;
          latest.set(row.entity_id, row.is_correct);
        }
        candidates = candidates.filter((question) => latest.get(question.id) === false);
      }
    }

    const selected = shuffle(candidates).slice(0, data.count);
    const sessionId = crypto.randomUUID();
    const filters: SelfPracticeFilters = data;
    const token = selected.length
      ? signSelfPracticePayload({
          v: 1,
          studentId,
          sessionId,
          questionIds: selected.map((question) => question.id),
          filters,
          exp: Date.now() + 6 * 60 * 60 * 1000,
        })
      : "";

    if (selected.length) {
      const { error: logError } = await admin.from("activity_events").insert({
        student_id: studentId,
        category: "practice",
        event_type: "self_practice_started",
        entity_type: null,
        entity_id: null,
        details: {
          session_id: sessionId,
          filters,
          question_count: selected.length,
        } as never,
      });
      if (logError) throw new Error(logError.message);
    }

    return {
      sessionId,
      token,
      filters,
      questions: selected.map(publicQuestion),
    };
  });

export const submitSelfPracticeAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        token: z.string().min(1).max(100_000),
        answer: answerInputSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const session = verifySelfPracticeToken(data.token, studentId);

    if (!session.questionIds.includes(data.answer.questionId)) {
      throw new Error("Question is not part of this practice session.");
    }

    const { data: row, error } = await admin
      .from("questions")
      .select(
        "id,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,current_version,context_kind,reading_question_set_id,listening_question_set_id",
      )
      .eq("id", data.answer.questionId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Question is no longer available.");

    const question = row as LoadedQuestion;
    const result = gradeLoadedQuestion(question, data.answer.response);

    const { error: logError } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type: "self_practice_answer",
      entity_type: "question",
      entity_id: question.id,
      is_correct: result.is_correct,
      response: data.answer.response as never,
      duration_ms: data.answer.duration_ms,
      details: {
        session_id: session.sessionId,
        score: result.score,
        max_score: result.max_score,
        question_version: question.current_version,
        question_type: question.question_type,
        needs_review: result.needs_review,
        filters: session.filters,
      } as never,
    });
    if (logError) throw new Error(logError.message);

    return {
      question_id: question.id,
      question_version: question.current_version,
      question_type: question.question_type,
      ...result,
      explanation: question.explanation,
      answer_key: question.answer_key,
    };
  });

export const finishSelfPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ token: z.string().min(1).max(100_000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const session = verifySelfPracticeToken(data.token, studentId);

    const { data: rows, error } = await admin
      .from("activity_events")
      .select("entity_id,is_correct,details,created_at")
      .eq("student_id", studentId)
      .eq("event_type", "self_practice_answer")
      .in("entity_id", session.questionIds)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const latest = new Map<string, { is_correct: boolean | null; details: Record<string, unknown> }>();
    for (const row of rows ?? []) {
      const details = row.details as Record<string, unknown>;
      if (details["session_id"] !== session.sessionId || !row.entity_id || latest.has(row.entity_id)) continue;
      latest.set(row.entity_id, {
        is_correct: row.is_correct,
        details,
      });
    }

    const answered = latest.size;
    const gradedRows = [...latest.values()].filter((entry) => typeof entry.details["score"] === "number");
    const score = gradedRows.reduce((sum, entry) => sum + Number(entry.details["score"] ?? 0), 0);
    const maxScore = gradedRows.reduce((sum, entry) => sum + Number(entry.details["max_score"] ?? 0), 0);

    const summary = {
      total: session.questionIds.length,
      answered,
      graded: gradedRows.length,
      correct: [...latest.values()].filter((entry) => entry.is_correct === true).length,
      score,
      max_score: maxScore,
      accuracy: maxScore > 0 ? score / maxScore : null,
    };

    const { error: logError } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type: "self_practice_finished",
      entity_type: null,
      entity_id: null,
      details: {
        session_id: session.sessionId,
        filters: session.filters,
        ...summary,
      } as never,
    });
    if (logError) throw new Error(logError.message);

    return summary;
  });

export const getStudentPracticeProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: recent, error } = await admin
      .from("activity_events")
      .select("id,event_type,entity_id,is_correct,duration_ms,details,created_at")
      .eq("student_id", studentId)
      .eq("category", "practice")
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const answerEvents = (recent ?? []).filter((row) =>
      ["practice_answer", "self_practice_answer"].includes(row.event_type),
    );
    const finished = (recent ?? []).filter((row) =>
      ["practice_finished", "self_practice_finished"].includes(row.event_type),
    );

    const todayAnswers = answerEvents.filter((row) => new Date(row.created_at) >= today);
    const totalDurationMs = answerEvents.reduce((sum, row) => sum + (row.duration_ms ?? 0), 0);
    const correct = answerEvents.filter((row) => row.is_correct === true).length;
    const autoGraded = answerEvents.filter((row) => row.is_correct !== null).length;

    const byQuestion = new Map<string, { attempts: number; correct: number; incorrect: number; last_at: string }>();
    for (const row of answerEvents) {
      if (!row.entity_id) continue;
      const entry = byQuestion.get(row.entity_id) ?? { attempts: 0, correct: 0, incorrect: 0, last_at: row.created_at };
      entry.attempts += 1;
      if (row.is_correct === true) entry.correct += 1;
      if (row.is_correct === false) entry.incorrect += 1;
      if (row.created_at > entry.last_at) entry.last_at = row.created_at;
      byQuestion.set(row.entity_id, entry);
    }

    const weakIds = [...byQuestion.entries()]
      .filter(([, value]) => value.incorrect > 0)
      .sort((a, b) => b[1].incorrect - a[1].incorrect || b[1].attempts - a[1].attempts)
      .slice(0, 10)
      .map(([id]) => id);

    const { data: weakQuestions, error: weakError } = weakIds.length
      ? await admin.from("questions").select("id,prompt,question_type,level").in("id", weakIds)
      : { data: [], error: null };
    if (weakError) throw new Error(weakError.message);
    const weakMap = new Map((weakQuestions ?? []).map((question) => [question.id, question]));

    const history = finished.slice(0, 30).map((row) => {
      const details = row.details as Record<string, unknown>;
      return {
        id: row.id,
        kind: row.event_type === "self_practice_finished" ? ("self" as const) : ("catalog" as const),
        at: row.created_at,
        answered: Number(details["answered"] ?? details["total"] ?? 0),
        score: typeof details["score"] === "number" ? details["score"] : null,
        max_score: typeof details["max_score"] === "number" ? details["max_score"] : null,
        accuracy: typeof details["accuracy"] === "number" ? details["accuracy"] : null,
        catalog_id: typeof details["catalog_id"] === "string" ? details["catalog_id"] : null,
      };
    });

    return {
      today: {
        answered: todayAnswers.length,
        correct: todayAnswers.filter((row) => row.is_correct === true).length,
        accuracy:
          todayAnswers.filter((row) => row.is_correct !== null).length > 0
            ? todayAnswers.filter((row) => row.is_correct === true).length /
              todayAnswers.filter((row) => row.is_correct !== null).length
            : null,
      },
      last30Days: {
        answered: answerEvents.length,
        correct,
        accuracy: autoGraded > 0 ? correct / autoGraded : null,
        study_time_ms: totalDurationMs,
        practices_finished: finished.length,
      },
      weakQuestions: weakIds
        .map((id) => {
          const q = weakMap.get(id);
          const stats = byQuestion.get(id)!;
          return q
            ? {
                id,
                prompt: q.prompt,
                question_type: q.question_type,
                level: q.level,
                attempts: stats.attempts,
                incorrect: stats.incorrect,
                correct: stats.correct,
                last_at: stats.last_at,
              }
            : null;
        })
        .filter(Boolean),
      history,
    };
  });
