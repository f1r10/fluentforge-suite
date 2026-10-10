import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { validateQuestionInput } from "./question-schema";
import { getProcessingService, type ProcessingImportItem } from "./processing.service";

const SOURCE_BUCKET = "sources";
const MiB = 1024 * 1024;

const POSTGREST_ID_CHUNK = 150;

function chunks<T>(values: T[], size = POSTGREST_ID_CHUNK) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function updateImportItemDecisionInChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  ids: string[],
  decision: "pending" | "approved" | "rejected",
) {
  for (const batch of chunks(ids)) {
    const { error } = await sb
      .from("import_items")
      .update({ decision })
      .in("id", batch);
    if (error) throw new Error(error.message);
  }
}

async function insertRowsInChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  table: string,
  rows: Record<string, unknown>[],
  size = 400,
) {
  for (const batch of chunks(rows, size)) {
    if (!batch.length) continue;
    const { error } = await sb.from(table).insert(batch as never);
    if (error) throw new Error(error.message);
  }
}

async function upsertRowsInChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  table: string,
  rows: Record<string, unknown>[],
  options: { onConflict: string; ignoreDuplicates?: boolean },
  size = 400,
) {
  for (const batch of chunks(rows, size)) {
    if (!batch.length) continue;
    const { error } = await sb
      .from(table)
      .upsert(batch as never, options);
    if (error) throw new Error(error.message);
  }
}

const readingImportPayloadSchema = z.object({
  source_ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(250_000),
  display_layout: z.enum(["stacked", "split", "tabbed"]).default("split"),
  learning_language: z.string().max(10).nullable().optional(),
  level: z.string().max(20).nullable().optional(),
  status: z.enum(["draft", "active"]).default("draft"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const listeningImportPayloadSchema = z.object({
  source_ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  transcript: z.string().max(500_000).default(""),
  learning_language: z.string().max(10).nullable().optional(),
  level: z.string().max(20).nullable().optional(),
  status: z.enum(["draft", "active"]).default("draft"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const vocabularyImportPayloadSchema = z.object({
  word: z.string().trim().min(1).max(500),
  learning_language: z.string().trim().min(2).max(10).default("en"),
  definition: z.string().max(10_000).nullable().default(null),
  ipa: z.string().max(500).nullable().default(null),
  part_of_speech: z.string().max(100).nullable().default(null),
  synonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  antonyms: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  level: z.string().max(20).nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  status: z.enum(["draft", "active"]).default("draft"),
  translations: z
    .array(
      z.object({
        language: z.string().trim().min(2).max(10),
        value: z.string().trim().min(1).max(2_000),
      }),
    )
    .max(50)
    .default([]),
  examples: z
    .array(
      z.object({
        sentence: z.string().trim().min(1).max(5_000),
        translation: z.string().max(5_000).nullable().default(null),
      }),
    )
    .max(100)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  import_mapping: z.record(z.string(), z.unknown()).optional(),
});

const spreadsheetMappingSchema = z
  .object({
    include_sheets: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .default([]),
    header_row: z.number().int().min(1).max(100).default(1),
    first_data_row: z.number().int().min(1).max(10_000).nullable().default(null),
    sheet_as_section: z.boolean().default(false),
    multi_value_separator: z.string().min(1).max(5).default("|"),
    columns: z.object({
      prompt: z.string().trim().min(1).max(120),
      question_type: z.string().trim().max(120).default(""),
      correct_answer: z.string().trim().max(120).default(""),
      option_a: z.string().trim().max(120).default(""),
      option_b: z.string().trim().max(120).default(""),
      option_c: z.string().trim().max(120).default(""),
      option_d: z.string().trim().max(120).default(""),
      option_e: z.string().trim().max(120).default(""),
      option_f: z.string().trim().max(120).default(""),
      option_g: z.string().trim().max(120).default(""),
      option_h: z.string().trim().max(120).default(""),
      instructions: z.string().trim().max(120).default(""),
      explanation: z.string().trim().max(120).default(""),
      points: z.string().trim().max(120).default(""),
      difficulty: z.string().trim().max(120).default(""),
      learning_language: z.string().trim().max(120).default(""),
      level: z.string().trim().max(120).default(""),
      tags: z.string().trim().max(120).default(""),
      section: z.string().trim().max(120).default(""),
    }),
  })
  .superRefine((value, ctx) => {
    if (
      value.first_data_row != null &&
      value.first_data_row <= value.header_row
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["first_data_row"],
        message: "First data row must be after the header row.",
      });
    }
  });

const allowedExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "tsv",
  "txt",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "tif",
  "tiff",
]);

function ext(filename: string) {
  const value = filename.trim().toLowerCase().split(".").pop();
  return value && value !== filename.toLowerCase() ? value : "";
}

function safeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return cleaned || "source";
}

function assertSourceType(filename: string) {
  const extension = ext(filename);
  if (!allowedExtensions.has(extension)) {
    throw new Error(
      "Unsupported source type. Use PDF, DOC/DOCX, XLS/XLSX, CSV/TSV/TXT/RTF or an image.",
    );
  }
}


type ImportItemValidation =
  | { state: "ready"; message: null }
  | { state: "needs_fix"; message: string }
  | { state: "not_importable"; message: string };

function normalizeImportedQuestion(raw: Record<string, unknown>) {
  return validateQuestionInput({
    ...raw,
    instructions: raw["instructions"] ?? null,
    scoring: raw["scoring"] ?? { points: 1, partial: false, negative: 0 },
    normalization:
      raw["normalization"] ?? {
        case_sensitive: false,
        trim_whitespace: true,
        ignore_punctuation: false,
        ignore_diacritics: false,
      },
    explanation: raw["explanation"] ?? null,
    teacher_notes: raw["teacher_notes"] ?? null,
    learning_language: raw["learning_language"] ?? "en",
    level: raw["level"] ?? null,
    difficulty: raw["difficulty"] ?? null,
    grading_mode: raw["grading_mode"] ?? "automatic",
    status: raw["status"] ?? "draft",
    reusable_independently: false,
    topicIds: [],
    tags: Array.isArray(raw["tags"])
      ? raw["tags"].filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    force: true,
  });
}

function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 4)
      .map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "item";
        return `${path}: ${issue.message}`;
      })
      .join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function validateImportItemPayload(
  itemType: string,
  payload: unknown,
): ImportItemValidation {
  try {
    if (itemType === "question") {
      const warnings =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).import_warnings
          : null;
      if (Array.isArray(warnings) && warnings.length > 0) {
        return {
          state: "needs_fix",
          message: warnings.map((warning) => String(warning)).join(" "),
        };
      }
      normalizeImportedQuestion(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {},
      );
      return { state: "ready", message: null };
    }
    if (itemType === "vocabulary") {
      const parsed = vocabularyImportPayloadSchema.parse(payload);
      const suspiciousRawRow =
        /^\s*\d{1,4}[.)]\s+/.test(parsed.word) ||
        /\b(noun|verb|adjective|adverb|preposition|pronoun|determiner|conjunction)\b/i.test(
          parsed.word,
        ) ||
        /\b(A1|A2|B1|B2|C1|C2)\s*$/i.test(parsed.word);
      if (suspiciousRawRow) {
        return {
          state: "needs_fix",
          message:
            "The extracted vocabulary word still looks like an unparsed source row. Review the word, part of speech, level and source sense before approving.",
        };
      }
      return { state: "ready", message: null };
    }
    if (itemType === "reading") {
      readingImportPayloadSchema.parse(payload);
      return { state: "ready", message: null };
    }
    if (itemType === "listening") {
      listeningImportPayloadSchema.parse(payload);
      return { state: "ready", message: null };
    }
    return {
      state: "not_importable",
      message:
        "This extracted layout/reference item is kept for review but is not imported as a standalone learning item.",
    };
  } catch (error) {
    return { state: "needs_fix", message: validationMessage(error) };
  }
}

export const listImportProfiles = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("import_profiles")
      .select("id,name,kind,config,created_at")
      .eq("kind", "document")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveImportProfile = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        config: z.object({
          expected_content: z
            .enum(["auto", "questions", "vocabulary", "readings", "listenings", "mixed"])
            .default("auto"),
          learning_language: z.string().max(10).nullable().default(null),
          translation_language: z.string().max(10).nullable().default(null),
          level: z.string().max(20).nullable().default(null),
          status: z.enum(["draft", "active"]).default("draft"),
          auto_approve_confidence: z.number().min(0.5).max(1).default(0.95),
          auto_enrich_vocabulary: z.boolean().default(false),
          spreadsheet_mapping: spreadsheetMappingSchema.nullable().default(null),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("import_profiles")
        .update({ name: data.name, config: data.config as never })
        .eq("id", data.id)
        .eq("kind", "document");
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await context.supabase
      .from("import_profiles")
      .insert({
        name: data.name,
        kind: "document",
        config: data.config as never,
      })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(error?.message ?? "Could not save import profile.");
    }
    return { id: created.id };
  });

export const deleteImportProfile = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { count } = await context.supabase
      .from("import_jobs")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", data.id);
    if ((count ?? 0) > 0) {
      throw new Error("This profile is referenced by import history and cannot be deleted.");
    }
    const { error } = await context.supabase
      .from("import_profiles")
      .delete()
      .eq("id", data.id)
      .eq("kind", "document");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createSourceUploadSession = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255).default("application/octet-stream"),
        sizeBytes: z.number().int().min(1).max(1024 * MiB),
        keepOriginal: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    assertSourceType(data.filename);
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const now = new Date();
    const path = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${crypto.randomUUID()}-${safeFilename(data.filename)}`,
    ].join("/");

    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: session, error: sessionError } = await admin
      .from("source_upload_sessions")
      .insert({
        storage_path: path,
        original_filename: data.filename,
        mime_type: data.mimeType || null,
        expected_size_bytes: data.sizeBytes,
        keep_original: data.keepOriginal,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (sessionError || !session) {
      throw new Error(sessionError?.message ?? "Could not create source upload session.");
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(SOURCE_BUCKET)
      .createSignedUploadUrl(path);
    if (signedError || !signed) {
      await admin.from("source_upload_sessions").delete().eq("id", session.id);
      throw new Error(signedError?.message ?? "Could not authorize source upload.");
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "source_upload_started",
      entity_type: "source_upload",
      entity_id: session.id,
      summary: `Started document upload "${data.filename}"`,
      details: { size_bytes: data.sizeBytes, keep_original: data.keepOriginal },
    });

    return {
      sessionId: session.id,
      bucket: SOURCE_BUCKET,
      path,
      token: signed.token,
      expiresAt,
    };
  });

export const finalizeSourceUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: session, error: sessionError } = await admin
      .from("source_upload_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("Upload session not found.");
    if (session.finalized_at && session.source_file_id) {
      return { sourceFileId: session.source_file_id };
    }
    if (Date.now() > new Date(session.expires_at).getTime()) {
      throw new Error("Upload session expired.");
    }

    const slash = session.storage_path.lastIndexOf("/");
    const folder = slash >= 0 ? session.storage_path.slice(0, slash) : "";
    const name = slash >= 0 ? session.storage_path.slice(slash + 1) : session.storage_path;
    const { data: objects, error: objectError } = await admin.storage
      .from(SOURCE_BUCKET)
      .list(folder, { search: name, limit: 10 });
    if (objectError) throw new Error(objectError.message);

    const object = (objects ?? []).find((candidate) => candidate.name === name);
    if (!object) throw new Error("Uploaded source object was not found.");

    const storedSize = Number(
      (object.metadata as Record<string, unknown> | null)?.["size"] ??
        session.expected_size_bytes,
    );
    if (
      Number.isFinite(storedSize) &&
      storedSize !== Number(session.expected_size_bytes)
    ) {
      await admin.storage.from(SOURCE_BUCKET).remove([session.storage_path]);
      throw new Error("Uploaded source size does not match the authorized upload.");
    }

    const { data: source, error: sourceError } = await admin
      .from("source_files")
      .insert({
        original_filename: session.original_filename,
        mime_type: session.mime_type,
        size_bytes: session.expected_size_bytes,
        storage_path: session.storage_path,
        keep_original: session.keep_original,
        metadata: {
          storage_adapter: "supabase",
          upload_session_id: session.id,
        },
      })
      .select("id")
      .single();
    if (sourceError || !source) {
      throw new Error(sourceError?.message ?? "Could not save source file metadata.");
    }

    await admin
      .from("source_upload_sessions")
      .update({
        finalized_at: new Date().toISOString(),
        source_file_id: source.id,
      })
      .eq("id", session.id);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "source_uploaded",
      entity_type: "source_file",
      entity_id: source.id,
      summary: `Uploaded source "${session.original_filename}"`,
    });

    return { sourceFileId: source.id };
  });

export const startDocumentImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        sourceFileId: z.string().uuid(),
        mode: z.enum(["review", "auto"]).default("review"),
        profileId: z.string().uuid().nullable().default(null),
        expectedContent: z
          .enum(["auto", "questions", "vocabulary", "readings", "listenings", "mixed"])
          .default("auto"),
        learningLanguage: z.string().trim().min(2).max(10).nullable().default(null),
        translationLanguage: z.string().trim().min(2).max(10).nullable().default(null),
        autoEnrichVocabulary: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: source, error: sourceError } = await admin
      .from("source_files")
      .select("id,original_filename,mime_type,storage_path,deleted_at")
      .eq("id", data.sourceFileId)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!source || source.deleted_at || !source.storage_path) {
      throw new Error("Source file is not available.");
    }

    let profile: Record<string, unknown> | null =
      data.expectedContent === "auto" &&
      !data.learningLanguage &&
      !data.translationLanguage
        ? null
        : {
            ...(data.expectedContent === "auto"
              ? {}
              : { expected_content: data.expectedContent }),
            ...(data.learningLanguage
              ? { learning_language: data.learningLanguage.toLowerCase() }
              : {}),
            ...(data.translationLanguage
              ? { translation_language: data.translationLanguage.toLowerCase() }
              : {}),
          };
    if (data.profileId) {
      const { data: profileRow, error: profileError } = await admin
        .from("import_profiles")
        .select("id,config")
        .eq("id", data.profileId)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);
      if (!profileRow) throw new Error("Import profile not found.");
      const savedProfile =
        profileRow.config && typeof profileRow.config === "object"
          ? (profileRow.config as Record<string, unknown>)
          : {};
      profile =
        data.expectedContent === "auto"
          ? savedProfile
          : { ...savedProfile, expected_content: data.expectedContent };
    }

    const autoEnrichVocabulary =
      data.autoEnrichVocabulary ||
      (profile?.["auto_enrich_vocabulary"] === true);

    const { data: signed, error: signedError } = await admin.storage
      .from(SOURCE_BUCKET)
      .createSignedUrl(source.storage_path, 60 * 60);
    if (signedError || !signed) {
      throw new Error(signedError?.message ?? "Could not authorize source processing.");
    }

    const service = getProcessingService();
    const submitted = await service.submitDocumentImport({
      sourceFileId: source.id,
      sourceUrl: signed.signedUrl,
      filename: source.original_filename,
      mimeType: source.mime_type,
      profile,
      mode: data.mode,
    });
    if (submitted.status === "not_implemented" || !submitted.jobId) {
      throw new Error(
        submitted.message ?? "External processing service is not configured.",
      );
    }

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .insert({
        source_file_id: source.id,
        profile_id: data.profileId,
        status: submitted.status === "processing" ? "processing" : "queued",
        mode: data.mode,
        progress: submitted.progress ?? 0,
        processor_job_id: submitted.jobId,
        stats: {
          import_options: {
            auto_determine_vocabulary_metadata: true,
            auto_enrich_vocabulary: autoEnrichVocabulary,
          },
          vocabulary_metadata_cursor: 0,
        },
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create import job.");
    }

    return { jobId: job.id };
  });

type ImportStats = Record<string, unknown>;

function importJobStats(value: unknown): ImportStats {
  return value && typeof value === "object"
    ? (value as ImportStats)
    : {};
}

function importJobOptions(stats: ImportStats) {
  const raw =
    stats["import_options"] && typeof stats["import_options"] === "object"
      ? (stats["import_options"] as Record<string, unknown>)
      : {};
  return {
    autoDetermineVocabularyMetadata:
      raw["auto_determine_vocabulary_metadata"] !== false,
    autoEnrichVocabulary: raw["auto_enrich_vocabulary"] === true,
  };
}

function mergeImportVocabularySuggestion(
  raw: z.infer<typeof vocabularyImportPayloadSchema>,
  suggestion: Awaited<
    ReturnType<
      typeof import("./dictionary-vocabulary").fetchBestDictionaryVocabularySuggestion
    >
  >,
) {
  const translationMap = new Map(
    raw.translations.map((item) => [
      item.language.toLowerCase(),
      { ...item, language: item.language.toLowerCase() },
    ]),
  );
  for (const item of suggestion.translations) {
    const language = item.language.toLowerCase();
    if (!translationMap.has(language) && item.value.trim()) {
      translationMap.set(language, {
        language,
        value: item.value,
      });
    }
  }

  const exampleMap = new Map(
    raw.examples.map((item) => [
      item.sentence.trim().toLowerCase(),
      item,
    ]),
  );
  for (const item of suggestion.examples) {
    const key = item.sentence.trim().toLowerCase();
    if (key && !exampleMap.has(key)) {
      exampleMap.set(key, item);
    }
  }

  return {
    ...raw,
    definition: raw.definition?.trim()
      ? raw.definition
      : suggestion.definition,
    ipa: raw.ipa?.trim() ? raw.ipa : suggestion.ipa,
    part_of_speech: raw.part_of_speech?.trim()
      ? raw.part_of_speech
      : suggestion.part_of_speech,
    level: raw.level?.trim() ? raw.level : suggestion.level,
    synonyms: [
      ...new Set([...raw.synonyms, ...suggestion.synonyms]),
    ].slice(0, 100),
    antonyms: [
      ...new Set([...raw.antonyms, ...suggestion.antonyms]),
    ].slice(0, 100),
    translations: [...translationMap.values()].slice(0, 50),
    examples: [...exampleMap.values()].slice(0, 100),
    import_mapping: {
      ...(raw.import_mapping ?? {}),
      automatic_metadata: {
        status: "done",
        provider: suggestion.provider,
        model: suggestion.model,
        generated_at: suggestion.generated_at,
        full_enrichment: true,
      },
    },
  };
}

async function processVocabularyImportMetadataBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  jobId: string,
  statsValue: unknown,
) {
  const stats = importJobStats(statsValue);
  const options = importJobOptions(stats);
  if (!options.autoDetermineVocabularyMetadata) {
    return { done: true, stats };
  }

  const cursorRaw = Number(stats["vocabulary_metadata_cursor"] ?? 0);
  const cursor =
    Number.isFinite(cursorRaw) && cursorRaw >= 0
      ? Math.floor(cursorRaw)
      : 0;

  const { count, error: countError } = await admin
    .from("import_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("item_type", "vocabulary");
  if (countError) throw new Error(countError.message);
  const total = count ?? 0;
  if (cursor >= total) {
    return {
      done: true,
      stats: {
        ...stats,
        vocabulary_metadata_cursor: total,
        vocabulary_metadata_total: total,
      },
    };
  }

  const { data: rows, error } = await admin
    .from("import_items")
    .select("id,payload")
    .eq("job_id", jobId)
    .eq("item_type", "vocabulary")
    .order("created_at")
    .range(cursor, Math.min(total - 1, cursor + 199));
  if (error) throw new Error(error.message);

  const parsedRows = (rows ?? []).flatMap(
    (row: { id: string; payload: unknown }) => {
      const parsed = vocabularyImportPayloadSchema.safeParse(row.payload);
      return parsed.success ? [{ id: row.id, raw: parsed.data }] : [];
    },
  );

  const work: typeof parsedRows = [];
  let scanned = 0;
  for (const row of parsedRows) {
    const language = row.raw.learning_language.toLowerCase().split("-")[0];
    const needsBasic =
      language === "en" &&
      (!row.raw.part_of_speech?.trim() || !row.raw.level?.trim());
    const needsLookup =
      needsBasic ||
      (options.autoEnrichVocabulary && language === "en");
    scanned += 1;
    if (needsLookup) work.push(row);
    if (work.length >= 16) break;
  }

  // If parsing skipped any rows, still advance through the fetched slice.
  if (scanned === 0 && (rows?.length ?? 0) > 0) {
    scanned = rows!.length;
  } else if (work.length < 16 && scanned < (rows?.length ?? 0)) {
    // No lookup pressure: advance across the rest of this 200-row window.
    scanned = rows!.length;
  }

  if (work.length) {
    const { fetchBestDictionaryVocabularySuggestion, fetchDatamuseLexicalMetadata } =
      await import("./dictionary-vocabulary");

    const { data: languageRows, error: languageError } = await admin
      .from("languages")
      .select("code")
      .eq("is_translation", true)
      .order("sort_order");
    if (languageError) throw new Error(languageError.message);
    const targetLanguages = (languageRows ?? [])
      .map((row: { code: string }) => row.code.toLowerCase())
      .filter(Boolean);

    for (let offset = 0; offset < work.length; offset += 4) {
      const batch = work.slice(offset, offset + 4);
      await Promise.all(
        batch.map(async ({ id, raw }) => {
          const language = raw.learning_language.toLowerCase().split("-")[0];
          let next = raw;

          if (options.autoEnrichVocabulary) {
            const suggestion = await fetchBestDictionaryVocabularySuggestion(
              raw.word,
              {
                language,
                targetLanguages,
              },
            ).catch(() => null);
            if (suggestion) {
              next = mergeImportVocabularySuggestion(raw, suggestion);
            }
          } else {
            const lexical = await fetchDatamuseLexicalMetadata(raw.word).catch(
              () => null,
            );
            if (lexical) {
              next = {
                ...raw,
                part_of_speech: raw.part_of_speech?.trim()
                  ? raw.part_of_speech
                  : lexical.partOfSpeech,
                level: raw.level?.trim() ? raw.level : lexical.level,
                import_mapping: {
                  ...(raw.import_mapping ?? {}),
                  automatic_metadata: {
                    status: "done",
                    provider: "datamuse",
                    generated_at: new Date().toISOString(),
                    full_enrichment: false,
                  },
                },
              };
            }
          }

          if (next !== raw) {
            const { error: updateError } = await admin
              .from("import_items")
              .update({ payload: next as never })
              .eq("id", id);
            if (updateError) throw new Error(updateError.message);
          }
        }),
      );
    }
  }

  const nextCursor = Math.min(total, cursor + scanned);
  return {
    done: nextCursor >= total,
    stats: {
      ...stats,
      vocabulary_metadata_cursor: nextCursor,
      vocabulary_metadata_total: total,
      vocabulary_metadata_full_enrichment:
        options.autoEnrichVocabulary,
    },
  };
}

export const syncDocumentImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient, sha256 } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .select("id,processor_job_id,status,stats")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job?.processor_job_id) throw new Error("Import job is not linked to a processor.");

    if (["completed", "failed", "needs_review"].includes(job.status)) {
      return { status: job.status };
    }

    const state = await getProcessingService().getImportStatus(job.processor_job_id);
    const mappedStatus =
      state.status === "not_implemented" ? "failed" : state.status;

    if (
      (mappedStatus === "needs_review" || mappedStatus === "completed") &&
      state.items
    ) {
      const { count, error: countError } = await admin
        .from("import_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id);
      if (countError) throw new Error(countError.message);

      if (!count) {
        const prepared = await prepareItems(admin, job.id, state.items, sha256);
        if (prepared.length) {
          const { error } = await admin
            .from("import_items")
            .insert(prepared as never);
          if (error) throw new Error(error.message);
        }
      }
    }

    const currentStats = importJobStats(job.stats);
    let nextStats: ImportStats = {
      ...currentStats,
      processor_stats: state.stats ?? {},
    };
    let finalStatus = mappedStatus;
    let finalProgress = state.progress ?? 0;

    if (
      (mappedStatus === "needs_review" || mappedStatus === "completed") &&
      importJobOptions(currentStats).autoDetermineVocabularyMetadata
    ) {
      const metadata = await processVocabularyImportMetadataBatch(
        admin,
        job.id,
        currentStats,
      );
      nextStats = {
        ...metadata.stats,
        processor_stats: state.stats ?? {},
      };
      if (!metadata.done) {
        finalStatus = "processing";
        const cursor = Number(
          metadata.stats["vocabulary_metadata_cursor"] ?? 0,
        );
        const total = Number(
          metadata.stats["vocabulary_metadata_total"] ?? 0,
        );
        finalProgress =
          total > 0
            ? Math.min(99, 80 + Math.floor((cursor / total) * 19))
            : 99;
      }
    }

    // Persist the terminal job state only after extracted review items and
    // automatic vocabulary metadata are durable.
    const { error: updateError } = await admin
      .from("import_jobs")
      .update({
        status: finalStatus,
        progress: finalProgress,
        extraction_method: state.extractionMethod ?? null,
        error: state.error ?? state.message ?? null,
        stats: nextStats as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (updateError) throw new Error(updateError.message);

    if (
      finalStatus === "needs_review" ||
      finalStatus === "completed" ||
      finalStatus === "failed"
    ) {
      const { notifyTeacher } = await import("./notifications.functions");
      const itemCount = state.items?.length ?? 0;
      await notifyTeacher(admin, {
        kind:
          finalStatus === "failed"
            ? "import_failed"
            : finalStatus === "needs_review"
              ? "import_review_required"
              : "import_processing_completed",
        title:
          finalStatus === "failed"
            ? "Document import failed"
            : finalStatus === "needs_review"
              ? "Document import is ready for review"
              : "Document processing completed",
        body:
          finalStatus === "failed"
            ? state.error ?? state.message ?? "The processing worker reported an error."
            : `${itemCount} extracted item(s) are available.`,
        link: "/teacher/sources",
        data: {
          import_job_id: job.id,
          processor_job_id: job.processor_job_id,
          status: finalStatus,
          item_count: itemCount,
        },
        dedupeKey: `import-job:${job.id}:${finalStatus}`,
      });
    }

    return { status: finalStatus };
  });

export const listDocumentImports = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("import_jobs")
      .select(
        "id,status,mode,progress,extraction_method,error,stats,created_at,updated_at,source_files(id,original_filename,mime_type,size_bytes,keep_original)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getDocumentImport = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [jobResult, itemsResult] = await Promise.all([
      context.supabase
        .from("import_jobs")
        .select(
          "id,status,mode,progress,extraction_method,error,stats,created_at,updated_at,source_files(id,original_filename,mime_type,size_bytes,keep_original,storage_path)",
        )
        .eq("id", data.jobId)
        .maybeSingle(),
      context.supabase
        .from("import_items")
        .select("*")
        .eq("job_id", data.jobId)
        .order("page", { ascending: true, nullsFirst: false })
        .order("created_at"),
    ]);
    if (jobResult.error) throw new Error(jobResult.error.message);
    if (itemsResult.error) throw new Error(itemsResult.error.message);
    if (!jobResult.data) throw new Error("Import job not found.");
    return {
      job: jobResult.data,
      items: (itemsResult.data ?? []).map((item) => ({
        ...item,
        validation: item.created_entity_id
          ? { state: "imported" as const, message: null }
          : item.duplicate_of
            ? {
                state: "duplicate" as const,
                message: "This item matches content that already exists.",
              }
            : validateImportItemPayload(item.item_type, item.payload),
      })),
    };
  });

export const getSourcePreviewUrl = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: job, error } = await admin
      .from("import_jobs")
      .select("source_files(storage_path,mime_type,original_filename)")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const source = job?.source_files as unknown as {
      storage_path: string | null;
      mime_type: string | null;
      original_filename: string;
    } | null;
    if (!source?.storage_path) {
      return {
        url: null as string | null,
        mimeType: source?.mime_type ?? null,
        filename: source?.original_filename ?? "",
        expiresIn: null as number | null,
      };
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(SOURCE_BUCKET)
      .createSignedUrl(source.storage_path, 15 * 60);
    if (signedError || !signed) {
      throw new Error(signedError?.message ?? "Could not create source preview URL.");
    }

    return {
      url: signed.signedUrl as string | null,
      mimeType: source.mime_type,
      filename: source.original_filename,
      expiresIn: 15 * 60 as number | null,
    };
  });

export const updateImportItem = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["pending", "approved", "rejected"]),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: currentError } = await context.supabase
      .from("import_items")
      .select("item_type,payload,duplicate_of,created_entity_id")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("Import item not found.");

    const payload = data.payload ?? current.payload;
    if (data.decision === "approved") {
      if (current.duplicate_of) {
        throw new Error("This item is a duplicate and cannot be approved.");
      }
      if (current.created_entity_id) {
        throw new Error("This item has already been imported.");
      }
      const validation = validateImportItemPayload(current.item_type, payload);
      if (validation.state !== "ready") {
        throw new Error(
          `Cannot approve this item yet: ${validation.message}`,
        );
      }
    }

    const update: Record<string, unknown> = {
      decision: data.decision,
      ...(data.payload ? { payload: data.payload } : {}),
    };
    const { error } = await context.supabase
      .from("import_items")
      .update(update as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveAllReadyItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: candidates, error: candidateError } = await context.supabase
      .from("import_items")
      .select("id,item_type,payload,duplicate_of,created_entity_id")
      .eq("job_id", data.jobId)
      .eq("decision", "pending");
    if (candidateError) throw new Error(candidateError.message);

    const readyIds = (candidates ?? [])
      .filter(
        (item) =>
          !item.duplicate_of &&
          !item.created_entity_id &&
          validateImportItemPayload(item.item_type, item.payload).state ===
            "ready",
      )
      .map((item) => item.id);

    if (readyIds.length) {
      await updateImportItemDecisionInChunks(
        context.supabase,
        readyIds,
        "approved",
      );
    }

    return {
      approved: readyIds.length,
      skipped: (candidates?.length ?? 0) - readyIds.length,
    };
  });

export const approveHighConfidenceItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ jobId: z.string().uuid(), threshold: z.number().min(0.5).max(1).default(0.9) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: candidates, error: candidateError } = await context.supabase
      .from("import_items")
      .select("id,item_type,payload,duplicate_of,created_entity_id")
      .eq("job_id", data.jobId)
      .eq("decision", "pending")
      .gte("confidence", data.threshold)
      .is("duplicate_of", null);
    if (candidateError) throw new Error(candidateError.message);

    const readyIds = (candidates ?? [])
      .filter(
        (item) =>
          !item.created_entity_id &&
          validateImportItemPayload(item.item_type, item.payload).state ===
            "ready",
      )
      .map((item) => item.id);

    if (readyIds.length) {
      await updateImportItemDecisionInChunks(
        context.supabase,
        readyIds,
        "approved",
      );
    }

    return {
      approved: readyIds.length,
      needsReview: (candidates?.length ?? 0) - readyIds.length,
    };
  });

export const commitDocumentImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, sha256, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .select("id,source_file_id,status,source_files(storage_path,keep_original)")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job?.source_file_id) {
      throw new Error("Import job or source file not found.");
    }

    const { data: items, error: itemsError } = await admin
      .from("import_items")
      .select("*")
      .eq("job_id", data.jobId)
      .eq("decision", "approved")
      .order("page", { ascending: true, nullsFirst: false })
      .order("created_at");
    if (itemsError) throw new Error(itemsError.message);

    const approvedRows = items ?? [];
    const invalidApproved = approvedRows.filter(
      (item) =>
        !!item.duplicate_of ||
        validateImportItemPayload(item.item_type, item.payload).state !== "ready",
    );
    if (invalidApproved.length) {
      await updateImportItemDecisionInChunks(
        admin,
        invalidApproved.map((item) => item.id),
        "pending",
      );
    }

    const approvedItems = approvedRows.filter(
      (item) =>
        !item.duplicate_of &&
        validateImportItemPayload(item.item_type, item.payload).state === "ready",
    );

    const unimportedApproved = approvedItems.filter(
      (item) => !item.created_entity_id,
    );
    const pureVocabularyImport =
      unimportedApproved.length > 0 &&
      approvedItems.every((item) => item.item_type === "vocabulary");

    if (pureVocabularyImport) {
      const batch = unimportedApproved.slice(0, 500);
      const entryRows = batch.map((item) => {
        const raw = vocabularyImportPayloadSchema.parse(item.payload);
        return {
          word: raw.word,
          learning_language: raw.learning_language.toLowerCase(),
          definition: raw.definition || null,
          ipa: raw.ipa || null,
          part_of_speech: raw.part_of_speech || null,
          synonyms: [
            ...new Set(
              raw.synonyms.map((value) => value.trim()).filter(Boolean),
            ),
          ],
          antonyms: [
            ...new Set(
              raw.antonyms.map((value) => value.trim()).filter(Boolean),
            ),
          ],
          level: raw.level || null,
          notes: raw.notes || null,
          source_file_id: job.source_file_id,
          provenance: {
            import: {
              job_id: job.id,
              import_item_id: item.id,
              page: item.page ?? null,
              sheet: item.sheet ?? null,
              confidence: item.confidence ?? null,
              original: {
                word: raw.word,
                definition: raw.definition || null,
                ipa: raw.ipa || null,
                part_of_speech: raw.part_of_speech || null,
                level: raw.level || null,
                notes: raw.notes || null,
              },
            },
          },
          status: raw.status,
        };
      });

      const createdRows: Array<{
        id: string;
        provenance: unknown;
      }> = [];
      for (const entryBatch of chunks(entryRows, 100)) {
        const { data: created, error: createError } = await admin
          .from("vocabulary_entries")
          .insert(entryBatch as never)
          .select("id,provenance");
        if (createError) throw new Error(createError.message);
        createdRows.push(
          ...((created ?? []) as Array<{
            id: string;
            provenance: unknown;
          }>),
        );
      }

      const itemToEntity = new Map<string, string>();
      for (const row of createdRows) {
        const provenance =
          row.provenance && typeof row.provenance === "object"
            ? (row.provenance as Record<string, unknown>)
            : {};
        const importMeta =
          provenance["import"] && typeof provenance["import"] === "object"
            ? (provenance["import"] as Record<string, unknown>)
            : {};
        const itemId =
          typeof importMeta["import_item_id"] === "string"
            ? importMeta["import_item_id"]
            : "";
        if (itemId) itemToEntity.set(itemId, row.id);
      }
      if (itemToEntity.size !== batch.length) {
        throw new Error(
          "Vocabulary bulk import could not map all created entries back to source rows.",
        );
      }

      const translationRows: Record<string, unknown>[] = [];
      const exampleRows: Record<string, unknown>[] = [];
      const sourceRows: Record<string, unknown>[] = [];
      const tagNames = new Set<string>();
      const tagsByItem = new Map<string, string[]>();

      for (const item of batch) {
        const raw = vocabularyImportPayloadSchema.parse(item.payload);
        const entryId = itemToEntity.get(item.id)!;

        const translationMap = new Map(
          raw.translations.map((translation) => [
            translation.language.toLowerCase(),
            {
              language: translation.language.toLowerCase(),
              value: translation.value,
            },
          ]),
        );
        for (const translation of translationMap.values()) {
          translationRows.push({
            entry_id: entryId,
            language: translation.language,
            value: translation.value,
          });
        }

        raw.examples.forEach((example, index) => {
          exampleRows.push({
            entry_id: entryId,
            sentence: example.sentence,
            translation: example.translation || null,
            sort_order: index,
          });
        });

        const normalizedTags = [
          ...new Set(
            raw.tags
              .map((value) => value.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
        tagsByItem.set(item.id, normalizedTags);
        normalizedTags.forEach((name) => tagNames.add(name));

        sourceRows.push({
          source_file_id: job.source_file_id,
          entity_type: "vocabulary",
          entity_id: entryId,
        });
      }

      await insertRowsInChunks(
        admin,
        "vocabulary_translations",
        translationRows,
      );
      await insertRowsInChunks(admin, "vocabulary_examples", exampleRows);
      await upsertRowsInChunks(
        admin,
        "source_collection_items",
        sourceRows,
        {
          onConflict: "source_file_id,entity_type,entity_id",
          ignoreDuplicates: true,
        },
      );

      if (tagNames.size) {
        await upsertRowsInChunks(
          admin,
          "tags",
          [...tagNames].map((name) => ({ name })),
          { onConflict: "name", ignoreDuplicates: true },
        );

        const tagIdByName = new Map<string, string>();
        for (const nameBatch of chunks([...tagNames], 120)) {
          const { data: tagRows, error: tagError } = await admin
            .from("tags")
            .select("id,name")
            .in("name", nameBatch);
          if (tagError) throw new Error(tagError.message);
          for (const tag of tagRows ?? []) {
            tagIdByName.set(tag.name, tag.id);
          }
        }

        const relationRows: Record<string, unknown>[] = [];
        for (const item of batch) {
          const entryId = itemToEntity.get(item.id)!;
          for (const name of tagsByItem.get(item.id) ?? []) {
            const tagId = tagIdByName.get(name);
            if (tagId) {
              relationRows.push({
                entry_id: entryId,
                tag_id: tagId,
              });
            }
          }
        }
        await insertRowsInChunks(admin, "vocabulary_tags", relationRows);
      }

      const links = batch.map((item) => ({
        item_id: item.id,
        entity_id: itemToEntity.get(item.id)!,
      }));
      const { error: linkError } = await admin.rpc(
        "bulk_link_import_entities",
        { _links: links as never },
      );
      if (linkError) throw new Error(linkError.message);

      const [
        { count: remainingPending, error: pendingError },
        { count: remainingApproved, error: approvedError },
      ] = await Promise.all([
        admin
          .from("import_items")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .eq("decision", "pending"),
        admin
          .from("import_items")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .eq("decision", "approved")
          .is("created_entity_id", null),
      ]);
      if (pendingError) throw new Error(pendingError.message);
      if (approvedError) throw new Error(approvedError.message);

      const completed =
        (remainingPending ?? 0) === 0 &&
        (remainingApproved ?? 0) === 0;

      await admin
        .from("import_jobs")
        .update({
          status: completed ? "completed" : "needs_review",
          progress: 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const source = job.source_files as unknown as {
        storage_path: string | null;
        keep_original: boolean;
      } | null;
      let originalDeleted = false;
      if (completed && source?.storage_path && !source.keep_original) {
        const { error: removeError } = await admin.storage
          .from(SOURCE_BUCKET)
          .remove([source.storage_path]);
        if (removeError) throw new Error(removeError.message);
        const { error: sourceUpdateError } = await admin
          .from("source_files")
          .update({
            storage_path: null,
            original_deleted_at: new Date().toISOString(),
          })
          .eq("id", job.source_file_id);
        if (sourceUpdateError) throw new Error(sourceUpdateError.message);
        originalDeleted = true;
      }

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "document_import_vocabulary_batch_committed",
        entity_type: "import_job",
        entity_id: job.id,
        summary: `Imported ${batch.length} vocabulary item(s) from a large document batch`,
        details: {
          imported_vocabulary: batch.length,
          remaining_pending: remainingPending ?? 0,
          remaining_approved: remainingApproved ?? 0,
          completed,
        },
      });

      return {
        imported: batch.length,
        importedQuestions: 0,
        importedVocabulary: batch.length,
        importedReadings: 0,
        importedListenings: 0,
        skipped: 0,
        needsFix: invalidApproved.length,
        remainingPending: remainingPending ?? 0,
        remainingApproved: remainingApproved ?? 0,
        completed,
        originalDeleted,
      };
    }

    const readingContexts = new Map<
      string,
      {
        readingId: string;
        questionSetId: string;
        status: "draft" | "active";
      }
    >();
    const listeningContexts = new Map<
      string,
      {
        listeningId: string;
        questionSetId: string;
        status: "draft" | "active";
      }
    >();

    let importedQuestions = 0;
    let importedVocabulary = 0;
    let importedReadings = 0;
    let importedListenings = 0;
    let skipped = 0;

    // Context entities must exist before their dependent questions are inserted.
    for (const item of approvedItems) {
      if (item.item_type !== "reading") continue;

      const raw = readingImportPayloadSchema.parse(item.payload);

      let readingId = item.created_entity_id;
      if (!readingId) {
        const wordCount = raw.body.split(/\s+/).filter(Boolean).length;
        const { data: createdReading, error: readingError } = await admin
          .from("readings")
          .insert({
            title: raw.title,
            body: raw.body,
            learning_language: raw.learning_language ?? "en",
            level: raw.level ?? null,
            word_count: wordCount,
            display_layout: raw.display_layout,
            status: raw.status,
            source_file_id: job.source_file_id,
            metadata: {
              ...raw.metadata,
              import_job_id: job.id,
              import_item_id: item.id,
              source_page: item.page,
              source_crop: item.crop,
              extraction: "document_import",
            },
          } as never)
          .select("id")
          .single();
        if (readingError || !createdReading) {
          throw new Error(
            readingError?.message ?? "Could not create imported reading.",
          );
        }
        readingId = createdReading.id;

        await admin
          .from("import_items")
          .update({ created_entity_id: readingId })
          .eq("id", item.id);

        await admin.from("source_collection_items").upsert({
          source_file_id: job.source_file_id,
          entity_type: "reading",
          entity_id: readingId,
        });

        importedReadings += 1;
      }

      const { data: existingSets, error: existingSetError } = await admin
        .from("reading_question_sets")
        .select("id")
        .eq("reading_id", readingId)
        .order("sort_order")
        .limit(1);
      if (existingSetError) throw new Error(existingSetError.message);

      let questionSetId = existingSets?.[0]?.id ?? null;
      if (!questionSetId) {
        const { data: createdSet, error: setError } = await admin
          .from("reading_question_sets")
          .insert({
            reading_id: readingId,
            title: "Imported questions",
            instructions: null,
            sort_order: 0,
          })
          .select("id")
          .single();
        if (setError || !createdSet) {
          throw new Error(
            setError?.message ?? "Could not create reading question set.",
          );
        }
        questionSetId = createdSet.id;
      }

      readingContexts.set(raw.source_ref, {
        readingId,
        questionSetId,
        status: raw.status,
      });
    }

    for (const item of approvedItems) {
      if (item.item_type !== "listening") continue;

      const raw = listeningImportPayloadSchema.parse(item.payload);

      let listeningId = item.created_entity_id;
      if (!listeningId) {
        const transcript = raw.transcript.trim();
        const { data: createdListening, error: listeningError } = await admin
          .from("listenings")
          .insert({
            title: raw.title,
            media_id: null,
            transcript: transcript || null,
            transcript_source: transcript ? "imported" : "none",
            learning_language: raw.learning_language ?? "en",
            level: raw.level ?? null,
            playback_rules: {
              max_plays: null,
              allow_pause: true,
              allow_seek: true,
              allow_rewind: true,
              show_transcript: false,
            },
            status: raw.status,
            source_file_id: job.source_file_id,
            metadata: {
              ...raw.metadata,
              import_job_id: job.id,
              import_item_id: item.id,
              source_page: item.page,
              source_crop: item.crop,
              extraction: "document_import",
            },
          } as never)
          .select("id")
          .single();
        if (listeningError || !createdListening) {
          throw new Error(
            listeningError?.message ?? "Could not create imported listening.",
          );
        }
        listeningId = createdListening.id;

        await admin
          .from("import_items")
          .update({ created_entity_id: listeningId })
          .eq("id", item.id);

        await admin.from("source_collection_items").upsert({
          source_file_id: job.source_file_id,
          entity_type: "listening",
          entity_id: listeningId,
        });

        importedListenings += 1;
      }

      const { data: existingSets, error: existingSetError } = await admin
        .from("listening_question_sets")
        .select("id")
        .eq("listening_id", listeningId)
        .order("sort_order")
        .limit(1);
      if (existingSetError) throw new Error(existingSetError.message);

      let questionSetId = existingSets?.[0]?.id ?? null;
      if (!questionSetId) {
        const { data: createdSet, error: setError } = await admin
          .from("listening_question_sets")
          .insert({
            listening_id: listeningId,
            section_id: null,
            title: "Imported questions",
            instructions: null,
            sort_order: 0,
          })
          .select("id")
          .single();
        if (setError || !createdSet) {
          throw new Error(
            setError?.message ?? "Could not create listening question set.",
          );
        }
        questionSetId = createdSet.id;
      }

      listeningContexts.set(raw.source_ref, {
        listeningId,
        questionSetId,
        status: raw.status,
      });
    }

    for (const item of approvedItems) {
      if (item.item_type !== "vocabulary" || item.created_entity_id) continue;

      const raw = vocabularyImportPayloadSchema.parse(item.payload);
      const synonyms = [
        ...new Set(raw.synonyms.map((value) => value.trim()).filter(Boolean)),
      ];
      const antonyms = [
        ...new Set(raw.antonyms.map((value) => value.trim()).filter(Boolean)),
      ];
      const translations = Array.from(
        new Map(
          raw.translations.map((translation) => [
            translation.language.toLowerCase(),
            {
              language: translation.language.toLowerCase(),
              value: translation.value,
            },
          ]),
        ).values(),
      );
      const tagNames = [
        ...new Set(
          raw.tags.map((value) => value.trim().toLowerCase()).filter(Boolean),
        ),
      ];

      const { data: created, error: createError } = await admin
        .from("vocabulary_entries")
        .insert({
          word: raw.word,
          learning_language: raw.learning_language.toLowerCase(),
          definition: raw.definition || null,
          ipa: raw.ipa || null,
          part_of_speech: raw.part_of_speech || null,
          synonyms,
          antonyms,
          level: raw.level || null,
          notes: raw.notes || null,
          source_file_id: job.source_file_id,
          provenance: {
            import: {
              job_id: job.id,
              import_item_id: item.id,
              page: item.page ?? null,
              sheet: item.sheet ?? null,
              confidence: item.confidence ?? null,
              original: {
                word: raw.word,
                definition: raw.definition || null,
                ipa: raw.ipa || null,
                part_of_speech: raw.part_of_speech || null,
                level: raw.level || null,
                notes: raw.notes || null,
              },
            },
          } as never,
          status: raw.status,
        })
        .select("id")
        .single();
      if (createError || !created) {
        throw new Error(
          createError?.message ?? "Could not create imported vocabulary.",
        );
      }

      if (translations.length) {
        const { error } = await admin.from("vocabulary_translations").insert(
          translations.map((translation) => ({
            entry_id: created.id,
            language: translation.language,
            value: translation.value,
          })),
        );
        if (error) throw new Error(error.message);
      }

      if (raw.examples.length) {
        const { error } = await admin.from("vocabulary_examples").insert(
          raw.examples.map((example, index) => ({
            entry_id: created.id,
            sentence: example.sentence,
            translation: example.translation || null,
            sort_order: index,
          })),
        );
        if (error) throw new Error(error.message);
      }

      if (tagNames.length) {
        const { error: tagUpsertError } = await admin.from("tags").upsert(
          tagNames.map((name) => ({ name })),
          { onConflict: "name", ignoreDuplicates: true },
        );
        if (tagUpsertError) throw new Error(tagUpsertError.message);

        const { data: tagRows, error: tagSelectError } = await admin
          .from("tags")
          .select("id,name")
          .in("name", tagNames);
        if (tagSelectError) throw new Error(tagSelectError.message);
        if (tagRows?.length) {
          const { error } = await admin.from("vocabulary_tags").insert(
            tagRows.map((tag) => ({
              entry_id: created.id,
              tag_id: tag.id,
            })),
          );
          if (error) throw new Error(error.message);
        }
      }

      await admin
        .from("import_items")
        .update({ created_entity_id: created.id })
        .eq("id", item.id);

      await admin.from("source_collection_items").upsert({
        source_file_id: job.source_file_id,
        entity_type: "vocabulary",
        entity_id: created.id,
      });

      importedVocabulary += 1;
    }

    for (const item of approvedItems) {
      if (item.item_type !== "question") {
        if (
          item.item_type !== "vocabulary" &&
          item.item_type !== "reading" &&
          item.item_type !== "listening"
        ) {
          skipped += 1;
        }
        continue;
      }
      if (item.created_entity_id) continue;

      const raw = item.payload as Record<string, unknown>;
      const importContext =
        raw["import_context"] && typeof raw["import_context"] === "object"
          ? (raw["import_context"] as Record<string, unknown>)
          : null;

      const validated = normalizeImportedQuestion(raw);

      const { topicIds: _topics, tags, force: _force, ...fields } =
        validated;
      const contentHash = sha256(
        JSON.stringify([
          fields.question_type,
          fields.prompt.trim().toLowerCase().replace(/\s+/g, " "),
          fields.answer_key,
          fields.payload,
        ]),
      );

      const contextKind =
        importContext?.["kind"] === "reading" ||
        importContext?.["kind"] === "listening"
          ? importContext["kind"]
          : null;
      const sourceRef =
        contextKind && typeof importContext?.["source_ref"] === "string"
          ? importContext["source_ref"]
          : null;
      const readingContext =
        contextKind === "reading" && sourceRef
          ? readingContexts.get(sourceRef) ?? null
          : null;
      const listeningContext =
        contextKind === "listening" && sourceRef
          ? listeningContexts.get(sourceRef) ?? null
          : null;
      const contextSort =
        typeof importContext?.["sort_order"] === "number"
          ? Math.max(0, Math.floor(importContext["sort_order"]))
          : 0;

      const { data: created, error: createError } = await admin
        .from("questions")
        .insert({
          ...fields,
          status:
            readingContext?.status ??
            listeningContext?.status ??
            fields.status,
          current_version: 1,
          context_kind: readingContext
            ? "reading"
            : listeningContext
              ? "listening"
              : "none",
          reading_question_set_id: readingContext?.questionSetId ?? null,
          listening_question_set_id: listeningContext?.questionSetId ?? null,
          context_sort: readingContext || listeningContext ? contextSort : 0,
          reusable_independently: false,
          source_file_id: job.source_file_id,
          source_page: item.page,
          source_sheet: item.sheet,
          import_job_id: job.id,
          provenance: {
            import_item_id: item.id,
            confidence: item.confidence,
            extraction: "document_import",
            source_crop: item.crop,
            import_context: importContext,
            unresolved_reading_context:
              contextKind === "reading" && sourceRef && !readingContext
                ? sourceRef
                : null,
            unresolved_listening_context:
              contextKind === "listening" && sourceRef && !listeningContext
                ? sourceRef
                : null,
          },
          content_hash: contentHash,
        } as never)
        .select("id")
        .single();
      if (createError || !created) {
        throw new Error(
          createError?.message ?? "Could not create imported question.",
        );
      }

      await admin.from("question_versions").insert({
        question_id: created.id,
        version: 1,
        snapshot: {
          ...fields,
          context_kind: readingContext
            ? "reading"
            : listeningContext
              ? "listening"
              : "none",
          reading_question_set_id: readingContext?.questionSetId ?? null,
          listening_question_set_id: listeningContext?.questionSetId ?? null,
          context_sort: readingContext || listeningContext ? contextSort : 0,
        } as never,
      });

      await admin
        .from("import_items")
        .update({ created_entity_id: created.id })
        .eq("id", item.id);

      await admin.from("source_collection_items").upsert({
        source_file_id: job.source_file_id,
        entity_type: "question",
        entity_id: created.id,
      });

      if (tags.length) {
        const uniqueTags = [
          ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
        ];
        if (uniqueTags.length) {
          const { error: tagUpsertError } = await admin.from("tags").upsert(
            uniqueTags.map((name) => ({ name })),
            { onConflict: "name", ignoreDuplicates: true },
          );
          if (tagUpsertError) throw new Error(tagUpsertError.message);

          const { data: tagRows, error: tagSelectError } = await admin
            .from("tags")
            .select("id,name")
            .in("name", uniqueTags);
          if (tagSelectError) throw new Error(tagSelectError.message);

          if (tagRows?.length) {
            const { error: relationError } = await admin
              .from("question_tags")
              .insert(
                tagRows.map((tag) => ({
                  question_id: created.id,
                  tag_id: tag.id,
                })),
              );
            if (relationError) throw new Error(relationError.message);
          }
        }
      }

      importedQuestions += 1;
    }

    const imported =
      importedQuestions +
      importedVocabulary +
      importedReadings +
      importedListenings;

    const [
      { count: remainingPending, error: remainingError },
      { count: remainingApproved, error: remainingApprovedError },
    ] = await Promise.all([
      admin
        .from("import_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("decision", "pending"),
      admin
        .from("import_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("decision", "approved")
        .is("created_entity_id", null),
    ]);
    if (remainingError) throw new Error(remainingError.message);
    if (remainingApprovedError) {
      throw new Error(remainingApprovedError.message);
    }

    const completed =
      (remainingPending ?? 0) === 0 &&
      (remainingApproved ?? 0) === 0;
    await admin
      .from("import_jobs")
      .update({
        status: completed ? "completed" : "needs_review",
        progress: 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    const source = job.source_files as unknown as {
      storage_path: string | null;
      keep_original: boolean;
    } | null;

    let originalDeleted = false;
    if (completed && source?.storage_path && !source.keep_original) {
      const { error: removeError } = await admin.storage
        .from(SOURCE_BUCKET)
        .remove([source.storage_path]);
      if (removeError) throw new Error(removeError.message);

      const { error: sourceUpdateError } = await admin
        .from("source_files")
        .update({
          storage_path: null,
          original_deleted_at: new Date().toISOString(),
        })
        .eq("id", job.source_file_id);
      if (sourceUpdateError) throw new Error(sourceUpdateError.message);
      originalDeleted = true;
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "document_import_committed",
      entity_type: "import_job",
      entity_id: job.id,
      summary: `Imported ${importedQuestions} question(s), ${importedVocabulary} vocabulary item(s), ${importedReadings} reading(s), and ${importedListenings} listening(s) from document review`,
      details: {
        imported,
        imported_questions: importedQuestions,
        imported_vocabulary: importedVocabulary,
        imported_readings: importedReadings,
        imported_listenings: importedListenings,
        skipped,
        needs_fix: invalidApproved.length,
        remaining_pending: remainingPending ?? 0,
        remaining_approved: remainingApproved ?? 0,
        completed,
        original_deleted: originalDeleted,
      },
    });

    const { notifyTeacher } = await import("./notifications.functions");
    await notifyTeacher(admin, {
      kind: "import_committed",
      title: "Document import completed",
      body: completed
        ? `Imported ${importedQuestions} question(s), ${importedVocabulary} vocabulary item(s), ${importedReadings} reading(s), and ${importedListenings} listening(s). ${skipped} item(s) skipped.`
        : `Imported ${imported} ready item(s). ${remainingPending ?? 0} item(s) still need review.`,
      link: "/teacher/sources",
      data: {
        import_job_id: job.id,
        imported_questions: importedQuestions,
        imported_vocabulary: importedVocabulary,
        imported_readings: importedReadings,
        imported_listenings: importedListenings,
        skipped,
      },
      dedupeKey: `import-committed:${job.id}`,
    });

    return {
      imported,
      importedQuestions,
      importedVocabulary,
      importedReadings,
      importedListenings,
      skipped,
      needsFix: invalidApproved.length,
      remainingPending: remainingPending ?? 0,
      remainingApproved: remainingApproved ?? 0,
      completed,
      originalDeleted,
    };
  });

async function prepareItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  jobId: string,
  items: ProcessingImportItem[],
  sha256: (input: string) => string,
) {
  const out: Array<Record<string, unknown>> = [];

  for (const item of items.slice(0, 2000)) {
    let duplicateOf: string | null = null;
    let duplicateKind: string | null = null;

    if (item.item_type === "question") {
      const raw = item.payload ?? {};
      const prompt = typeof raw["prompt"] === "string" ? raw["prompt"] : "";
      const answer = raw["answer_key"] ?? {};
      const payload = raw["payload"] ?? {};
      if (prompt) {
        const hash = sha256(
          JSON.stringify([
            raw["question_type"] ?? "",
            prompt.trim().toLowerCase().replace(/\s+/g, " "),
            answer,
            payload,
          ]),
        );
        const { data: duplicate } = await admin
          .from("questions")
          .select("id")
          .eq("content_hash", hash)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (duplicate) {
          duplicateOf = duplicate.id;
          duplicateKind = "exact";
        }
      }
    }

    if (item.item_type === "vocabulary") {
      const raw = item.payload ?? {};
      const word =
        typeof raw["word"] === "string" ? raw["word"].trim() : "";
      const learningLanguage =
        typeof raw["learning_language"] === "string"
          ? raw["learning_language"].trim().toLowerCase()
          : "en";
      if (word) {
        const { data: duplicate, error: duplicateError } = await admin
          .from("vocabulary_entries")
          .select("id")
          .ilike("word", word)
          .eq("learning_language", learningLanguage)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (duplicateError) throw new Error(duplicateError.message);
        if (duplicate) {
          duplicateOf = duplicate.id;
          duplicateKind = "exact";
        }
      }
    }

    out.push({
      job_id: jobId,
      item_type: item.item_type,
      page: item.page ?? null,
      sheet: item.sheet ?? null,
      crop: (item.crop ?? null) as never,
      payload: item.payload as never,
      confidence: item.confidence ?? null,
      decision: "pending",
      duplicate_of: duplicateOf,
      duplicate_kind: duplicateKind,
    });
  }

  return out;
}
