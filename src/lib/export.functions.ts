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
  "analytics",
  "content_package",
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];
export type ExportFormat = "json" | "xlsx" | "csv" | "pdf";

type TableSpec = {
  key: string;
  table: string;
  select?: string;
  softDelete?: boolean;
  filter?: (query: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const kindSchema = z.enum(EXPORT_KINDS);
const formatSchema = z.enum(["json", "xlsx", "csv", "pdf"]);

const TABLES: Record<ExportKind, TableSpec[]> = {
  questions: [
    {
      key: "questions",
      table: "questions",
      softDelete: true,
      filter: (query) => query.eq("context_kind", "none"),
    },
    { key: "question_versions", table: "question_versions" },
    { key: "question_topics", table: "question_topics" },
    { key: "question_tags", table: "question_tags" },
    { key: "topics", table: "topics" },
    { key: "tags", table: "tags" },
  ],
  vocabulary: [
    { key: "vocabulary_entries", table: "vocabulary_entries", softDelete: true },
    { key: "vocabulary_translations", table: "vocabulary_translations" },
    { key: "vocabulary_examples", table: "vocabulary_examples" },
    { key: "vocabulary_topics", table: "vocabulary_topics" },
    { key: "vocabulary_tags", table: "vocabulary_tags" },
    { key: "topics", table: "topics" },
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
    { key: "exam_listening_plays", table: "exam_listening_plays" },
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
  analytics: [],
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
    { key: "topics", table: "topics" },
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
  analytics: "student_analytics",
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
        includeAnswers: z.boolean().default(false),
        includeExplanations: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.format === "csv" && !PRIMARY_CSV_TABLE[data.kind]) {
      throw new Error("CSV is not available for this export package.");
    }
    if (
      data.format === "pdf" &&
      data.kind !== "analytics" &&
      data.kind !== "questions"
    ) {
      throw new Error(
        "PDF is currently available for Question Bank and Analytics exports.",
      );
    }

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: job, error: jobError } = await admin
      .from("export_jobs")
      .insert({
        kind: data.kind,
        format: data.format,
        params: {
          schema_version: 1,
          include_answers: data.includeAnswers,
          include_explanations: data.includeExplanations,
        },
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

      if (data.kind === "analytics") {
        const analytics = await fetchAnalytics(admin);
        for (const [key, rows] of Object.entries(analytics)) {
          tables[key] = rows;
          rowCounts[key] = rows.length;
        }
      } else {
        for (const spec of TABLES[data.kind]) {
          const rows = await fetchTable(admin, spec, data.includeTrash);
          tables[spec.key] = rows;
          rowCounts[spec.key] = rows.length;
        }
      }

      const exportedAt = new Date().toISOString();
      const artifact = await buildArtifact({
        kind: data.kind,
        format: data.format,
        includeTrash: data.includeTrash,
        exportedAt,
        tables,
        rowCounts,
        includeAnswers: data.includeAnswers,
        includeExplanations: data.includeExplanations,
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
          include_answers: data.includeAnswers,
          include_explanations: data.includeExplanations,
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

async function fetchAnalytics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
) {
  const [questions, catalogs, students] = await Promise.all([
    admin.rpc("teacher_question_analytics", { p_limit: 1000 }),
    admin.rpc("teacher_catalog_analytics", { p_limit: 1000 }),
    admin.rpc("teacher_student_analytics", { p_limit: 5000 }),
  ]);

  for (const result of [questions, catalogs, students]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    question_analytics: (questions.data ?? []) as Record<string, unknown>[],
    catalog_analytics: (catalogs.data ?? []) as Record<string, unknown>[],
    student_analytics: (students.data ?? []) as Record<string, unknown>[],
  };
}

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
  includeAnswers: boolean;
  includeExplanations: boolean;
}) {
  if (input.format === "pdf") {
    const html =
      input.kind === "analytics"
        ? buildAnalyticsPdfHtml({
            exportedAt: input.exportedAt,
            tables: input.tables,
          })
        : input.kind === "questions"
          ? buildQuestionBankPdfHtml({
              exportedAt: input.exportedAt,
              questions: input.tables["questions"] ?? [],
              includeAnswers: input.includeAnswers,
              includeExplanations: input.includeExplanations,
            })
          : null;

    if (!html) {
      throw new Error(
        "PDF is currently available for Question Bank and Analytics exports.",
      );
    }

    const { getProcessingService } = await import("./processing.service");
    const pdf = await getProcessingService().renderPdfReport({ html });
    if (
      pdf.byteLength < 5 ||
      new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-"
    ) {
      throw new Error("Processing service returned an invalid PDF.");
    }

    return {
      body: Buffer.from(pdf),
      mimeType: "application/pdf",
      extension: "pdf",
    };
  }

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


function buildQuestionBankPdfHtml(input: {
  exportedAt: string;
  questions: Record<string, unknown>[];
  includeAnswers: boolean;
  includeExplanations: boolean;
}) {
  const questionBlocks = input.questions
    .map((question, index) => {
      const prompt = String(question["prompt"] ?? "").trim();
      const instructions =
        typeof question["instructions"] === "string"
          ? question["instructions"].trim()
          : "";
      const payload =
        question["payload"] && typeof question["payload"] === "object"
          ? (question["payload"] as Record<string, unknown>)
          : {};
      const answerKey =
        question["answer_key"] && typeof question["answer_key"] === "object"
          ? (question["answer_key"] as Record<string, unknown>)
          : {};
      const options = printableOptions(payload["options"]);
      const meta = [
        typeof question["question_type"] === "string"
          ? humanizeColumn(question["question_type"])
          : null,
        typeof question["level"] === "string" && question["level"]
          ? question["level"]
          : null,
        typeof question["learning_language"] === "string" &&
        question["learning_language"]
          ? String(question["learning_language"]).toUpperCase()
          : null,
      ].filter(Boolean);

      const optionsHtml = options.length
        ? `<ol class="options" type="A">${options
            .map(
              (option) =>
                `<li>${escapeHtml(option.text || option.id)}</li>`,
            )
            .join("")}</ol>`
        : "";

      const answerHtml = input.includeAnswers
        ? `<div class="answer"><strong>Answer:</strong> ${escapeHtml(
            formatQuestionAnswer(answerKey, options),
          )}</div>`
        : "";

      const explanation =
        input.includeExplanations &&
        typeof question["explanation"] === "string" &&
        question["explanation"].trim()
          ? `<div class="explanation"><strong>Explanation:</strong> ${escapeHtml(
              question["explanation"].trim(),
            ).replaceAll("\n", "<br>")}</div>`
          : "";

      return `
        <article class="question">
          <div class="q-head">
            <span class="q-number">${index + 1}.</span>
            <span class="meta">${escapeHtml(meta.join(" · "))}</span>
          </div>
          ${instructions ? `<div class="instructions">${escapeHtml(instructions).replaceAll("\n", "<br>")}</div>` : ""}
          <div class="prompt">${escapeHtml(prompt || "Untitled question").replaceAll("\n", "<br>")}</div>
          ${optionsHtml}
          ${answerHtml}
          ${explanation}
        </article>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FluentForge Question Bank</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.4; }
  h1 { font-size: 19pt; margin: 0 0 2mm; }
  .meta-top { color: #555; font-size: 9pt; margin: 0 0 8mm; }
  .question { margin: 0 0 7mm; page-break-inside: avoid; }
  .q-head { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 1mm; }
  .q-number { font-weight: 700; font-size: 11pt; }
  .meta { color: #666; font-size: 8.5pt; }
  .instructions { color: #555; font-size: 9pt; margin: 0 0 1mm 7mm; }
  .prompt { margin-left: 7mm; white-space: normal; }
  .options { margin: 2mm 0 0 13mm; padding-left: 6mm; }
  .options li { margin: 1mm 0; padding-left: 1mm; }
  .answer, .explanation { margin: 2mm 0 0 7mm; padding: 2mm 3mm; background: #f4f4f4; border-left: 2px solid #999; }
  .explanation { background: #fafafa; color: #333; }
  .empty { color: #666; }
</style>
</head>
<body>
  <h1>FluentForge Question Bank</h1>
  <p class="meta-top">Generated: ${escapeHtml(input.exportedAt)} · ${input.questions.length} question(s)</p>
  ${questionBlocks || '<p class="empty">No questions in this export.</p>'}
</body>
</html>`;
}

function printableOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option, index) => {
      if (typeof option === "string") {
        return { id: String.fromCharCode(97 + index), text: option };
      }
      if (!option || typeof option !== "object") return null;
      const row = option as Record<string, unknown>;
      const id = String(row["id"] ?? String.fromCharCode(97 + index));
      const text = String(row["text"] ?? row["label"] ?? row["value"] ?? "");
      return { id, text };
    })
    .filter(
      (option): option is { id: string; text: string } =>
        !!option && (!!option.id || !!option.text),
    );
}

function formatQuestionAnswer(
  answerKey: Record<string, unknown>,
  options: Array<{ id: string; text: string }>,
) {
  const correct = Array.isArray(answerKey["correct"])
    ? answerKey["correct"].map(String).filter(Boolean)
    : [];
  if (correct.length) {
    const optionMap = new Map(
      options.map((option) => [option.id.toLowerCase(), option.text]),
    );
    return correct
      .map((id) => {
        const text = optionMap.get(id.toLowerCase());
        return text ? `${id.toUpperCase()}) ${text}` : id;
      })
      .join("; ");
  }

  const blanks = Array.isArray(answerKey["blanks"])
    ? answerKey["blanks"]
    : null;
  if (blanks) {
    return blanks
      .map((blank, index) => {
        const accepted = Array.isArray(blank)
          ? blank.map(String).filter(Boolean)
          : [String(blank ?? "")].filter(Boolean);
        return `${index + 1}: ${accepted.join(" / ")}`;
      })
      .join("; ");
  }

  const pairs = Array.isArray(answerKey["pairs"])
    ? answerKey["pairs"]
    : null;
  if (pairs) {
    return pairs
      .map((pair) => {
        if (!pair || typeof pair !== "object") return String(pair ?? "");
        const row = pair as Record<string, unknown>;
        return `${String(row["left"] ?? "")} → ${String(row["right"] ?? "")}`;
      })
      .filter(Boolean)
      .join("; ");
  }

  const order = Array.isArray(answerKey["order"])
    ? answerKey["order"].map(String).filter(Boolean)
    : null;
  if (order?.length) return order.join(" → ");

  for (const key of ["model_answer", "answer", "text"]) {
    const value = answerKey[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "Not specified";
}

function buildAnalyticsPdfHtml(input: {
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}) {
  const sections = [
    ["Question analytics", input.tables["question_analytics"] ?? []],
    ["Catalog analytics", input.tables["catalog_analytics"] ?? []],
    ["Student analytics", input.tables["student_analytics"] ?? []],
  ] as const;

  const body = sections
    .map(([title, rows]) => {
      const columns = rows.length
        ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
        : [];
      const header = columns
        .map((column) => `<th>${escapeHtml(humanizeColumn(column))}</th>`)
        .join("");
      const rowsHtml = rows
        .map(
          (row) =>
            `<tr>${columns
              .map((column) => `<td>${escapeHtml(formatPdfValue(row[column]))}</td>`)
              .join("")}</tr>`,
        )
        .join("");

      return `
        <section>
          <h2>${escapeHtml(title)}</h2>
          <p class="count">${rows.length} row(s)</p>
          ${rows.length
            ? `<table><thead><tr>${header}</tr></thead><tbody>${rowsHtml}</tbody></table>`
            : '<p class="empty">No recorded data.</p>'}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FluentForge Analytics Report</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; color: #111; font-size: 9pt; }
  h1 { font-size: 18pt; margin: 0 0 4mm; }
  h2 { font-size: 13pt; margin: 8mm 0 1mm; page-break-after: avoid; }
  .meta, .count, .empty { color: #555; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { border: 1px solid #bbb; padding: 3px 4px; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #eee; font-weight: 700; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>FluentForge Analytics Report</h1>
  <p class="meta">Generated: ${escapeHtml(input.exportedAt)}</p>
  ${body}
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanizeColumn(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPdfValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
      .replace(/[\\/?*:]/g, "_")
      .replaceAll("[", "_")
      .replaceAll("]", "_")
      .slice(0, 31) || "Sheet";
  if (!existing.includes(base)) return base;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }

  return `Sheet_${existing.length + 1}`.slice(0, 31);
}
