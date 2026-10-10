import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { choosePartOfSpeechRepair } from "./vocabulary-part-of-speech";

const PAGE_SIZE = 50;

const translationSchema = z.object({
  language: z.string().trim().min(2).max(10),
  value: z.string().trim().min(1).max(2_000),
});

const exampleSchema = z.object({
  sentence: z.string().trim().min(1).max(5_000),
  translation: z.string().max(5_000).nullable().default(null),
});

const enrichmentMetadataSchema = z.object({
  provider: z.enum(["wiktapi", "dictionary", "local", "gemini"]),
  model: z.string().trim().min(1).max(200),
  fetched_at: z.string().trim().min(1).max(100),
  lookup_word: z.string().trim().min(1).max(500),
  level_estimate: z
    .object({
      source: z.string().trim().min(1).max(120),
      confidence: z.number().finite().min(0).max(1),
      frequency_per_million: z.number().finite().min(0).nullable().default(null),
    })
    .nullable()
    .default(null),
  source: z
    .object({
      name: z.string().trim().min(1).max(120),
      url: z.string().url().nullable().default(null),
      license: z.string().trim().max(120).nullable().default(null),
    })
    .nullable()
    .default(null),
  pronunciations: z
    .array(
      z.object({
        ipa: z.string().max(500).nullable().default(null),
        audio: z.string().url().nullable().default(null),
        region: z.string().max(80).nullable().default(null),
        tags: z.array(z.string().max(120)).max(20).default([]),
      }),
    )
    .max(30)
    .default([]),
  forms: z
    .array(
      z.object({
        form: z.string().trim().min(1).max(500),
        tags: z.array(z.string().max(120)).max(20).default([]),
      }),
    )
    .max(100)
    .default([]),
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
  enrichment_metadata: enrichmentMetadataSchema.nullable().optional(),
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
        "id,word,learning_language,definition,ipa,part_of_speech,synonyms,antonyms,level,notes,status,audio_media_id,provenance,vocabulary_translations(id,language,value),vocabulary_examples(id,sentence,translation,sort_order),vocabulary_topics(topic_id),vocabulary_tags(tags(name))",
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
      provenance: unknown;
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
      enrichment_metadata:
        typed.provenance &&
        typeof typed.provenance === "object" &&
        (typed.provenance as Record<string, unknown>)["dictionary"] &&
        typeof (typed.provenance as Record<string, unknown>)["dictionary"] === "object"
          ? ((typed.provenance as Record<string, unknown>)["dictionary"] as Record<string, unknown>)
          : null,
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

    let currentProvenance: Record<string, unknown> = {};
    let currentPartOfSpeech: string | null = null;

    let automaticClassification:
      | Awaited<
          ReturnType<
            typeof import("./dictionary-vocabulary").fetchDatamuseLexicalMetadata
          >
        >
      | null = null;
    const baseLearningLanguage =
      data.learning_language.toLowerCase().split("-")[0] ??
      data.learning_language.toLowerCase();

    // New English vocabulary gets safe, best-effort basic classification
    // before the first database write. Explicit teacher values always win,
    // and provider failure never blocks manual creation.
    if (
      !data.id &&
      baseLearningLanguage === "en" &&
      (!data.part_of_speech?.trim() || !data.level?.trim())
    ) {
      const { fetchDatamuseLexicalMetadata } = await import(
        "./dictionary-vocabulary"
      );
      automaticClassification =
        await fetchDatamuseLexicalMetadata(data.word).catch(() => null);
    }

    if (data.id) {
      const { data: current, error: provenanceError } = await sb
        .from("vocabulary_entries")
        .select("provenance,part_of_speech")
        .eq("id", data.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (provenanceError) throw new Error(provenanceError.message);
      if (current?.provenance && typeof current.provenance === "object") {
        currentProvenance = current.provenance as Record<string, unknown>;
      }
      currentPartOfSpeech = current?.part_of_speech ?? null;
    }

    const nextPartOfSpeech =
      data.part_of_speech ||
      automaticClassification?.partOfSpeech ||
      null;
    const nextLevel =
      data.level ||
      automaticClassification?.level ||
      null;
    const manualFields =
      currentProvenance["manual_fields"] &&
      typeof currentProvenance["manual_fields"] === "object"
        ? {
            ...(currentProvenance["manual_fields"] as Record<string, unknown>),
          }
        : {};
    if (
      data.id &&
      (currentPartOfSpeech ?? "") !== (nextPartOfSpeech ?? "")
    ) {
      manualFields["part_of_speech"] = {
        value: nextPartOfSpeech,
        updated_at: new Date().toISOString(),
        source: "teacher",
      };
    }

    const shouldPersistProvenance =
      data.enrichment_metadata != null ||
      automaticClassification != null ||
      Object.keys(manualFields).length > 0;

    const core = {
      word: data.word,
      learning_language: data.learning_language,
      definition: data.definition || null,
      ipa: data.ipa || null,
      part_of_speech: nextPartOfSpeech,
      synonyms,
      antonyms,
      level: nextLevel,
      notes: data.notes || null,
      status: data.status,
      ...(shouldPersistProvenance
        ? {
            provenance: {
              ...currentProvenance,
              ...(Object.keys(manualFields).length
                ? { manual_fields: manualFields }
                : {}),
              ...(data.enrichment_metadata
                ? { dictionary: data.enrichment_metadata }
                : {}),
              ...(automaticClassification
                ? {
                    automatic_classification: {
                      source: "datamuse",
                      generated_at: new Date().toISOString(),
                      part_of_speech:
                        automaticClassification.partOfSpeech,
                      level: automaticClassification.level,
                      confidence: automaticClassification.confidence,
                      frequency_per_million:
                        automaticClassification.frequencyPerMillion,
                    },
                  }
                : {}),
            } as never,
          }
        : {}),
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
    const ai = getAiProviderStatus();
    return {
      ...ai,
      dictionaryFallback: true,
      dictionaryLanguages: ["en", "az", "ru", "tr"],
      dictionaryProviders: ["wiktapi", "dictionaryapi.dev"],
    };
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
            level: z.string().max(20).nullable().optional(),
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
      const { getAiProviderStatus, suggestVocabularyEnrichment } = await import(
        "./ai.server"
      );
      const aiStatus = getAiProviderStatus();
      const normalizedLanguage = data.learningLanguage.toLowerCase();
      const baseLanguage = normalizedLanguage.split("-")[0] || normalizedLanguage;
      const targetLanguages = [
        ...new Set(
          data.targetLanguages
            .map((value) => value.toLowerCase())
            .filter((value) => value !== normalizedLanguage),
        ),
      ];

      let dictionarySuggestion = null;
      let dictionaryError: unknown = null;
      try {
        const { fetchBestDictionaryVocabularySuggestion } = await import(
          "./dictionary-vocabulary"
        );
        dictionarySuggestion = await fetchBestDictionaryVocabularySuggestion(
          data.word,
          {
            language: baseLanguage,
            targetLanguages,
          },
        );
      } catch (error) {
        dictionaryError = error;
      }

      let aiSuggestion = null;
      if (aiStatus.available) {
        try {
          aiSuggestion = await suggestVocabularyEnrichment({
            word: data.word,
            learningLanguage: data.learningLanguage,
            targetLanguages,
            existing: data.existing,
          });
        } catch (error) {
          if (!dictionarySuggestion) throw error;
        }
      }

      if (!dictionarySuggestion && !aiSuggestion) {
        throw dictionaryError instanceof Error
          ? dictionaryError
          : new Error("No vocabulary enrichment provider returned a result.");
      }

      const suggestion =
        dictionarySuggestion && aiSuggestion
          ? mergeVocabularySuggestions(dictionarySuggestion, aiSuggestion)
          : (dictionarySuggestion ?? aiSuggestion)!;

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
          fallback:
            suggestion.provider === "dictionary" ||
            suggestion.provider === "wiktapi",
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


function mergeVocabularySuggestions(
  primary: Awaited<
    ReturnType<
      typeof import("./dictionary-vocabulary").fetchBestDictionaryVocabularySuggestion
    >
  >,
  secondary: Awaited<
    ReturnType<typeof import("./ai.server").suggestVocabularyEnrichment>
  >,
) {
  const translationMap = new Map(
    primary.translations.map((item) => [
      item.language.toLowerCase(),
      { ...item, language: item.language.toLowerCase() },
    ]),
  );
  for (const item of secondary.translations) {
    const key = item.language.toLowerCase();
    if (!translationMap.has(key)) {
      translationMap.set(key, { ...item, language: key });
    }
  }

  const exampleMap = new Map(
    primary.examples.map((item) => [
      item.sentence.trim().toLowerCase(),
      item,
    ]),
  );
  for (const item of secondary.examples) {
    const key = item.sentence.trim().toLowerCase();
    if (!exampleMap.has(key)) exampleMap.set(key, item);
  }

  return {
    ...primary,
    level: primary.level ?? secondary.level,
    level_estimate:
      primary.level_estimate ?? secondary.level_estimate,
    definition: primary.definition ?? secondary.definition,
    ipa: primary.ipa ?? secondary.ipa,
    part_of_speech:
      primary.part_of_speech ?? secondary.part_of_speech,
    synonyms: [
      ...new Set([...primary.synonyms, ...secondary.synonyms]),
    ].slice(0, 30),
    antonyms: [
      ...new Set([...primary.antonyms, ...secondary.antonyms]),
    ].slice(0, 30),
    translations: [...translationMap.values()].slice(0, 20),
    examples: [...exampleMap.values()].slice(0, 10),
    notes: [primary.notes, secondary.notes]
      .filter(Boolean)
      .join(" "),
    model: `${primary.model} + ${secondary.model}`,
  };
}

function dictionaryMetadataFromSuggestion(
  suggestion: Awaited<
    ReturnType<
      typeof import("./dictionary-vocabulary").fetchBestDictionaryVocabularySuggestion
    >
  >,
  lookupWord: string,
) {
  return {
    provider: suggestion.provider,
    model: suggestion.model,
    fetched_at: suggestion.generated_at,
    lookup_word: lookupWord,
    level_estimate: suggestion.level_estimate,
    source: suggestion.source,
    pronunciations: suggestion.pronunciations,
    forms: suggestion.forms,
  };
}

function cleanVocabularyLookupWord(word: string) {
  return word
    .replace(/^\s*(?:#\s*)?\d{1,4}(?:\s*[.)-]\s*|\s+)/, "")
    .trim();
}

async function resolveStoredVocabularyDictionary(
  word: string,
  language: string,
  targetLanguages: string[],
) {
  const { fetchBestDictionaryVocabularySuggestion } = await import(
    "./dictionary-vocabulary"
  );
  const cleaned = cleanVocabularyLookupWord(word);

  // Enrichment is metadata-only. Never shorten or rewrite a stored headword
  // just because an external dictionary cannot resolve the full phrase.
  // Legitimate expressions such as "in accordance with sth", phrasal verbs,
  // idioms and teacher-entered multiword terms must remain intact.
  return {
    lookupWord: cleaned,
    recoveredTail: null as string | null,
    suggestion: await fetchBestDictionaryVocabularySuggestion(cleaned, {
      language,
      targetLanguages,
    }),
  };
}

export const autoFillMissingVocabularyLevels = createServerFn({
  method: "POST",
})
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { adminClient, audit } = await import("./security.server");
    const { fetchDatamuseCefrEstimate } = await import(
      "./dictionary-vocabulary"
    );
    const admin = await adminClient();

    const { data: rows, error } = await admin
      .from("vocabulary_entries")
      .select("id,word,learning_language,level,provenance")
      .eq("status", "active")
      .eq("learning_language", "en")
      .is("level", null)
      .is("deleted_at", null)
      .order("word")
      .limit(500);
    if (error) throw new Error(error.message);

    let updated = 0;
    let unavailable = 0;
    for (let offset = 0; offset < (rows ?? []).length; offset += 8) {
      const batch = (rows ?? []).slice(offset, offset + 8);
      const results = await Promise.all(
        batch.map(async (row) => {
          const estimate = await fetchDatamuseCefrEstimate(row.word).catch(
            () => null,
          );
          if (!estimate) return false;

          const provenance =
            row.provenance && typeof row.provenance === "object"
              ? (row.provenance as Record<string, unknown>)
              : {};
          const dictionary =
            provenance["dictionary"] &&
            typeof provenance["dictionary"] === "object"
              ? (provenance["dictionary"] as Record<string, unknown>)
              : {};

          const { data: changed, error: updateError } = await admin
            .from("vocabulary_entries")
            .update({
              level: estimate.level,
              provenance: {
                ...provenance,
                dictionary: {
                  ...dictionary,
                  level_estimate: {
                    source: "Datamuse frequency heuristic",
                    confidence: estimate.confidence,
                    frequency_per_million:
                      estimate.frequencyPerMillion,
                  },
                  level_estimated_at: new Date().toISOString(),
                },
              } as never,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .is("level", null)
            .select("id")
            .maybeSingle();
          if (updateError) throw new Error(updateError.message);
          return !!changed;
        }),
      );
      updated += results.filter(Boolean).length;
      unavailable += results.filter((value) => !value).length;
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "vocabulary_levels_auto_filled",
      entity_type: "vocabulary",
      summary: `Automatically filled CEFR levels for ${updated} vocabulary entries`,
      details: {
        candidates: rows?.length ?? 0,
        updated,
        unavailable,
        method: "datamuse_frequency",
      },
    });

    return {
      candidates: rows?.length ?? 0,
      updated,
      unavailable,
    };
  });

export const repairVocabularyPartOfSpeech = createServerFn({
  method: "POST",
})
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const [entriesResult, importsResult] = await Promise.all([
      admin
        .from("vocabulary_entries")
        .select("id,word,learning_language,part_of_speech,provenance")
        .in("id", data.ids)
        .is("deleted_at", null),
      admin
        .from("import_items")
        .select("created_entity_id,payload,created_at")
        .eq("item_type", "vocabulary")
        .in("created_entity_id", data.ids)
        .order("created_at", { ascending: false }),
    ]);
    if (entriesResult.error) throw new Error(entriesResult.error.message);
    if (importsResult.error) throw new Error(importsResult.error.message);

    const originalImportPartOfSpeech = new Map<string, string | null>();
    for (const item of importsResult.data ?? []) {
      const entityId =
        typeof item.created_entity_id === "string"
          ? item.created_entity_id
          : "";
      if (!entityId || originalImportPartOfSpeech.has(entityId)) continue;
      const payload =
        item.payload && typeof item.payload === "object"
          ? (item.payload as Record<string, unknown>)
          : {};
      const value =
        typeof payload["part_of_speech"] === "string"
          ? payload["part_of_speech"].trim() || null
          : null;
      originalImportPartOfSpeech.set(entityId, value);
    }

    const failures: Array<{
      id: string;
      word: string;
      error: string;
    }> = [];
    const changes: Array<{
      id: string;
      word: string;
      before: string | null;
      after: string | null;
      reason:
        | "restore_previous"
        | "restore_import"
        | "fill_missing_import"
        | "fill_missing_dictionary"
        | "recalculate_dictionary";
    }> = [];

    for (let offset = 0; offset < (entriesResult.data ?? []).length; offset += 4) {
      const batch = (entriesResult.data ?? []).slice(offset, offset + 4);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const provenance =
              row.provenance && typeof row.provenance === "object"
                ? (row.provenance as Record<string, unknown>)
                : {};
            const dictionary =
              provenance["dictionary"] &&
              typeof provenance["dictionary"] === "object"
                ? (provenance["dictionary"] as Record<string, unknown>)
                : {};
            const manualFields =
              provenance["manual_fields"] &&
              typeof provenance["manual_fields"] === "object"
                ? (provenance["manual_fields"] as Record<string, unknown>)
                : {};
            const manualPartOfSpeech =
              manualFields["part_of_speech"] &&
              typeof manualFields["part_of_speech"] === "object"
                ? (manualFields["part_of_speech"] as Record<string, unknown>)
                : null;
            if (
              manualPartOfSpeech &&
              Object.prototype.hasOwnProperty.call(
                manualPartOfSpeech,
                "value",
              )
            ) {
              return;
            }
            const previousWasRecorded =
              typeof dictionary["part_of_speech_repaired_at"] === "string" &&
              !dictionary["part_of_speech_repair_rolled_back_at"] &&
              Object.prototype.hasOwnProperty.call(
                dictionary,
                "previous_part_of_speech",
              );
            const previousBeforeRepair =
              typeof dictionary["previous_part_of_speech"] === "string"
                ? dictionary["previous_part_of_speech"]
                : null;
            const imported =
              originalImportPartOfSpeech.get(row.id) ?? null;

            let decision:
              | {
                  value: string | null;
                  reason:
                    | "restore_previous"
                    | "restore_import"
                    | "fill_missing_import"
                    | "fill_missing_dictionary"
                    | "recalculate_dictionary";
                }
              | null = choosePartOfSpeechRepair({
              current: row.part_of_speech,
              imported,
              dictionary: null,
              previousBeforeRepair,
              previousWasRecorded,
            });
            let resolved:
              | Awaited<ReturnType<typeof resolveStoredVocabularyDictionary>>
              | null = null;

            const language =
              (row.learning_language || "en")
                .toLowerCase()
                .split("-")[0] || "en";

            // This action is explicitly requested by the teacher. When there
            // is no authoritative source/import POS, re-evaluate English
            // entries against corpus popularity metadata. This repairs older
            // auto-filled values such as apple/baby/bad being assigned rare
            // secondary verb senses, while source-provided POS remains intact.
            if (
              !decision &&
              !previousWasRecorded &&
              !imported &&
              language === "en"
            ) {
              const { fetchDatamuseLexicalMetadata } = await import(
                "./dictionary-vocabulary"
              );
              const lexical = await fetchDatamuseLexicalMetadata(row.word).catch(
                () => null,
              );
              if (
                lexical?.partOfSpeech &&
                lexical.partOfSpeech !== row.part_of_speech
              ) {
                decision = {
                  value: lexical.partOfSpeech,
                  reason: "recalculate_dictionary",
                };
              }
            }

            // For genuinely empty non-English/unknown entries, retain the
            // existing dictionary fallback. It never runs over source data.
            if (
              !decision &&
              !row.part_of_speech?.trim() &&
              !previousWasRecorded &&
              !imported
            ) {
              resolved = await resolveStoredVocabularyDictionary(
                row.word,
                language,
                [],
              );
              decision = choosePartOfSpeechRepair({
                current: row.part_of_speech,
                imported,
                dictionary: resolved.suggestion.part_of_speech,
                previousBeforeRepair,
                previousWasRecorded,
              });
            }

            if (!decision || decision.value === row.part_of_speech) return;

            const now = new Date().toISOString();
            const dictionaryPatch =
              decision.reason === "fill_missing_dictionary" && resolved
                ? {
                    ...dictionary,
                    ...dictionaryMetadataFromSuggestion(
                      resolved.suggestion,
                      resolved.lookupWord,
                    ),
                    part_of_speech_filled_at: now,
                    part_of_speech_fill_source: "dictionary",
                  }
                : {
                    ...dictionary,
                    ...(decision.reason === "restore_previous"
                      ? {
                          part_of_speech_repair_rolled_back_at: now,
                          part_of_speech_restored_at: now,
                          part_of_speech_restore_source: "previous_value",
                        }
                      : decision.reason === "fill_missing_import" ||
                          decision.reason === "restore_import"
                        ? {
                            part_of_speech_restored_at: now,
                            part_of_speech_restore_source: "import_payload",
                          }
                        : decision.reason === "recalculate_dictionary"
                          ? {
                              part_of_speech_recalculated_at: now,
                              part_of_speech_recalculate_source:
                                "datamuse_primary_corpus_pos",
                              part_of_speech_value: decision.value,
                            }
                          : {}),
                  };

            const { error: updateError } = await admin
              .from("vocabulary_entries")
              .update({
                part_of_speech: decision.value,
                provenance: {
                  ...provenance,
                  dictionary: dictionaryPatch,
                } as never,
                updated_at: now,
              })
              .eq("id", row.id)
              .is("deleted_at", null);
            if (updateError) throw new Error(updateError.message);

            changes.push({
              id: row.id,
              word: row.word,
              before: row.part_of_speech,
              after: decision.value,
              reason: decision.reason,
            });
          } catch (repairError) {
            failures.push({
              id: row.id,
              word: row.word,
              error:
                repairError instanceof Error
                  ? repairError.message
                  : String(repairError),
            });
          }
        }),
      );
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "vocabulary_part_of_speech_repaired",
      entity_type: "vocabulary",
      summary: `Safely repaired part of speech for ${changes.length} vocabulary entries`,
      details: {
        requested: data.ids.length,
        changed: changes.length,
        failed: failures.length,
        restored_previous: changes.filter(
          (item) => item.reason === "restore_previous",
        ).length,
        restored_or_filled_from_import: changes.filter(
          (item) =>
            item.reason === "restore_import" ||
            item.reason === "fill_missing_import",
        ).length,
        filled_from_dictionary: changes.filter(
          (item) => item.reason === "fill_missing_dictionary",
        ).length,
        recalculated_from_corpus: changes.filter(
          (item) => item.reason === "recalculate_dictionary",
        ).length,
        changes: changes.slice(0, 100),
      },
    });

    return {
      requested: data.ids.length,
      changed: changes.length,
      failed: failures.length,
      changes: changes.slice(0, 100),
      failures: failures.slice(0, 20),
    };
  });

export const bulkEnrichVocabulary = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        overwrite: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { getAiProviderStatus, suggestVocabularyEnrichment } = await import(
      "./ai.server"
    );
    const aiStatus = getAiProviderStatus();

    const [entriesResult, languagesResult] =
      await Promise.all([
        admin
          .from("vocabulary_entries")
          .select(
            "id,word,learning_language,definition,ipa,part_of_speech,level,synonyms,antonyms,provenance,vocabulary_translations(id,language,value),vocabulary_examples(id,sentence,translation,sort_order)",
          )
          .in("id", data.ids)
          .is("deleted_at", null),
        admin
          .from("languages")
          .select("code")
          .eq("is_translation", true)
          .order("sort_order"),
      ]);
    if (entriesResult.error) throw new Error(entriesResult.error.message);
    if (languagesResult.error) throw new Error(languagesResult.error.message);

    const targetLanguageCodes = (languagesResult.data ?? []).map((row) =>
      String(row.code).toLowerCase(),
    );

    const failures: Array<{ id: string; word: string; error: string }> = [];
    const providerCounts: Record<string, number> = {};
    let updated = 0;

    const rows = (entriesResult.data ?? []) as unknown as Array<{
      id: string;
      word: string;
      learning_language: string | null;
      definition: string | null;
      ipa: string | null;
      part_of_speech: string | null;
      level: string | null;
      synonyms: string[] | null;
      antonyms: string[] | null;
      provenance: unknown;
      vocabulary_translations: Array<{
        id: string;
        language: string;
        value: string;
      }>;
      vocabulary_examples: Array<{
        id: string;
        sentence: string;
        translation: string | null;
        sort_order: number;
      }>;
    }>;

    for (let offset = 0; offset < rows.length; offset += 4) {
      const batch = rows.slice(offset, offset + 4);
      const results = await Promise.all(
        batch.map(async (row) => {
          const lookupWord = cleanVocabularyLookupWord(row.word);
          const learningLanguage = (
            row.learning_language || "en"
          ).toLowerCase();
          const baseLanguage =
            learningLanguage.split("-")[0] || learningLanguage;
          const targets = targetLanguageCodes.filter(
            (code) => code !== baseLanguage,
          );

          try {
            let dictionarySuggestion = null;
            let dictionaryError: unknown = null;
            let resolvedLookupWord = lookupWord;
            try {
              const resolved =
                await resolveStoredVocabularyDictionary(
                  row.word,
                  baseLanguage,
                  targets,
                );
              dictionarySuggestion = resolved.suggestion;
              resolvedLookupWord = resolved.lookupWord;
            } catch (error) {
              dictionaryError = error;
            }

            let aiSuggestion = null;
            const existingTranslations = row.vocabulary_translations.map(
              (item) => ({
                language: item.language,
                value: item.value,
              }),
            );
            if (aiStatus.available) {
              try {
                aiSuggestion = await suggestVocabularyEnrichment({
                  word: resolvedLookupWord,
                  learningLanguage,
                  targetLanguages: targets,
                  existing: {
                    definition: row.definition,
                    ipa: row.ipa,
                    partOfSpeech: row.part_of_speech,
                    level: row.level,
                    translations: existingTranslations,
                  },
                });
              } catch (error) {
                if (!dictionarySuggestion) throw error;
              }
            }

            if (!dictionarySuggestion && !aiSuggestion) {
              throw dictionaryError instanceof Error
                ? dictionaryError
                : new Error("No enrichment provider returned a result.");
            }

            const suggestion =
              dictionarySuggestion && aiSuggestion
                ? mergeVocabularySuggestions(
                    dictionarySuggestion,
                    aiSuggestion,
                  )
                : (dictionarySuggestion ?? aiSuggestion)!;

            const existingProvenance =
              row.provenance && typeof row.provenance === "object"
                ? (row.provenance as Record<string, unknown>)
                : {};
            const patch = {
              definition:
                data.overwrite || !row.definition?.trim()
                  ? suggestion.definition ?? row.definition
                  : row.definition,
              ipa:
                data.overwrite || !row.ipa?.trim()
                  ? suggestion.ipa ?? row.ipa
                  : row.ipa,
              part_of_speech:
                data.overwrite || !row.part_of_speech?.trim()
                  ? suggestion.part_of_speech ?? row.part_of_speech
                  : row.part_of_speech,
              level:
                data.overwrite || !row.level?.trim()
                  ? suggestion.level ?? row.level
                  : row.level,
              synonyms: [
                ...new Set([
                  ...(row.synonyms ?? []),
                  ...suggestion.synonyms,
                ]),
              ].slice(0, 100),
              antonyms: [
                ...new Set([
                  ...(row.antonyms ?? []),
                  ...suggestion.antonyms,
                ]),
              ].slice(0, 100),
              provenance: {
                ...existingProvenance,
                dictionary: dictionaryMetadataFromSuggestion(
                  suggestion,
                  resolvedLookupWord,
                ),
              } as never,
              updated_at: new Date().toISOString(),
            };

            const { error: updateError } = await admin
              .from("vocabulary_entries")
              .update(patch)
              .eq("id", row.id)
              .is("deleted_at", null);
            if (updateError) throw new Error(updateError.message);

            const translationByLanguage = new Map(
              row.vocabulary_translations.map((item) => [
                item.language.toLowerCase(),
                item,
              ]),
            );
            for (const incoming of suggestion.translations) {
              const language = incoming.language.toLowerCase();
              const current = translationByLanguage.get(language);
              if (current) {
                if (
                  data.overwrite &&
                  incoming.value.trim() &&
                  current.value !== incoming.value
                ) {
                  const { error } = await admin
                    .from("vocabulary_translations")
                    .update({ value: incoming.value })
                    .eq("id", current.id);
                  if (error) throw new Error(error.message);
                }
              } else if (incoming.value.trim()) {
                const { error } = await admin
                  .from("vocabulary_translations")
                  .insert({
                    entry_id: row.id,
                    language,
                    value: incoming.value,
                  });
                if (error) throw new Error(error.message);
              }
            }

            const exampleKeys = new Set(
              row.vocabulary_examples.map((item) =>
                item.sentence.trim().toLowerCase(),
              ),
            );
            let sortOrder =
              row.vocabulary_examples.reduce(
                (max, item) => Math.max(max, item.sort_order),
                -1,
              ) + 1;
            for (const example of suggestion.examples) {
              const key = example.sentence.trim().toLowerCase();
              if (!key || exampleKeys.has(key)) continue;
              exampleKeys.add(key);
              const { error } = await admin
                .from("vocabulary_examples")
                .insert({
                  entry_id: row.id,
                  sentence: example.sentence,
                  translation: example.translation || null,
                  sort_order: sortOrder++,
                });
              if (error) throw new Error(error.message);
            }

            providerCounts[suggestion.provider] =
              (providerCounts[suggestion.provider] ?? 0) + 1;
            return true;
          } catch (error) {
            failures.push({
              id: row.id,
              word: row.word,
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            });
            return false;
          }
        }),
      );
      updated += results.filter(Boolean).length;
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "vocabulary_bulk_enriched",
      entity_type: "vocabulary",
      summary: `Auto-filled dictionary metadata for ${updated} vocabulary entries`,
      details: {
        requested: data.ids.length,
        found: rows.length,
        updated,
        failed: failures.length,
        overwrite: data.overwrite,
        providers: providerCounts,
      },
    });

    return {
      requested: data.ids.length,
      found: rows.length,
      updated,
      failed: failures.length,
      failures: failures.slice(0, 20),
      providers: providerCounts,
    };
  });
