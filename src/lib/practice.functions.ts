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
import { TYPE_BY_ID } from "./question-types";
import {
  acceptedVocabularyAnswers,
  gradeVocabularyResponse,
  initialVocabularyState,
  nextVocabularyState,
  type VocabularyPracticeMode,
} from "./vocabulary-practice";

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

const vocabularyPracticeModeSchema = z.enum([
  "flashcard",
  "translation_recall",
  "reverse_recall",
  "multiple_choice",
]);

const vocabularyPracticeInputSchema = z.object({
  catalogId: z.string().uuid(),
  sessionId: z.string().uuid(),
  entryId: z.string().uuid(),
  mode: vocabularyPracticeModeSchema,
  response: z.string().max(5_000).default(""),
  targetLanguage: z.string().max(10).nullable().default(null),
  rating: z.enum(["known", "learning"]).nullable().default(null),
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

    const vocabularyStateResult = vocabularyIds.length
      ? await admin
          .from("student_vocabulary_state")
          .select(
            "entry_id,state,correct_count,incorrect_count,correct_streak,last_result,last_mode,last_practiced_at",
          )
          .eq("student_id", studentId)
          .in("entry_id", vocabularyIds)
      : { data: [], error: null };
    if (vocabularyStateResult.error) {
      throw new Error(vocabularyStateResult.error.message);
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
          .select("id,kind,storage_path,external_url,mime_type,duration_seconds")
          .in("id", listeningMediaIds)
          .is("deleted_at", null)
      : { data: [], error: null };
    if (mediaResult.error) throw new Error(mediaResult.error.message);

    const { hydrateQuestionMedia, resolveMediaUrl } = await import("./media.server");
    const [directQuestionRows, readingQuestionRows, listeningQuestionRows] = await Promise.all([
      hydrateQuestionMedia(
        admin,
        (directQuestionsResult.data ?? []) as unknown as LoadedQuestion[],
        60 * 60,
      ),
      hydrateQuestionMedia(
        admin,
        (readingQuestionsResult.data ?? []) as unknown as LoadedQuestion[],
        60 * 60,
      ),
      hydrateQuestionMedia(
        admin,
        (listeningQuestionsResult.data ?? []) as unknown as LoadedQuestion[],
        60 * 60,
      ),
    ]);

    const directQuestions = new Map(
      directQuestionRows.map((question) => [
        question.id,
        publicQuestion(question),
      ]),
    );
    const vocabulary = new Map((vocabularyResult.data ?? []).map((entry) => [entry.id, entry]));
    const vocabularyState = new Map(
      (vocabularyStateResult.data ?? []).map((row) => [row.entry_id, row]),
    );
    const readings = new Map((readingsResult.data ?? []).map((reading) => [reading.id, reading]));
    const listenings = new Map((listeningsResult.data ?? []).map((listening) => [listening.id, listening]));
    const resolvedMedia = await Promise.all(
      (mediaResult.data ?? []).map(async (asset) => ({
        ...asset,
        external_url: await resolveMediaUrl(admin as never, asset, 60 * 60),
      })),
    );
    const media = new Map(resolvedMedia.map((asset) => [asset.id, asset]));

    const readingQuestionsBySet = new Map<string, ReturnType<typeof publicQuestion>[]>();
    for (const question of readingQuestionRows) {
      if (!question.reading_question_set_id) continue;
      const list = readingQuestionsBySet.get(question.reading_question_set_id) ?? [];
      list.push(publicQuestion(question));
      readingQuestionsBySet.set(question.reading_question_set_id, list);
    }

    const listeningQuestionsBySet = new Map<string, ReturnType<typeof publicQuestion>[]>();
    for (const question of listeningQuestionRows) {
      if (!question.listening_question_set_id) continue;
      const list = listeningQuestionsBySet.get(question.listening_question_set_id) ?? [];
      list.push(publicQuestion(question));
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
              learner_state: vocabularyState.get(entry.id) ?? {
                state: "new",
                correct_count: 0,
                incorrect_count: 0,
                correct_streak: 0,
                last_result: null,
                last_mode: null,
                last_practiced_at: null,
              },
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

export const submitVocabularyPracticeAnswer = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => vocabularyPracticeInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    await accessibleCatalog(admin, studentId, data.catalogId);

    const { data: catalogItem, error: itemError } = await admin
      .from("catalog_items")
      .select("id")
      .eq("catalog_id", data.catalogId)
      .eq("entity_type", "vocabulary")
      .eq("entity_id", data.entryId)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!catalogItem) {
      throw new Error("This vocabulary entry is not available in the catalog.");
    }

    const { data: entry, error: entryError } = await admin
      .from("vocabulary_entries")
      .select("id,word,vocabulary_translations(language,value)")
      .eq("id", data.entryId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (entryError) throw new Error(entryError.message);
    if (!entry) throw new Error("Vocabulary entry is not available.");

    const translations = (entry.vocabulary_translations ?? []) as Array<{
      language: string;
      value: string;
    }>;
    const target =
      (data.targetLanguage
        ? translations.find(
            (translation) =>
              translation.language.toLowerCase() ===
              data.targetLanguage!.toLowerCase(),
          )
        : null) ??
      translations[0] ??
      null;

    let correct: boolean | null = null;
    let expected: string[] = [];
    const effectiveTargetLanguage = target?.language ?? null;

    if (data.mode === "flashcard") {
      if (!data.rating) {
        throw new Error("Choose whether this word is known or still learning.");
      }
    } else if (data.mode === "reverse_recall") {
      if (!target) {
        throw new Error("This vocabulary entry has no translation for reverse recall.");
      }
      expected = [entry.word];
      correct = gradeVocabularyResponse(data.response, expected).correct;
    } else {
      if (!target) {
        throw new Error("This vocabulary entry has no translation to practice.");
      }
      expected = acceptedVocabularyAnswers([target.value]);
      correct = gradeVocabularyResponse(data.response, expected).correct;
    }

    const { data: existing, error: stateError } = await admin
      .from("student_vocabulary_state")
      .select("state,correct_count,incorrect_count,correct_streak")
      .eq("student_id", studentId)
      .eq("entry_id", entry.id)
      .maybeSingle();
    if (stateError) throw new Error(stateError.message);

    const current = existing
      ? {
          state: existing.state as "new" | "learning" | "known",
          correct_count: existing.correct_count,
          incorrect_count: existing.incorrect_count,
          correct_streak: existing.correct_streak,
        }
      : initialVocabularyState();

    const next =
      data.mode === "flashcard"
        ? nextVocabularyState(current, {
            kind: "rating",
            rating: data.rating!,
          })
        : nextVocabularyState(current, {
            kind: "answer",
            correct: correct === true,
          });

    const practicedAt = new Date().toISOString();
    const { error: upsertError } = await admin
      .from("student_vocabulary_state")
      .upsert(
        {
          student_id: studentId,
          entry_id: entry.id,
          state: next.state,
          correct_count: next.correct_count,
          incorrect_count: next.incorrect_count,
          correct_streak: next.correct_streak,
          last_result: correct,
          last_mode: data.mode,
          last_practiced_at: practicedAt,
          updated_at: practicedAt,
        },
        { onConflict: "student_id,entry_id" },
      );
    if (upsertError) throw new Error(upsertError.message);

    const { error: activityError } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type:
        data.mode === "flashcard"
          ? "vocabulary_rating"
          : "vocabulary_answer",
      entity_type: "vocabulary",
      entity_id: entry.id,
      is_correct: correct,
      response: {
        value: data.response || null,
        rating: data.rating,
        target_language: effectiveTargetLanguage,
      } as never,
      duration_ms: data.duration_ms,
      details: {
        catalog_id: data.catalogId,
        session_id: data.sessionId,
        mode: data.mode satisfies VocabularyPracticeMode,
        target_language: effectiveTargetLanguage,
        expected,
        learner_state: next.state,
        correct_streak: next.correct_streak,
      } as never,
    });
    if (activityError) throw new Error(activityError.message);

    return {
      entryId: entry.id,
      mode: data.mode,
      correct,
      expected,
      targetLanguage: effectiveTargetLanguage,
      learner_state: {
        ...next,
        last_result: correct,
        last_mode: data.mode,
        last_practiced_at: practicedAt,
      },
    };
  });

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
