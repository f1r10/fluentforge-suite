import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { validateQuestionInput } from "./question-schema";
import { getProcessingService, type ProcessingImportItem } from "./processing.service";

const SOURCE_BUCKET = "sources";
const MiB = 1024 * 1024;

const readingImportPayloadSchema = z.object({
  source_ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(250_000),
  display_layout: z.enum(["stacked", "split", "tabbed"]).default("split"),
  learning_language: z.string().max(10).nullable().optional(),
  level: z.string().max(20).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const listeningImportPayloadSchema = z.object({
  source_ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  transcript: z.string().max(500_000).default(""),
  learning_language: z.string().max(10).nullable().optional(),
  level: z.string().max(20).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
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
          level: z.string().max(20).nullable().default(null),
          status: z.enum(["draft", "active"]).default("draft"),
          auto_approve_confidence: z.number().min(0.5).max(1).default(0.95),
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
      data.expectedContent === "auto"
        ? null
        : { expected_content: data.expectedContent };
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
        stats: {},
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create import job.");
    }

    return { jobId: job.id };
  });

export const syncDocumentImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient, sha256 } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .select("id,processor_job_id,status")
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

    await admin
      .from("import_jobs")
      .update({
        status: mappedStatus,
        progress: state.progress ?? 0,
        extraction_method: state.extractionMethod ?? null,
        error: state.error ?? state.message ?? null,
        stats: (state.stats ?? {}) as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (
      mappedStatus === "needs_review" ||
      mappedStatus === "completed" ||
      mappedStatus === "failed"
    ) {
      const { notifyTeacher } = await import("./notifications.functions");
      const itemCount = state.items?.length ?? 0;
      await notifyTeacher(admin, {
        kind:
          mappedStatus === "failed"
            ? "import_failed"
            : mappedStatus === "needs_review"
              ? "import_review_required"
              : "import_processing_completed",
        title:
          mappedStatus === "failed"
            ? "Document import failed"
            : mappedStatus === "needs_review"
              ? "Document import is ready for review"
              : "Document processing completed",
        body:
          mappedStatus === "failed"
            ? state.error ?? state.message ?? "The processing worker reported an error."
            : `${itemCount} extracted item(s) are available.`,
        link: "/teacher/sources",
        data: {
          import_job_id: job.id,
          processor_job_id: job.processor_job_id,
          status: mappedStatus,
          item_count: itemCount,
        },
        dedupeKey: `import-job:${job.id}:${mappedStatus}`,
      });
    }

    if (
      (mappedStatus === "needs_review" || mappedStatus === "completed") &&
      state.items
    ) {
      const { count } = await admin
        .from("import_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id);

      if (!count) {
        const prepared = await prepareItems(admin, job.id, state.items, sha256);
        if (prepared.length) {
          const { error } = await admin.from("import_items").insert(prepared as never);
          if (error) throw new Error(error.message);
        }
      }
    }

    return { status: mappedStatus };
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
    return { job: jobResult.data, items: itemsResult.data ?? [] };
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
    const update: Record<string, unknown> = { decision: data.decision };
    if (data.payload) update.payload = data.payload;
    const { error } = await context.supabase
      .from("import_items")
      .update(update as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveHighConfidenceItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ jobId: z.string().uuid(), threshold: z.number().min(0.5).max(1).default(0.9) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("import_items")
      .update({ decision: "approved" })
      .eq("job_id", data.jobId)
      .eq("decision", "pending")
      .gte("confidence", data.threshold)
      .is("duplicate_of", null);
    if (error) throw new Error(error.message);
    return { ok: true };
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

    const approvedItems = items ?? [];
    const readingContexts = new Map<
      string,
      { readingId: string; questionSetId: string }
    >();
    const listeningContexts = new Map<
      string,
      { listeningId: string; questionSetId: string }
    >();

    let importedQuestions = 0;
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
            status: "draft",
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
            status: "draft",
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
      });
    }

    for (const item of approvedItems) {
      if (item.item_type !== "question") {
        if (item.item_type !== "reading" && item.item_type !== "listening") skipped += 1;
        continue;
      }
      if (item.created_entity_id) continue;

      const raw = item.payload as Record<string, unknown>;
      const importContext =
        raw["import_context"] && typeof raw["import_context"] === "object"
          ? (raw["import_context"] as Record<string, unknown>)
          : null;

      const validated = validateQuestionInput({
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
          status: "draft",
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

    const imported = importedQuestions + importedReadings + importedListenings;

    await admin
      .from("import_jobs")
      .update({
        status: "completed",
        progress: 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    const source = job.source_files as unknown as {
      storage_path: string | null;
      keep_original: boolean;
    } | null;

    let originalDeleted = false;
    if (source?.storage_path && !source.keep_original) {
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
      summary: `Imported ${importedQuestions} question(s), ${importedReadings} reading(s), and ${importedListenings} listening(s) from document review`,
      details: {
        imported,
        imported_questions: importedQuestions,
        imported_readings: importedReadings,
        imported_listenings: importedListenings,
        skipped,
        original_deleted: originalDeleted,
      },
    });

    const { notifyTeacher } = await import("./notifications.functions");
    await notifyTeacher(admin, {
      kind: "import_committed",
      title: "Document import completed",
      body: `Imported ${importedQuestions} question(s), ${importedReadings} reading(s), and ${importedListenings} listening(s). ${skipped} item(s) skipped.`,
      link: "/teacher/sources",
      data: {
        import_job_id: job.id,
        imported_questions: importedQuestions,
        imported_readings: importedReadings,
        imported_listenings: importedListenings,
        skipped,
      },
      dedupeKey: `import-committed:${job.id}`,
    });

    return {
      imported,
      importedQuestions,
      importedReadings,
      importedListenings,
      skipped,
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
