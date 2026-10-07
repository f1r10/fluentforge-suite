import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const PAGE_SIZE = 50;

const translationSchema = z.object({
  language: z.string().trim().min(2).max(10),
  value: z.string().trim().min(1).max(2_000),
});

const exampleSchema = z.object({
  sentence: z.string().trim().min(1).max(5_000),
  translation: z.string().max(5_000).nullable().default(null),
});

const vocabularyInputSchema = z.object({
  id: z.string().uuid().optional(),
  word: z.string().trim().min(1).max(500),
  learning_language: z.string().trim().min(2).max(10),
  definition: z.string().max(10_000).nullable().default(null),
  ipa: z.string().max(500).nullable().default(null),
  part_of_speech: z.string().max(100).nullable().default(null),
  synonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  antonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  level: z.string().max(20).nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  translations: z.array(translationSchema).max(50).default([]),
  examples: z.array(exampleSchema).max(100).default([]),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
});

export type VocabularyInput = z.infer<typeof vocabularyInputSchema>;

export const listVocabulary = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        language: z.string().max(10).default(""),
        level: z.string().max(20).default(""),
        status: z.enum(["active", "draft", "archived", "all"]).default("active"),
        topicId: z.string().uuid().optional(),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let select =
      "id,word,learning_language,definition,ipa,part_of_speech,level,status,updated_at,vocabulary_translations(language,value)";
    if (data.topicId) select += ",vt:vocabulary_topics!inner(topic_id)";

    let q = context.supabase
      .from("vocabulary_entries")
      .select(select, { count: "exact" })
      .is("deleted_at", null)
      .order("word")
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.language) q = q.eq("learning_language", data.language);
    if (data.level) q = q.eq("level", data.level);
    if (data.topicId) q = q.eq("vt.topic_id", data.topicId);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      q = q.ilike("word", `%${safe}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []) as unknown as Array<{
        id: string;
        word: string;
        learning_language: string | null;
        definition: string | null;
        ipa: string | null;
        part_of_speech: string | null;
        level: string | null;
        status: "active" | "draft" | "archived";
        updated_at: string;
        vocabulary_translations: Array<{ language: string; value: string }>;
      }>,
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const getVocabularyEntry = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("vocabulary_entries")
      .select(
        "id,word,learning_language,definition,ipa,part_of_speech,synonyms,antonyms,level,notes,status,audio_media_id,vocabulary_translations(id,language,value),vocabulary_examples(id,sentence,translation,sort_order),vocabulary_topics(topic_id),vocabulary_tags(tags(name))",
      )
      .eq("id", data.id)
      .is("deleted_at", null)
      .single();

    if (error || !row) throw new Error(error?.message ?? "Vocabulary entry not found.");

    const typed = row as unknown as {
      id: string;
      word: string;
      learning_language: string;
      definition: string | null;
      ipa: string | null;
      part_of_speech: string | null;
      synonyms: string[];
      antonyms: string[];
      level: string | null;
      notes: string | null;
      status: "active" | "draft" | "archived";
      audio_media_id: string | null;
      vocabulary_translations: Array<{ id: string; language: string; value: string }>;
      vocabulary_examples: Array<{ id: string; sentence: string; translation: string | null; sort_order: number }>;
      vocabulary_topics: Array<{ topic_id: string }>;
      vocabulary_tags: Array<{ tags: { name: string } }>;
    };

    return {
      id: typed.id,
      word: typed.word,
      learning_language: typed.learning_language,
      definition: typed.definition,
      ipa: typed.ipa,
      part_of_speech: typed.part_of_speech,
      synonyms: typed.synonyms ?? [],
      antonyms: typed.antonyms ?? [],
      level: typed.level,
      notes: typed.notes,
      status: typed.status,
      audio_media_id: typed.audio_media_id,
      translations: typed.vocabulary_translations.map((x) => ({ language: x.language, value: x.value })),
      examples: typed.vocabulary_examples
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((x) => ({ sentence: x.sentence, translation: x.translation })),
      topicIds: typed.vocabulary_topics.map((x) => x.topic_id),
      tags: typed.vocabulary_tags.map((x) => x.tags.name),
    };
  });

export const saveVocabularyEntry = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => vocabularyInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { adminClient, audit } = await import("./security.server");

    const uniqueTranslations = Array.from(
      new Map(data.translations.map((x) => [x.language.toLowerCase(), { ...x, language: x.language.toLowerCase() }])).values(),
    );
    const topicIds = [...new Set(data.topicIds)];
    const tagNames = [...new Set(data.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))];
    const synonyms = [...new Set(data.synonyms.map((x) => x.trim()).filter(Boolean))];
    const antonyms = [...new Set(data.antonyms.map((x) => x.trim()).filter(Boolean))];

    const core = {
      word: data.word,
      learning_language: data.learning_language,
      definition: data.definition || null,
      ipa: data.ipa || null,
      part_of_speech: data.part_of_speech || null,
      synonyms,
      antonyms,
      level: data.level || null,
      notes: data.notes || null,
      status: data.status,
    };

    let id = data.id;
    if (id) {
      const { error } = await sb.from("vocabulary_entries").update(core).eq("id", id).is("deleted_at", null);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await sb.from("vocabulary_entries").insert(core).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "Could not create vocabulary entry.");
      id = created.id;
    }

    await sb.from("vocabulary_translations").delete().eq("entry_id", id);
    if (uniqueTranslations.length) {
      const { error } = await sb.from("vocabulary_translations").insert(
        uniqueTranslations.map((x) => ({
          entry_id: id!,
          language: x.language,
          value: x.value,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await sb.from("vocabulary_examples").delete().eq("entry_id", id);
    if (data.examples.length) {
      const { error } = await sb.from("vocabulary_examples").insert(
        data.examples.map((x, index) => ({
          entry_id: id!,
          sentence: x.sentence,
          translation: x.translation || null,
          sort_order: index,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await sb.from("vocabulary_topics").delete().eq("entry_id", id);
    if (topicIds.length) {
      const { error } = await sb
        .from("vocabulary_topics")
        .insert(topicIds.map((topic_id) => ({ entry_id: id!, topic_id })));
      if (error) throw new Error(error.message);
    }

    await sb.from("vocabulary_tags").delete().eq("entry_id", id);
    if (tagNames.length) {
      await sb.from("tags").upsert(tagNames.map((name) => ({ name })), {
        onConflict: "name",
        ignoreDuplicates: true,
      });
      const { data: tagRows, error: tagError } = await sb.from("tags").select("id,name").in("name", tagNames);
      if (tagError) throw new Error(tagError.message);
      if (tagRows?.length) {
        const { error } = await sb
          .from("vocabulary_tags")
          .insert(tagRows.map((tag) => ({ entry_id: id!, tag_id: tag.id })));
        if (error) throw new Error(error.message);
      }
    }

    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: data.id ? "vocabulary_updated" : "vocabulary_created",
      entity_type: "vocabulary",
      entity_id: id,
      summary: `${data.id ? "Updated" : "Created"} vocabulary entry "${data.word}"`,
    });

    return { id };
  });

export const getVocabularyEnrichmentStatus = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async () => {
    const { getAiProviderStatus } = await import("./ai.server");
    return getAiProviderStatus();
  });

export const suggestVocabularyEnrichmentForEditor = createServerFn({
  method: "POST",
})
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        word: z.string().trim().min(1).max(500),
        learningLanguage: z.string().trim().min(2).max(10),
        targetLanguages: z
          .array(z.string().trim().min(2).max(10))
          .max(20)
          .default([]),
        existing: z
          .object({
            definition: z.string().max(10_000).nullable().optional(),
            ipa: z.string().max(500).nullable().optional(),
            partOfSpeech: z.string().max(100).nullable().optional(),
            translations: z
              .array(translationSchema)
              .max(50)
              .default([]),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    try {
      const { suggestVocabularyEnrichment } = await import("./ai.server");
      const suggestion = await suggestVocabularyEnrichment({
        word: data.word,
        learningLanguage: data.learningLanguage,
        targetLanguages: [
          ...new Set(
            data.targetLanguages
              .map((value) => value.toLowerCase())
              .filter((value) => value !== data.learningLanguage.toLowerCase()),
          ),
        ],
        existing: data.existing,
      });

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "vocabulary_enrichment_suggested",
        entity_type: "vocabulary",
        summary: `Generated vocabulary enrichment suggestion for "${data.word}"`,
        details: {
          provider: suggestion.provider,
          model: suggestion.model,
          confidence: suggestion.confidence,
          target_languages: data.targetLanguages,
        },
      });

      return suggestion;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      try {
        const { notifyTeacher } = await import("./notifications.functions");
        await notifyTeacher(admin, {
          kind: "ai_error",
          title: "Vocabulary enrichment failed",
          body: message,
          link: "/teacher/vocabulary",
          data: {
            word: data.word,
            learning_language: data.learningLanguage,
          },
          dedupeKey: `vocabulary-ai-error:${data.word.toLowerCase()}:${Date.now()}`,
        });
      } catch {
        // Notification delivery must never replace the original AI/provider error.
      }
      throw error;
    }
  });

export const setVocabularyStatus = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(1_000),
        status: z.enum(["active", "draft", "archived"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("vocabulary_entries")
      .update({ status: data.status })
      .in("id", data.ids)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const trashVocabulary = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(1_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("vocabulary_entries")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
