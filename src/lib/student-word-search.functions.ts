import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gradeVocabularyResponse } from "./vocabulary-practice";

const translationSchema = z.object({
  language: z.string().trim().min(2).max(10),
  value: z.string().trim().min(1).max(2_000),
});

const exampleSchema = z.object({
  sentence: z.string().trim().min(1).max(5_000),
  translation: z.string().max(5_000).nullable().default(null),
});

const pronunciationSchema = z.object({
  ipa: z.string().max(500).nullable().default(null),
  audio: z.string().url().nullable().default(null),
  region: z.string().max(80).nullable().default(null),
  tags: z.array(z.string().max(120)).max(20).default([]),
});

const formSchema = z.object({
  form: z.string().trim().min(1).max(500),
  tags: z.array(z.string().max(120)).max(20).default([]),
});

const sourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.string().url().nullable().default(null),
    license: z.string().max(120).nullable().default(null),
  })
  .nullable()
  .default(null);

const levelEstimateSchema = z
  .object({
    source: z.string().trim().min(1).max(120),
    confidence: z.number().finite().min(0).max(1),
    frequency_per_million: z.number().finite().min(0).nullable().default(null),
  })
  .nullable()
  .default(null);

const lookupResultSchema = z.object({
  word: z.string().trim().min(1).max(500),
  learning_language: z.string().trim().min(2).max(10),
  definition: z.string().max(10_000).nullable().default(null),
  ipa: z.string().max(500).nullable().default(null),
  part_of_speech: z.string().max(100).nullable().default(null),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).nullable().default(null),
  translations: z.array(translationSchema).max(50).default([]),
  synonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  antonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  examples: z.array(exampleSchema).max(50).default([]),
  pronunciations: z.array(pronunciationSchema).max(30).default([]),
  forms: z.array(formSchema).max(100).default([]),
  source: sourceSchema,
  level_estimate: levelEstimateSchema,
  provider: z.string().trim().max(80).nullable().default(null),
  model: z.string().trim().max(200).nullable().default(null),
  generated_at: z.string().max(100).nullable().default(null),
});

export type StudentWordLookupResult = z.infer<typeof lookupResultSchema> & {
  saved: boolean;
  savedId: string | null;
};

async function currentStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[], max = 100) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= max) break;
  }
  return result;
}

function mergeTranslations(
  preferred: Array<{ language: string; value: string }>,
  fallback: Array<{ language: string; value: string }>,
) {
  const map = new Map<string, { language: string; value: string }>();
  for (const item of [...preferred, ...fallback]) {
    const language = item.language.trim().toLowerCase();
    const value = item.value.trim();
    if (!language || !value || map.has(language)) continue;
    map.set(language, { language, value });
  }
  return [...map.values()];
}

function mergeExamples(
  preferred: Array<{ sentence: string; translation: string | null }>,
  fallback: Array<{ sentence: string; translation: string | null }>,
) {
  const map = new Map<string, { sentence: string; translation: string | null }>();
  for (const item of [...preferred, ...fallback]) {
    const sentence = item.sentence.trim();
    if (!sentence) continue;
    const key = sentence.toLocaleLowerCase();
    if (!map.has(key)) map.set(key, { ...item, sentence });
  }
  return [...map.values()].slice(0, 50);
}

export const lookupStudentWord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        word: z.string().trim().min(1).max(500),
        learningLanguage: z.string().trim().min(2).max(10).default("en"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const { fetchBestDictionaryVocabularySuggestion } = await import(
      "./dictionary-vocabulary"
    );
    const admin = await adminClient();
    const word = data.word.trim();
    const learningLanguage = data.learningLanguage.toLowerCase();

    const [languagesResult, teacherResult, savedResult] = await Promise.all([
      admin
        .from("languages")
        .select("code")
        .eq("is_translation", true)
        .order("sort_order"),
      admin
        .from("vocabulary_entries")
        .select(
          "id,word,definition,ipa,part_of_speech,level,synonyms,antonyms,provenance,vocabulary_translations(language,value),vocabulary_examples(sentence,translation,sort_order)",
        )
        .eq("learning_language", learningLanguage)
        .ilike("word", word)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
      admin
        .from("student_personal_vocabulary")
        .select("id")
        .eq("student_id", studentId)
        .eq("learning_language", learningLanguage)
        .ilike("word", word)
        .limit(1)
        .maybeSingle(),
    ]);
    if (languagesResult.error) throw new Error(languagesResult.error.message);
    if (teacherResult.error) throw new Error(teacherResult.error.message);
    if (savedResult.error) throw new Error(savedResult.error.message);

    const targets = (languagesResult.data ?? [])
      .map((row) => String(row.code).toLowerCase())
      .filter((code) => code !== learningLanguage);

    let dictionary = null;
    let dictionaryError: unknown = null;
    try {
      dictionary = await fetchBestDictionaryVocabularySuggestion(word, {
        language: learningLanguage,
        targetLanguages: targets,
      });
    } catch (error) {
      dictionaryError = error;
    }

    const teacher = teacherResult.data;
    if (!dictionary && !teacher) {
      throw dictionaryError instanceof Error
        ? dictionaryError
        : new Error("No dictionary entry was found for this word.");
    }

    const teacherTranslations = teacher
      ? ((teacher.vocabulary_translations ?? []) as Array<{
          language: string;
          value: string;
        }>)
      : [];
    const teacherExamples = teacher
      ? ((teacher.vocabulary_examples ?? []) as Array<{
          sentence: string;
          translation: string | null;
          sort_order: number;
        }>)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(({ sentence, translation }) => ({ sentence, translation }))
      : [];
    const provenance = teacher ? jsonObject(teacher.provenance) : {};
    const lexical = jsonObject(provenance["dictionary"]);
    const teacherPronunciations = Array.isArray(lexical["pronunciations"])
      ? lexical["pronunciations"]
      : [];
    const teacherForms = Array.isArray(lexical["forms"])
      ? lexical["forms"]
      : [];

    const base = {
      word: teacher?.word ?? word,
      learning_language: learningLanguage,
      definition: teacher?.definition ?? dictionary?.definition ?? null,
      ipa: teacher?.ipa ?? dictionary?.ipa ?? null,
      part_of_speech:
        teacher?.part_of_speech ?? dictionary?.part_of_speech ?? null,
      level: (teacher?.level ?? dictionary?.level ?? null) as
        | "A1"
        | "A2"
        | "B1"
        | "B2"
        | "C1"
        | "C2"
        | null,
      translations: mergeTranslations(
        teacherTranslations,
        dictionary?.translations ?? [],
      ),
      synonyms: uniqueStrings([
        ...(teacher?.synonyms ?? []),
        ...(dictionary?.synonyms ?? []),
      ]),
      antonyms: uniqueStrings([
        ...(teacher?.antonyms ?? []),
        ...(dictionary?.antonyms ?? []),
      ]),
      examples: mergeExamples(
        teacherExamples,
        dictionary?.examples ?? [],
      ),
      pronunciations:
        teacherPronunciations.length > 0
          ? teacherPronunciations
          : dictionary?.pronunciations ?? [],
      forms:
        teacherForms.length > 0
          ? teacherForms
          : dictionary?.forms ?? [],
      source:
        dictionary?.source ??
        (lexical["source"] && typeof lexical["source"] === "object"
          ? lexical["source"]
          : teacher
            ? {
                name: "Teacher vocabulary bank",
                url: null,
                license: null,
              }
            : null),
      level_estimate:
        dictionary?.level_estimate ??
        (lexical["level_estimate"] &&
        typeof lexical["level_estimate"] === "object"
          ? lexical["level_estimate"]
          : null),
      provider:
        teacher && dictionary
          ? `teacher+${dictionary.provider}`
          : dictionary?.provider ?? (teacher ? "teacher" : null),
      model: dictionary?.model ?? null,
      generated_at: dictionary?.generated_at ?? new Date().toISOString(),
    };

    const parsed = lookupResultSchema.parse(base);
    return {
      ...parsed,
      saved: !!savedResult.data,
      savedId: savedResult.data?.id ?? null,
    } satisfies StudentWordLookupResult;
  });

export const listStudentPersonalWords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        language: z.string().max(10).default(""),
        level: z.string().max(20).default(""),
        partOfSpeech: z.string().max(100).default(""),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const pageSize = 50;

    let query = admin
      .from("student_personal_vocabulary")
      .select(
        "id,word,learning_language,definition,ipa,part_of_speech,level,translations,synonyms,antonyms,examples,lexical_metadata,source,created_at,updated_at",
        { count: "exact" },
      )
      .eq("student_id", studentId)
      .order("updated_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("word", `%${safe}%`);
    }
    if (data.language) {
      query = query.eq("learning_language", data.language);
    }
    if (data.level) {
      query = query.eq("level", data.level);
    }
    if (data.partOfSpeech) {
      query = query.eq("part_of_speech", data.partOfSpeech);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((row) => ({
        ...row,
        translations: Array.isArray(row.translations) ? row.translations : [],
        examples: Array.isArray(row.examples) ? row.examples : [],
        lexical_metadata: jsonObject(row.lexical_metadata),
      })),
      total: count ?? 0,
      pageSize,
    };
  });

export const saveStudentPersonalWord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => lookupResultSchema.parse(d))
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await admin
      .from("student_personal_vocabulary")
      .select("id")
      .eq("student_id", studentId)
      .eq("learning_language", data.learning_language)
      .ilike("word", data.word)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const row = {
      student_id: studentId,
      word: data.word,
      learning_language: data.learning_language,
      definition: data.definition,
      ipa: data.ipa,
      part_of_speech: data.part_of_speech,
      level: data.level,
      translations: data.translations as never,
      synonyms: data.synonyms,
      antonyms: data.antonyms,
      examples: data.examples as never,
      lexical_metadata: {
        pronunciations: data.pronunciations,
        forms: data.forms,
        source: data.source,
        level_estimate: data.level_estimate,
        provider: data.provider,
        model: data.model,
        generated_at: data.generated_at,
      } as never,
      source: data.provider ?? "dictionary",
      updated_at: now,
    };

    if (existing) {
      const { error } = await admin
        .from("student_personal_vocabulary")
        .update(row)
        .eq("id", existing.id)
        .eq("student_id", studentId);
      if (error) throw new Error(error.message);
      return { id: existing.id, created: false };
    }

    const { data: created, error } = await admin
      .from("student_personal_vocabulary")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(error?.message ?? "Could not save word to your dictionary.");
    }
    return { id: created.id, created: true };
  });

export const submitStudentPersonalWordPractice = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum([
          "translation_recall",
          "reverse_recall",
          "multiple_choice",
        ]),
        response: z.string().max(10_000),
        targetLanguage: z.string().trim().min(2).max(10).nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: row, error } = await admin
      .from("student_personal_vocabulary")
      .select("id,word,learning_language,translations")
      .eq("id", data.id)
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Saved word was not found.");

    const translations = Array.isArray(row.translations)
      ? (row.translations as Array<Record<string, unknown>>)
          .flatMap((item) => {
            const language =
              typeof item["language"] === "string" ? item["language"] : "";
            const value =
              typeof item["value"] === "string" ? item["value"] : "";
            return language && value ? [{ language, value }] : [];
          })
      : [];

    const expected =
      data.mode === "reverse_recall"
        ? [row.word]
        : translations
            .filter(
              (item) =>
                !data.targetLanguage ||
                item.language.toLowerCase() ===
                  data.targetLanguage.toLowerCase(),
            )
            .map((item) => item.value);

    const fallbackExpected =
      expected.length > 0
        ? expected
        : translations.map((item) => item.value);
    if (!fallbackExpected.length) {
      throw new Error("This saved word has no translation to practice.");
    }

    const graded = gradeVocabularyResponse(
      data.response,
      fallbackExpected,
    );

    const { error: activityError } = await admin
      .from("activity_events")
      .insert({
        student_id: studentId,
        category: "practice",
        event_type: "personal_vocabulary_practice",
        entity_type: "personal_vocabulary",
        entity_id: row.id,
        is_correct: graded.correct,
        response: { text: data.response } as never,
        details: {
          mode: data.mode,
          target_language: data.targetLanguage,
          learning_language: row.learning_language,
        } as never,
      });
    if (activityError) throw new Error(activityError.message);

    return {
      correct: graded.correct,
      expected: fallbackExpected,
    };
  });

export const deleteStudentPersonalWord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { error } = await admin
      .from("student_personal_vocabulary")
      .delete()
      .eq("id", data.id)
      .eq("student_id", studentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
