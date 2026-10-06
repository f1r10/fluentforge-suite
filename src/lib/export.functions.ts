import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const EXPORT_BUCKET = "exports";
const PAGE_SIZE = 1000;

export const EXPORT_KINDS = [
  "questions",
  "vocabulary",
  "readings",
  "listenings",
  "catalogs",
  "exams",
  "activity",
  "results",
  "students",
  "content_package",
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];
export type ExportFormat = "json" | "xlsx" | "csv";

type TableSpec = {
  key: string;
  table: string;
  select?: string;
  softDelete?: boolean;
  filter?: (query: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const kindSchema = z.enum(EXPORT_KINDS);
const formatSchema = z.enum(["json", "xlsx", "csv"]);

const TABLES: Record<ExportKind, TableSpec[]> = {
  questions: [
    { key: "questions", table: "questions", softDelete: true },
    { key: "question_versions", table: "question_versions" },
    { key: "question_topics", table: "question_topics" },
    { key: "question_tags", table: "question_tags" },
    { key: "topics", table: "topics", softDelete: true },
    { key: "tags", table: "tags" },
  ],
  vocabulary: [
    { key: "vocabulary_entries", table: "vocabulary_entries", softDelete: true },
    { key: "vocabulary_translations", table: "vocabulary_translations" },
    { key: "vocabulary_examples", table: "vocabulary_examples" },
    { key: "vocabulary_topics", table: "vocabulary_topics" },
    { key: "vocabulary_tags", table: "vocabulary_tags" },
    { key: "topics", table: "topics", softDelete: true },
    { key: "tags", table: "tags" },
  ],
  readings: [
    { key: "readings", table: "readings", softDelete: true },
    { key: "reading_question_sets", table: "reading_question_sets" },
    { key: "reading_media", table: "reading_media" },
    {
      key: "reading_questions",
      table: "questions",
      softDelete: true,
      filter: (query) => query.eq("context_kind", "reading"),
    },
  ],
  listenings: [
    { key: "listenings", table: "listenings", softDelete: true },
    { key: "listening_sections", table: "listening_sections" },
    { key: "listening_question_sets", table: "listening_question_sets" },
    {
      key: "listening_questions",
      table: "questions",
      softDelete: true,
      filter: (query) => query.eq("context_kind", "listening"),
    },
  ],
  catalogs: [
    { key: "catalogs", table: "catalogs", softDelete: true },
    { key: "catalog_items", table: "catalog_items" },
    { key: "catalog_assignments", table: "catalog_assignments" },
  ],
  exams: [
    { key: "exams", table: "exams", softDelete: true },
    { key: "exam_sections", table: "exam_sections" },
    { key: "exam_items", table: "exam_items" },
    { key: "exam_assignments", table: "exam_assignments" },
  ],
  activity: [
    { key: "activity_events", table: "activity_events" },
    { key: "audit_logs", table: "audit_logs" },
  ],
  results: [
    { key: "exam_attempts", table: "exam_attempts" },
    { key: "attempt_answers", table: "attempt_answers" },
    { key: "manual_reviews", table: "manual_reviews" },
    { key: "teacher_feedback", table: "teacher_feedback" },
    { key: "question_reports", table: "question_reports" },
  ],
  students: [
    {
      key: "students",
      table: "students",
      select:
        "id,first_name,last_name,username,status,interface_language,last_active_at,created_at,updated_at,deleted_at",
      softDelete: true,
    },
    { key: "groups", table: "groups", softDelete: true },
    { key: "group_memberships", table: "group_memberships" },
    { key: "student_notes", table: "student_notes" },
    { key: "favorites", table: "favorites" },
    { key: "student_vocabulary_state", table: "student_vocabulary_state" },
    { key: "vocabulary_learner_states", table: "vocabulary_learner_states" },
  ],
  content_package: [
    { key: "questions", table: "questions", softDelete: true },
    { key: "question_versions", table: "question_versions" },
    { key: "question_topics", table: "question_topics" },
    { key: "question_tags", table: "question_tags" },
    { key: "vocabulary_entries", table: "vocabulary_entries", softDelete: true },
    { key: "vocabulary_translations", table: "vocabulary_translations" },
    { key: "vocabulary_examples", table: "vocabulary_examples" },
    { key: "vocabulary_topics", table: "vocabulary_topics" },
    { key: "vocabulary_tags", table: "vocabulary_tags" },
    { key: "readings", table: "readings", softDelete: true },
    { key: "reading_question_sets", table: "reading_question_sets" },
    { key: "reading_media", table: "reading_media" },
    { key: "listenings", table: "listenings", softDelete: true },
    { key: "listening_sections", table: "listening_sections" },
    { key: "listening_question_sets", table: "listening_question_sets" },
    { key: "catalogs", table: "catalogs", softDelete: true },
    { key: "catalog_items", table: "catalog_items" },
    { key: "topics", table: "topics", softDelete: true },
    { key: "tags", table: "tags" },
    {
      key: "media_assets",
      table: "media_assets",
      select:
        "id,kind,original_filename,mime_type,size_bytes,duration_seconds,width,height,checksum,metadata,created_at,deleted_at",
      softDelete: true,
    },
  ],
};

const PRIMARY_CSV_TABLE: Partial<Record<ExportKind, string>> = {
  questions: "questions",
  vocabulary: "vocabulary_entries",
  readings: "readings",
  listenings: "listenings",
  catalogs: "catalogs",
  exams: "exams",
  activity: "activity_events",
  results: "exam_attempts",
  students: "students",
};

export const listExports = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("export_jobs")
      .select(
        "id,kind,format,status,storage_path,mime_type,size_bytes,include_trash,row_counts,error,created_at,completed_at,expires_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createExport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        kind: kindSchema,
        format: formatSchema.default("xlsx"),
        includeTrash: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.format === "csv" && !PRIMARY_CSV_TABLE[data.kind]) {
      throw new Error("CSV is not available for this export package.");
    }

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: job, error: jobError } = await admin
      .from("export_jobs")
      .insert({
        kind: data.kind,
        format: data.format,
        params: { schema_version: 1 },
        status: "processing",
        include_trash: data.includeTrash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create export job.");
    }

    try {
      const tables: Record<string, Record<string, unknown>[]> = {};
      const rowCounts: Record<string, number> = {};

      for (const spec of TABLES[data.kind]) {
        const rows = await fetchTable(admin, spec, data.includeTrash);
        tables[spec.key] = rows;
        rowCounts[spec.key] = rows.length;
      }

      const exportedAt = new Date().toISOString();
      const artifact = await buildArtifact({
        kind: data.kind,
        format: data.format,
        includeTrash: data.includeTrash,
        exportedAt,
        tables,
        rowCounts,
      });

      const stamp = exportedAt.replace(/[:.]/g, "-");
      const path = `${data.kind}/${stamp}-${job.id}.${artifact.extension}`;
      const { error: uploadError } = await admin.storage
        .from(EXPORT_BUCKET)
        .upload(path, artifact.body, {
          contentType: artifact.mimeType,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const sizeBytes = artifact.body.byteLength;
      const { error: updateError } = await admin
        .from("export_jobs")
        .update({
          status: "completed",
          storage_path: path,
          mime_type: artifact.mimeType,
          size_bytes: sizeBytes,
          row_counts: rowCounts as never,
          completed_at: new Date().toISOString(),
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "export_created",
        entity_type: "export_job",
        entity_id: job.id,
        summary: `Created ${data.kind} export (${data.format})`,
        details: {
          kind: data.kind,
          format: data.format,
          include_trash: data.includeTrash,
          row_counts: rowCounts,
          size_bytes: sizeBytes,
        },
      });

      const { data: signed, error: signedError } = await admin.storage
        .from(EXPORT_BUCKET)
        .createSignedUrl(path, 15 * 60);
      if (signedError || !signed) {
        throw new Error(
          signedError?.message ?? "Could not create export download URL.",
        );
      }

      return {
        id: job.id,
        url: signed.signedUrl,
        filename: `fluentforge-${data.kind}-${stamp}.${artifact.extension}`,
        expiresIn: 15 * 60,
        rowCounts,
        sizeBytes,
      };
    } catch (error) {
      await admin
        .from("export_jobs")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 5_000) : String(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      throw error;
    }
  });

export const getExportDownload = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error } = await admin
      .from("export_jobs")
      .select("id,kind,format,status,storage_path,expires_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job || job.status !== "completed" || !job.storage_path) {
      throw new Error("Export is not available.");
    }
    if (new Date(job.expires_at).getTime() <= Date.now()) {
      throw new Error("This export has expired. Create a new export.");
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(job.storage_path, 15 * 60);
    if (signedError || !signed) {
      throw new Error(
        signedError?.message ?? "Could not create export download URL.",
      );
    }

    const extension = job.format === "xlsx" ? "xlsx" : job.format;
    return {
      url: signed.signedUrl,
      filename: `fluentforge-${job.kind}.${extension}`,
      expiresIn: 15 * 60,
    };
  });

async function fetchTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  spec: TableSpec,
  includeTrash: boolean,
) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  for (;;) {
    let query = admin
      .from(spec.table)
      .select(spec.select ?? "*")
      .range(offset, offset + PAGE_SIZE - 1);

    if (spec.softDelete && !includeTrash) {
      query = query.is("deleted_at", null);
    }
    if (spec.filter) {
      query = spec.filter(query);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not export ${spec.key}: ${error.message}`);
    }

    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;

    if (offset >= 250_000) {
      throw new Error(
        `Export table ${spec.key} exceeds the current 250,000 row safety limit.`,
      );
    }
  }

  return rows;
}

async function buildArtifact(input: {
  kind: ExportKind;
  format: ExportFormat;
  includeTrash: boolean;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  rowCounts: Record<string, number>;
}) {
  if (input.format === "json") {
    const payload = {
      schema_version: 1,
      product: "FluentForge",
      export_kind: input.kind,
      exported_at: input.exportedAt,
      include_trash: input.includeTrash,
      row_counts: input.rowCounts,
      tables: input.tables,
    };
    const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    return {
      body,
      mimeType: "application/json",
      extension: "json",
    };
  }

  if (input.format === "csv") {
    const tableName = PRIMARY_CSV_TABLE[input.kind];
    if (!tableName) throw new Error("CSV is not available for this export.");
    const rows = input.tables[tableName] ?? [];
    const { utils } = await import("xlsx");
    const sheet = utils.json_to_sheet(rows.map(toSheetRow));
    const csv = utils.sheet_to_csv(sheet);
    return {
      body: Buffer.from(csv, "utf8"),
      mimeType: "text/csv; charset=utf-8",
      extension: "csv",
    };
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  for (const [name, rows] of Object.entries(input.tables)) {
    const sheetRows = rows.length ? rows.map(toSheetRow) : [{ empty: true }];
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      safeSheetName(name, workbook.SheetNames),
    );
  }

  const body = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;

  return {
    body,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  };
}

function toSheetRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value != null && typeof value === "object"
        ? JSON.stringify(value)
        : value ?? "",
    ]),
  );
}

function safeSheetName(name: string, existing: string[]) {
  const base =
    name
      .replace(/[\\/?*\[\]:]/g, "_")
      .slice(0, 31) || "Sheet";
  if (!existing.includes(base)) return base;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }

  return `Sheet_${existing.length + 1}`.slice(0, 31);
}
