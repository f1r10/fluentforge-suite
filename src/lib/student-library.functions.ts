import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TYPE_BY_ID } from "./question-types";

type Admin = Awaited<
  ReturnType<typeof import("./security.server")["adminClient"]>
>;

type LoadedQuestion = {
  id: string;
  question_type: string;
  prompt: string;
  instructions: string | null;
  payload: unknown;
  answer_key: unknown;
  scoring: unknown;
  grading_mode: string;
  current_version: number;
  learning_language?: string | null;
  level?: string | null;
  context_kind?: "none" | "reading" | "listening";
  reading_question_set_id?: string | null;
  listening_question_set_id?: string | null;
  context_sort?: number;
};

async function requireStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

function shuffle<T>(input: T[]) {
  const out = [...input];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [out[index], out[target]] = [out[target]!, out[index]!];
  }
  return out;
}

export function publicPracticeQuestion(question: LoadedQuestion) {
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
    payload["right_options"] = shuffle([
      ...new Set(pairs.map((pair) => pair.right)),
    ]);
  }

  if (def?.editor === "ordering") {
    const answer =
      question.answer_key && typeof question.answer_key === "object"
        ? (question.answer_key as Record<string, unknown>)
        : {};
    const order = Array.isArray(answer["order"])
      ? (answer["order"] as string[])
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
    learning_language: question.learning_language ?? null,
    level: question.level ?? null,
  };
}

export async function loadReadingPracticeData(
  admin: Admin,
  readingIds: string[],
) {
  const ids = [...new Set(readingIds)];
  if (!ids.length) return [];

  const { data: readings, error: readingError } = await admin
    .from("readings")
    .select(
      "id,title,body,learning_language,level,word_count,display_layout,status",
    )
    .in("id", ids)
    .eq("status", "active")
    .is("deleted_at", null);
  if (readingError) throw new Error(readingError.message);

  const allowedIds = (readings ?? []).map((row) => row.id);
  if (!allowedIds.length) return [];

  const { data: sets, error: setError } = await admin
    .from("reading_question_sets")
    .select("id,reading_id,title,instructions,sort_order")
    .in("reading_id", allowedIds)
    .order("sort_order");
  if (setError) throw new Error(setError.message);

  const setIds = (sets ?? []).map((row) => row.id);
  const questionResult = setIds.length
    ? await admin
        .from("questions")
        .select(
          "id,question_type,prompt,instructions,payload,answer_key,scoring,grading_mode,current_version,learning_language,level,reading_question_set_id,context_sort",
        )
        .in("reading_question_set_id", setIds)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("context_sort")
    : { data: [], error: null };
  if (questionResult.error) {
    throw new Error(questionResult.error.message);
  }

  const { hydrateQuestionMedia } = await import("./media.server");
  const hydrated = await hydrateQuestionMedia(
    admin,
    (questionResult.data ?? []) as unknown as LoadedQuestion[],
    60 * 60,
  );

  const questionsBySet = new Map<
    string,
    ReturnType<typeof publicPracticeQuestion>[]
  >();
  for (const question of hydrated) {
    if (!question.reading_question_set_id) continue;
    const list =
      questionsBySet.get(question.reading_question_set_id) ?? [];
    list.push(publicPracticeQuestion(question));
    questionsBySet.set(question.reading_question_set_id, list);
  }

  const setsByReading = new Map<string, Array<Record<string, unknown>>>();
  for (const set of sets ?? []) {
    const list = setsByReading.get(set.reading_id) ?? [];
    list.push({
      id: set.id,
      title: set.title,
      instructions: set.instructions,
      sort_order: set.sort_order,
      questions: questionsBySet.get(set.id) ?? [],
    });
    setsByReading.set(set.reading_id, list);
  }

  const byId = new Map((readings ?? []).map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        title: row.title,
        body: row.body,
        learning_language: row.learning_language,
        level: row.level,
        word_count: row.word_count,
        display_layout: row.display_layout,
        question_sets: setsByReading.get(row.id) ?? [],
      },
    ];
  });
}

export async function loadListeningPracticeData(
  admin: Admin,
  listeningIds: string[],
) {
  const ids = [...new Set(listeningIds)];
  if (!ids.length) return [];

  const { data: listenings, error: listeningError } = await admin
    .from("listenings")
    .select(
      "id,title,media_id,transcript,learning_language,level,playback_rules,status",
    )
    .in("id", ids)
    .eq("status", "active")
    .is("deleted_at", null);
  if (listeningError) throw new Error(listeningError.message);

  const allowedIds = (listenings ?? []).map((row) => row.id);
  if (!allowedIds.length) return [];

  const [sectionsResult, setsResult] = await Promise.all([
    admin
      .from("listening_sections")
      .select(
        "id,listening_id,title,start_seconds,end_seconds,sort_order",
      )
      .in("listening_id", allowedIds)
      .order("sort_order"),
    admin
      .from("listening_question_sets")
      .select(
        "id,listening_id,section_id,title,instructions,sort_order",
      )
      .in("listening_id", allowedIds)
      .order("sort_order"),
  ]);
  if (sectionsResult.error) throw new Error(sectionsResult.error.message);
  if (setsResult.error) throw new Error(setsResult.error.message);

  const setIds = (setsResult.data ?? []).map((row) => row.id);
  const questionResult = setIds.length
    ? await admin
        .from("questions")
        .select(
          "id,question_type,prompt,instructions,payload,answer_key,scoring,grading_mode,current_version,learning_language,level,listening_question_set_id,context_sort",
        )
        .in("listening_question_set_id", setIds)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("context_sort")
    : { data: [], error: null };
  if (questionResult.error) {
    throw new Error(questionResult.error.message);
  }

  const mediaIds = (listenings ?? [])
    .map((row) => row.media_id)
    .filter((value): value is string => !!value);
  const mediaResult = mediaIds.length
    ? await admin
        .from("media_assets")
        .select(
          "id,kind,storage_path,external_url,mime_type,duration_seconds",
        )
        .in("id", mediaIds)
        .is("deleted_at", null)
    : { data: [], error: null };
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  const { hydrateQuestionMedia, resolveMediaUrl } = await import(
    "./media.server"
  );
  const hydrated = await hydrateQuestionMedia(
    admin,
    (questionResult.data ?? []) as unknown as LoadedQuestion[],
    60 * 60,
  );

  const questionsBySet = new Map<
    string,
    ReturnType<typeof publicPracticeQuestion>[]
  >();
  for (const question of hydrated) {
    if (!question.listening_question_set_id) continue;
    const list =
      questionsBySet.get(question.listening_question_set_id) ?? [];
    list.push(publicPracticeQuestion(question));
    questionsBySet.set(question.listening_question_set_id, list);
  }

  const sectionsByListening = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  for (const section of sectionsResult.data ?? []) {
    const list = sectionsByListening.get(section.listening_id) ?? [];
    list.push({
      id: section.id,
      title: section.title,
      start_seconds: section.start_seconds,
      end_seconds: section.end_seconds,
      sort_order: section.sort_order,
    });
    sectionsByListening.set(section.listening_id, list);
  }

  const setsByListening = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  for (const set of setsResult.data ?? []) {
    const list = setsByListening.get(set.listening_id) ?? [];
    list.push({
      id: set.id,
      section_id: set.section_id,
      title: set.title,
      instructions: set.instructions,
      sort_order: set.sort_order,
      questions: questionsBySet.get(set.id) ?? [],
    });
    setsByListening.set(set.listening_id, list);
  }

  const resolvedMedia = await Promise.all(
    (mediaResult.data ?? []).map(async (asset) => ({
      ...asset,
      external_url: await resolveMediaUrl(admin, asset, 60 * 60),
    })),
  );
  const mediaById = new Map(
    resolvedMedia.map((asset) => [asset.id, asset]),
  );
  const byId = new Map((listenings ?? []).map((row) => [row.id, row]));

  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];

    const rules =
      row.playback_rules && typeof row.playback_rules === "object"
        ? (row.playback_rules as Record<string, unknown>)
        : {};
    const media = row.media_id ? mediaById.get(row.media_id) ?? null : null;

    return [
      {
        id: row.id,
        title: row.title,
        learning_language: row.learning_language,
        level: row.level,
        transcript:
          rules["show_transcript"] === true ? row.transcript : null,
        playback_rules: {
          max_plays:
            typeof rules["max_plays"] === "number" &&
            rules["max_plays"] > 0
              ? Math.floor(rules["max_plays"])
              : null,
          allow_pause: rules["allow_pause"] !== false,
          allow_seek: rules["allow_seek"] !== false,
          allow_rewind: rules["allow_rewind"] !== false,
          show_transcript: rules["show_transcript"] === true,
          dictation_enabled: rules["dictation_enabled"] === true && rules["show_transcript"] !== true,
          dictation_ignore_punctuation: rules["dictation_ignore_punctuation"] !== false,
          dictation_show_feedback: rules["dictation_show_feedback"] !== false,
        },
        media: media
          ? {
              id: media.id,
              kind: media.kind,
              external_url: media.external_url,
              mime_type: media.mime_type,
              duration_seconds: media.duration_seconds,
            }
          : null,
        sections: sectionsByListening.get(row.id) ?? [],
        question_sets: setsByListening.get(row.id) ?? [],
      },
    ];
  });
}

const browseSchema = z.object({
  search: z.string().max(200).default(""),
  language: z.string().max(10).default(""),
  level: z.string().max(20).default(""),
  page: z.number().int().min(0).default(0),
});

export const listStudentQuestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    browseSchema
      .extend({
        type: z.string().max(60).default(""),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const pageSize = 40;

    let query = admin
      .from("questions")
      .select(
        "id,question_type,prompt,learning_language,level,difficulty,updated_at",
        { count: "exact" },
      )
      .eq("status", "active")
      .eq("context_kind", "none")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.type) query = query.eq("question_type", data.type);
    if (data.language) {
      query = query.eq("learning_language", data.language);
    }
    if (data.level) query = query.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("prompt", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, pageSize };
  });

export const getStudentQuestionPractice = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: row, error } = await admin
      .from("questions")
      .select(
        "id,question_type,prompt,instructions,payload,answer_key,scoring,grading_mode,current_version,learning_language,level",
      )
      .eq("id", data.id)
      .eq("status", "active")
      .eq("context_kind", "none")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Question is not available.");

    const { hydrateQuestionMedia } = await import("./media.server");
    const [hydrated] = await hydrateQuestionMedia(
      admin,
      [row as unknown as LoadedQuestion],
      60 * 60,
    );
    if (!hydrated) throw new Error("Question is not available.");
    return publicPracticeQuestion(hydrated);
  });

export const listStudentReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => browseSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const pageSize = 30;

    let query = admin
      .from("readings")
      .select(
        "id,title,learning_language,level,word_count,display_layout,updated_at,reading_question_sets(count)",
        { count: "exact" },
      )
      .eq("status", "active")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.language) {
      query = query.eq("learning_language", data.language);
    }
    if (data.level) query = query.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("title", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((row) => ({
        ...row,
        question_sets:
          (
            row.reading_question_sets as unknown as Array<{
              count: number;
            }>
          )[0]?.count ?? 0,
      })),
      total: count ?? 0,
      pageSize,
    };
  });

export const getStudentReadingPractice = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const [reading] = await loadReadingPracticeData(admin, [data.id]);
    if (!reading) throw new Error("Reading is not available.");
    return reading;
  });

export const listStudentListenings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => browseSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const pageSize = 30;

    let query = admin
      .from("listenings")
      .select(
        "id,title,learning_language,level,media_id,updated_at,listening_sections(count),listening_question_sets(count)",
        { count: "exact" },
      )
      .eq("status", "active")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.language) {
      query = query.eq("learning_language", data.language);
    }
    if (data.level) query = query.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("title", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((row) => ({
        ...row,
        sections:
          (
            row.listening_sections as unknown as Array<{
              count: number;
            }>
          )[0]?.count ?? 0,
        question_sets:
          (
            row.listening_question_sets as unknown as Array<{
              count: number;
            }>
          )[0]?.count ?? 0,
      })),
      total: count ?? 0,
      pageSize,
    };
  });

export const getStudentListeningPractice = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const [listening] = await loadListeningPracticeData(admin, [data.id]);
    if (!listening) throw new Error("Listening is not available.");
    return listening;
  });


export const listStudentVocabulary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => browseSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const studentId = await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const pageSize = 40;

    let query = admin
      .from("vocabulary_entries")
      .select(
        "id,word,definition,ipa,part_of_speech,learning_language,level,vocabulary_translations(language,value),vocabulary_examples(sentence,translation,sort_order)",
        { count: "exact" },
      )
      .eq("status", "active")
      .is("deleted_at", null)
      .order("word")
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.language) {
      query = query.eq("learning_language", data.language);
    }
    if (data.level) query = query.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("word", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((row) => row.id);
    const stateResult = ids.length
      ? await admin
          .from("student_vocabulary_state")
          .select(
            "entry_id,state,correct_count,incorrect_count,correct_streak,last_result,last_mode,last_practiced_at",
          )
          .eq("student_id", studentId)
          .in("entry_id", ids)
      : { data: [], error: null };
    if (stateResult.error) throw new Error(stateResult.error.message);

    const states = new Map(
      (stateResult.data ?? []).map((row) => [row.entry_id, row]),
    );

    return {
      rows: (rows ?? []).map((entry) => ({
        id: entry.id,
        word: entry.word,
        definition: entry.definition,
        ipa: entry.ipa,
        part_of_speech: entry.part_of_speech,
        learning_language: entry.learning_language,
        level: entry.level,
        translations: (entry.vocabulary_translations ?? []) as Array<{
          language: string;
          value: string;
        }>,
        examples: (
          (entry.vocabulary_examples ?? []) as Array<{
            sentence: string;
            translation: string | null;
            sort_order: number;
          }>
        )
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((row) => ({
            sentence: row.sentence,
            translation: row.translation,
          })),
        learner_state: states.get(entry.id) ?? {
          state: "new" as const,
          correct_count: 0,
          incorrect_count: 0,
          correct_streak: 0,
          last_result: null,
          last_mode: null,
          last_practiced_at: null,
        },
      })),
      total: count ?? 0,
      pageSize,
    };
  });
