import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DueReviewItem = {
  id: string;
  kind: "question" | "vocabulary";
  title: string;
  level: string | null;
  dueAt: string;
  context: { kind: "reading" | "listening"; id: string } | null;
  vocabulary: {
    id: string;
    word: string;
    definition: string | null;
    ipa: string | null;
    part_of_speech: string | null;
    learning_language: string | null;
    level: string | null;
    translations: Array<{ language: string; value: string }>;
    examples: Array<{ sentence: string; translation: string | null }>;
    learner_state: {
      state: "new" | "learning" | "known";
      correct_count: number;
      incorrect_count: number;
      correct_streak: number;
      last_result: boolean | null;
      last_mode: string | null;
      last_practiced_at: string | null;
    };
  } | null;
};

export const getMyDueReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: studentId, error: studentError } = await context.supabase.rpc("current_student_id");
    if (studentError || !studentId) throw new Error("Forbidden");
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: schedules, error: schedulesError } = await admin
      .from("student_review_schedules")
      .select("entity_id,entity_type,due_at")
      .eq("student_id", studentId)
      .lte("due_at", new Date().toISOString())
      .order("due_at")
      .limit(50);
    if (schedulesError) throw new Error(schedulesError.message);
    if (!schedules?.length) return { count: 0, items: [] as DueReviewItem[] };

    const wordIds = schedules.filter((x) => x.entity_type === "vocabulary").map((x) => x.entity_id);
    const questionIds = schedules.filter((x) => x.entity_type === "question").map((x) => x.entity_id);
    const [wordResult, questionResult, stateResult] = await Promise.all([
      wordIds.length
        ? admin.from("vocabulary_entries")
            .select("id,word,definition,ipa,part_of_speech,learning_language,level,vocabulary_translations(language,value),vocabulary_examples(sentence,translation)")
            .in("id", wordIds).eq("status", "active").is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      questionIds.length
        ? admin.from("questions")
            .select("id,prompt,level,context_kind,reading_question_set_id,listening_question_set_id")
            .in("id", questionIds).eq("status", "active").is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      wordIds.length
        ? admin.from("student_vocabulary_state")
            .select("entry_id,state,correct_count,incorrect_count,correct_streak,last_result,last_mode,last_practiced_at")
            .eq("student_id", studentId).in("entry_id", wordIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [wordResult, questionResult, stateResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    const questions = questionResult.data ?? [];
    const rsetIds = questions.map((x) => x.reading_question_set_id).filter((id): id is string => !!id);
    const lsetIds = questions.map((x) => x.listening_question_set_id).filter((id): id is string => !!id);
    const [rsets, lsets] = await Promise.all([
      rsetIds.length
        ? admin.from("reading_question_sets").select("id,reading_id").in("id", rsetIds)
        : Promise.resolve({ data: [], error: null }),
      lsetIds.length
        ? admin.from("listening_question_sets").select("id,listening_id").in("id", lsetIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (rsets.error) throw new Error(rsets.error.message);
    if (lsets.error) throw new Error(lsets.error.message);
    const readMap = new Map((rsets.data ?? []).map((x) => [x.id, x.reading_id]));
    const listenMap = new Map((lsets.data ?? []).map((x) => [x.id, x.listening_id]));
    const [readings, listenings] = await Promise.all([
      readMap.size
        ? admin.from("readings").select("id").in("id", [...new Set(readMap.values())]).eq("status", "active").is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      listenMap.size
        ? admin.from("listenings").select("id").in("id", [...new Set(listenMap.values())]).eq("status", "active").is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (readings.error) throw new Error(readings.error.message);
    if (listenings.error) throw new Error(listenings.error.message);
    const visibleReadings = new Set((readings.data ?? []).map((x) => x.id));
    const visibleListenings = new Set((listenings.data ?? []).map((x) => x.id));
    const words = new Map((wordResult.data ?? []).map((x) => [x.id, x]));
    const questionsById = new Map(questions.map((x) => [x.id, x]));
    const states = new Map((stateResult.data ?? []).map((x) => [x.entry_id, x]));
    const items: DueReviewItem[] = [];
    for (const row of schedules) {
      if (row.entity_type === "vocabulary") {
        const word = words.get(row.entity_id);
        if (!word) continue;
        const learner = states.get(word.id);
        items.push({
          id: word.id, kind: "vocabulary", title: word.word,
          level: word.level, dueAt: row.due_at, context: null,
          vocabulary: {
            id: word.id, word: word.word, definition: word.definition,
            ipa: word.ipa, part_of_speech: word.part_of_speech,
            learning_language: word.learning_language, level: word.level,
            translations: word.vocabulary_translations ?? [],
            examples: word.vocabulary_examples ?? [],
            learner_state: {
              state: (learner?.state as "new" | "learning" | "known") ?? "new",
              correct_count: learner?.correct_count ?? 0,
              incorrect_count: learner?.incorrect_count ?? 0,
              correct_streak: learner?.correct_streak ?? 0,
              last_result: learner?.last_result ?? null,
              last_mode: learner?.last_mode ?? null,
              last_practiced_at: learner?.last_practiced_at ?? null,
            },
          },
        });
      } else {
        const question = questionsById.get(row.entity_id);
        if (!question) continue;
        let context: DueReviewItem["context"] = null;
        if (question.context_kind === "reading") {
          const id = readMap.get(question.reading_question_set_id ?? "");
          if (!id || !visibleReadings.has(id)) continue;
          context = { kind: "reading", id };
        }
        if (question.context_kind === "listening") {
          const id = listenMap.get(question.listening_question_set_id ?? "");
          if (!id || !visibleListenings.has(id)) continue;
          context = { kind: "listening", id };
        }
        items.push({
          id: question.id, kind: "question", title: question.prompt,
          level: question.level, dueAt: row.due_at, context, vocabulary: null,
        });
      }
      if (items.length === 20) break;
    }
    return { count: items.length, items };
  });
