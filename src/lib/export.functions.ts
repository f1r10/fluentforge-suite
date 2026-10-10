import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import {
  EXPORT_FORMATS,
  EXPORT_KINDS,
  isExportFormatAllowed,
  type ExportFormat,
  type ExportKind,
} from "./export-formats";

export { EXPORT_FORMATS, EXPORT_KINDS };
export type { ExportFormat, ExportKind };

const EXPORT_BUCKET = "exports";
const PAGE_SIZE = 1000;

type TableSpec = {
  key: string;
  table: string;
  select?: string;
  softDelete?: boolean;
  filter?: (query: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const kindSchema = z.enum(EXPORT_KINDS);
const formatSchema = z.enum(["json", "xlsx", "csv", "pdf", "docx"]);

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
    if (!isExportFormatAllowed(data.kind, data.format)) {
      throw new Error(
        `${data.format.toUpperCase()} is not available for ${data.kind} exports.`,
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
  if (input.format === "pdf" || input.format === "docx") {
    const html = buildPrintableHtml(input);
    if (!html) {
      throw new Error(
        `${input.format.toUpperCase()} is not available for this export.`,
      );
    }

    const { getProcessingService } = await import("./processing.service");
    const processing = getProcessingService();

    if (input.format === "docx") {
      const docx = await processing.renderDocxReport({ html });
      if (
        docx.byteLength < 4 ||
        new TextDecoder().decode(docx.slice(0, 2)) !== "PK"
      ) {
        throw new Error("Processing service returned an invalid DOCX.");
      }
      return {
        body: Buffer.from(docx),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      };
    }

    const pdf = await processing.renderPdfReport({ html });
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

  const sheets = buildFriendlySpreadsheetSheets(input);
  if (!sheets.length) {
    throw new Error("No spreadsheet data is available for this export.");
  }

  const XLSX = await import("xlsx");

  if (input.format === "csv") {
    const sheet = createWorksheet(XLSX.utils, sheets[0]!.rows);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return {
      body: Buffer.from(csv, "utf8"),
      mimeType: "text/csv; charset=utf-8",
      extension: "csv",
    };
  }

  const workbook = XLSX.utils.book_new();
  for (const definition of sheets) {
    const sheet = createWorksheet(XLSX.utils, definition.rows);
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      safeSheetName(definition.name, workbook.SheetNames),
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

type FriendlySheet = {
  name: string;
  rows: Record<string, string | number | boolean>[];
};

function buildPrintableHtml(input: {
  kind: ExportKind;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  includeAnswers: boolean;
  includeExplanations: boolean;
}) {
  if (input.kind === "analytics") {
    return buildAnalyticsPdfHtml({
      exportedAt: input.exportedAt,
      tables: input.tables,
    });
  }
  if (input.kind === "questions") {
    return buildQuestionBankPdfHtml({
      exportedAt: input.exportedAt,
      questions: input.tables["questions"] ?? [],
      includeAnswers: input.includeAnswers,
      includeExplanations: input.includeExplanations,
    });
  }
  if (input.kind === "vocabulary") {
    return buildVocabularyPdfHtml({
      exportedAt: input.exportedAt,
      rows: vocabularySpreadsheetRows(input.tables),
    });
  }
  if (input.kind === "readings") {
    return buildReadingsHtml({
      exportedAt: input.exportedAt,
      readings: input.tables["readings"] ?? [],
      questionSets: input.tables["reading_question_sets"] ?? [],
      questions: input.tables["reading_questions"] ?? [],
    });
  }
  return null;
}

function buildFriendlySpreadsheetSheets(input: {
  kind: ExportKind;
  tables: Record<string, Record<string, unknown>[]>;
  includeAnswers: boolean;
  includeExplanations: boolean;
}): FriendlySheet[] {
  switch (input.kind) {
    case "vocabulary":
      return [{ name: "Vocabulary", rows: vocabularySpreadsheetRows(input.tables) }];
    case "questions":
      return [
        {
          name: "Questions",
          rows: questionSpreadsheetRows(
            input.tables["questions"] ?? [],
            input.tables,
            input.includeAnswers,
            input.includeExplanations,
          ),
        },
      ];
    case "listenings":
      return listeningSpreadsheetSheets(input.tables);
    case "catalogs":
      return catalogSpreadsheetSheets(input.tables);
    case "exams":
      return examSpreadsheetSheets(input.tables);
    case "activity":
      return cleanGenericSheets(input.tables, {
        activity_events: "Activity",
        audit_logs: "Audit log",
      });
    case "results":
      return cleanGenericSheets(input.tables, {
        exam_attempts: "Attempts",
        exam_listening_plays: "Listening plays",
        attempt_answers: "Answers",
        manual_reviews: "Manual reviews",
        teacher_feedback: "Teacher feedback",
        question_reports: "Question reports",
      });
    case "students":
      return studentSpreadsheetSheets(input.tables);
    case "analytics":
      return cleanGenericSheets(input.tables, {
        question_analytics: "Question analytics",
        catalog_analytics: "Catalog analytics",
        student_analytics: "Student analytics",
      });
    case "readings":
    case "content_package":
      return [];
  }
}

function vocabularySpreadsheetRows(
  tables: Record<string, Record<string, unknown>[]>,
): FriendlySheet["rows"] {
  const entries = tables["vocabulary_entries"] ?? [];
  const translations = groupByStringKey(
    tables["vocabulary_translations"] ?? [],
    "entry_id",
  );
  const examples = groupByStringKey(
    tables["vocabulary_examples"] ?? [],
    "entry_id",
  );
  const topicLinks = groupByStringKey(
    tables["vocabulary_topics"] ?? [],
    "entry_id",
  );
  const tagLinks = groupByStringKey(
    tables["vocabulary_tags"] ?? [],
    "entry_id",
  );
  const topicNames = new Map(
    (tables["topics"] ?? []).map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );
  const tagNames = new Map(
    (tables["tags"] ?? []).map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );

  return entries.map((entry, index) => {
    const id = String(entry["id"] ?? "");
    const translationText = (translations.get(id) ?? [])
      .map((row) => {
        const language = String(row["language"] ?? "").toUpperCase();
        const value = String(row["value"] ?? "");
        return language ? `${language}: ${value}` : value;
      })
      .filter(Boolean)
      .join(" | ");
    const exampleText = (examples.get(id) ?? [])
      .sort(
        (a, b) =>
          Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0),
      )
      .map((row) => {
        const sentence = String(row["sentence"] ?? "");
        const translation = String(row["translation"] ?? "");
        return translation ? `${sentence} — ${translation}` : sentence;
      })
      .filter(Boolean)
      .join(" | ");

    const topics = (topicLinks.get(id) ?? [])
      .map((row) => topicNames.get(String(row["topic_id"] ?? "")) ?? "")
      .filter(Boolean)
      .join(", ");
    const tags = (tagLinks.get(id) ?? [])
      .map((row) => tagNames.get(String(row["tag_id"] ?? "")) ?? "")
      .filter(Boolean)
      .join(", ");

    return {
      "No.": index + 1,
      Word: scalar(entry["word"]),
      Language: scalar(entry["learning_language"]).toUpperCase(),
      IPA: scalar(entry["ipa"]),
      "Part of speech": scalar(entry["part_of_speech"]),
      Level: scalar(entry["level"]),
      Definition: scalar(entry["definition"]),
      Translations: translationText,
      Examples: exampleText,
      Synonyms: arrayText(entry["synonyms"]),
      Antonyms: arrayText(entry["antonyms"]),
      Topics: topics,
      Tags: tags,
      Notes: scalar(entry["notes"]),
      Status: scalar(entry["status"]),
    };
  });
}

function questionSpreadsheetRows(
  questions: Record<string, unknown>[],
  tables: Record<string, Record<string, unknown>[]>,
  includeAnswers: boolean,
  includeExplanations: boolean,
): FriendlySheet["rows"] {
  const topicLinks = groupByStringKey(tables["question_topics"] ?? [], "question_id");
  const tagLinks = groupByStringKey(tables["question_tags"] ?? [], "question_id");
  const topicNames = new Map(
    (tables["topics"] ?? []).map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );
  const tagNames = new Map(
    (tables["tags"] ?? []).map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );

  return questions.map((question, index) => {
    const id = String(question["id"] ?? "");
    const payload = objectValue(question["payload"]);
    const answerKey = objectValue(question["answer_key"]);
    const options = printableOptions(payload["options"]);
    const row: Record<string, string | number | boolean> = {
      "No.": index + 1,
      Question: scalar(question["prompt"]),
      Type: humanizeColumn(scalar(question["question_type"])),
      Instructions: scalar(question["instructions"]),
      Language: scalar(question["learning_language"]).toUpperCase(),
      Level: scalar(question["level"]),
      Difficulty: scalar(question["difficulty"]),
      Options: options
        .map((option) => `${option.id.toUpperCase()}) ${option.text}`)
        .join(" | "),
      Points: numericObjectValue(question["scoring"], "points"),
      Topics: (topicLinks.get(id) ?? [])
        .map((link) => topicNames.get(String(link["topic_id"] ?? "")) ?? "")
        .filter(Boolean)
        .join(", "),
      Tags: (tagLinks.get(id) ?? [])
        .map((link) => tagNames.get(String(link["tag_id"] ?? "")) ?? "")
        .filter(Boolean)
        .join(", "),
      Status: scalar(question["status"]),
    };
    if (includeAnswers) {
      row["Correct answer"] = formatQuestionAnswer(answerKey, options);
    }
    if (includeExplanations) {
      row["Explanation"] = scalar(question["explanation"]);
    }
    return row;
  });
}

function listeningSpreadsheetSheets(
  tables: Record<string, Record<string, unknown>[]>,
): FriendlySheet[] {
  const listenings = tables["listenings"] ?? [];
  const sections = groupByStringKey(
    tables["listening_sections"] ?? [],
    "listening_id",
  );
  const sets = tables["listening_question_sets"] ?? [];
  const setToListening = new Map(
    sets.map((row) => [
      String(row["id"] ?? ""),
      String(row["listening_id"] ?? ""),
    ]),
  );
  const listeningNames = new Map(
    listenings.map((row) => [
      String(row["id"] ?? ""),
      String(row["title"] ?? ""),
    ]),
  );
  const main = listenings.map((row, index) => {
    const id = String(row["id"] ?? "");
    const rules = objectValue(row["playback_rules"]);
    return {
      "No.": index + 1,
      Title: scalar(row["title"]),
      Language: scalar(row["learning_language"]).toUpperCase(),
      Level: scalar(row["level"]),
      Transcript: scalar(row["transcript"]),
      Sections: (sections.get(id) ?? []).length,
      "Max plays": scalar(rules["max_plays"]),
      "Allow pause": boolText(rules["allow_pause"]),
      "Allow seek": boolText(rules["allow_seek"]),
      "Allow rewind": boolText(rules["allow_rewind"]),
      "Show transcript": boolText(rules["show_transcript"]),
      Status: scalar(row["status"]),
    };
  });

  const questionRows = (tables["listening_questions"] ?? []).map(
    (question, index) => {
      const setId = String(question["listening_question_set_id"] ?? "");
      const listeningId = setToListening.get(setId) ?? "";
      const payload = objectValue(question["payload"]);
      const options = printableOptions(payload["options"]);
      return {
        "No.": index + 1,
        Listening: listeningNames.get(listeningId) ?? "",
        Question: scalar(question["prompt"]),
        Type: humanizeColumn(scalar(question["question_type"])),
        Level: scalar(question["level"]),
        Options: options
          .map((option) => `${option.id.toUpperCase()}) ${option.text}`)
          .join(" | "),
        Status: scalar(question["status"]),
      };
    },
  );

  return [
    { name: "Listenings", rows: main },
    { name: "Questions", rows: questionRows },
  ];
}

function catalogSpreadsheetSheets(
  tables: Record<string, Record<string, unknown>[]>,
): FriendlySheet[] {
  const catalogs = tables["catalogs"] ?? [];
  const names = new Map(
    catalogs.map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );
  const items = groupByStringKey(tables["catalog_items"] ?? [], "catalog_id");
  const assignments = groupByStringKey(
    tables["catalog_assignments"] ?? [],
    "catalog_id",
  );

  return [
    {
      name: "Catalogs",
      rows: catalogs.map((row, index) => {
        const id = String(row["id"] ?? "");
        const settings = objectValue(row["settings"]);
        return {
          "No.": index + 1,
          Name: scalar(row["name"]),
          Description: scalar(row["description"]),
          Status: scalar(row["status"]),
          Items: (items.get(id) ?? []).length,
          Assignments: (assignments.get(id) ?? []).length,
          Feedback: scalar(settings["feedback_mode"]),
          "Shuffle questions": boolText(settings["shuffle_questions"]),
          "Shuffle vocabulary": boolText(settings["shuffle_vocabulary"]),
          "Student self-practice": boolText(settings["allow_self_practice"]),
        };
      }),
    },
    {
      name: "Content",
      rows: (tables["catalog_items"] ?? []).map((row, index) => ({
        "No.": index + 1,
        Catalog: names.get(String(row["catalog_id"] ?? "")) ?? "",
        Order: numberValue(row["sort_order"]),
        Type: humanizeColumn(scalar(row["entity_type"])),
        "Content reference": scalar(row["entity_id"]),
      })),
    },
    {
      name: "Assignments",
      rows: (tables["catalog_assignments"] ?? []).map((row, index) => ({
        "No.": index + 1,
        Catalog: names.get(String(row["catalog_id"] ?? "")) ?? "",
        "Target type": humanizeColumn(scalar(row["target_type"])),
        "Target reference": scalar(
          row["student_id"] ?? row["group_id"] ?? row["target_id"],
        ),
      })),
    },
  ];
}

function examSpreadsheetSheets(
  tables: Record<string, Record<string, unknown>[]>,
): FriendlySheet[] {
  const exams = tables["exams"] ?? [];
  const examNames = new Map(
    exams.map((row) => [
      String(row["id"] ?? ""),
      String(row["title"] ?? ""),
    ]),
  );
  const sections = tables["exam_sections"] ?? [];
  const sectionNames = new Map(
    sections.map((row) => [
      String(row["id"] ?? ""),
      String(row["title"] ?? ""),
    ]),
  );

  return [
    {
      name: "Exams",
      rows: exams.map((row, index) => {
        const settings = objectValue(row["settings"]);
        return {
          "No.": index + 1,
          Title: scalar(row["title"]),
          Description: scalar(row["description"]),
          Status: scalar(row["status"]),
          "Duration (minutes)": numberValue(row["duration_minutes"]),
          "Available from": scalar(row["available_from"]),
          "Available until": scalar(row["available_until"]),
          "Max attempts": numberValue(settings["max_attempts"]),
          "Pass score (%)": numberValue(settings["pass_score_percent"]),
          "Result release": scalar(settings["result_release"]),
        };
      }),
    },
    {
      name: "Sections",
      rows: sections.map((row, index) => ({
        "No.": index + 1,
        Exam: examNames.get(String(row["exam_id"] ?? "")) ?? "",
        Section: scalar(row["title"]),
        Instructions: scalar(row["instructions"]),
        Order: numberValue(row["sort_order"]),
      })),
    },
    {
      name: "Items",
      rows: (tables["exam_items"] ?? []).map((row, index) => ({
        "No.": index + 1,
        Section: sectionNames.get(String(row["section_id"] ?? "")) ?? "",
        Type: humanizeColumn(scalar(row["item_type"] ?? row["entity_type"])),
        Order: numberValue(row["sort_order"]),
        "Content reference": scalar(
          row["entity_id"] ?? row["question_id"] ?? row["catalog_id"],
        ),
      })),
    },
    {
      name: "Assignments",
      rows: (tables["exam_assignments"] ?? []).map((row, index) => ({
        "No.": index + 1,
        Exam: examNames.get(String(row["exam_id"] ?? "")) ?? "",
        "Target type": humanizeColumn(scalar(row["target_type"])),
        "Target reference": scalar(
          row["student_id"] ?? row["group_id"] ?? row["target_id"],
        ),
      })),
    },
  ];
}

function studentSpreadsheetSheets(
  tables: Record<string, Record<string, unknown>[]>,
): FriendlySheet[] {
  const students = tables["students"] ?? [];
  const groups = tables["groups"] ?? [];
  const studentNames = new Map(
    students.map((row) => [
      String(row["id"] ?? ""),
      [scalar(row["first_name"]), scalar(row["last_name"])]
        .filter(Boolean)
        .join(" "),
    ]),
  );
  const groupNames = new Map(
    groups.map((row) => [
      String(row["id"] ?? ""),
      String(row["name"] ?? ""),
    ]),
  );

  return [
    {
      name: "Students",
      rows: students.map((row, index) => ({
        "No.": index + 1,
        Name: [scalar(row["first_name"]), scalar(row["last_name"])]
          .filter(Boolean)
          .join(" "),
        Username: scalar(row["username"]),
        Status: scalar(row["status"]),
        "Interface language": scalar(row["interface_language"]).toUpperCase(),
        "Last active": scalar(row["last_active_at"]),
        Created: scalar(row["created_at"]),
      })),
    },
    {
      name: "Groups",
      rows: groups.map((row, index) => ({
        "No.": index + 1,
        Group: scalar(row["name"]),
        Description: scalar(row["description"]),
        Status: scalar(row["status"]),
      })),
    },
    {
      name: "Memberships",
      rows: (tables["group_memberships"] ?? []).map((row, index) => ({
        "No.": index + 1,
        Student: studentNames.get(String(row["student_id"] ?? "")) ?? "",
        Group: groupNames.get(String(row["group_id"] ?? "")) ?? "",
      })),
    },
  ];
}

function cleanGenericSheets(
  tables: Record<string, Record<string, unknown>[]>,
  labels: Record<string, string>,
): FriendlySheet[] {
  return Object.entries(labels).map(([key, name]) => ({
    name,
    rows: (tables[key] ?? []).map((row, index) =>
      cleanGenericRow(row, index),
    ),
  }));
}

function cleanGenericRow(
  row: Record<string, unknown>,
  index: number,
): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {
    "No.": index + 1,
  };
  const hidden = new Set([
    "id",
    "deleted_at",
    "content_hash",
    "provenance",
    "metadata",
  ]);
  for (const [key, value] of Object.entries(row)) {
    if (hidden.has(key)) continue;
    output[humanizeColumn(key)] = friendlyCell(value);
  }
  return output;
}

function createWorksheet(
  utils: typeof import("xlsx").utils,
  rows: FriendlySheet["rows"],
) {
  const safeRows = rows.length ? rows : [{ Message: "No data" }];
  const sheet = utils.json_to_sheet(safeRows);
  const columns = [...new Set(safeRows.flatMap((row) => Object.keys(row)))];
  sheet["!cols"] = columns.map((column) => {
    const max = Math.max(
      column.length,
      ...safeRows.slice(0, 500).map((row) =>
        String(row[column] ?? "").split("\n")[0]!.length,
      ),
    );
    return { wch: Math.min(55, Math.max(10, max + 2)) };
  });
  if (sheet["!ref"]) {
    sheet["!autofilter"] = { ref: sheet["!ref"] };
  }
  return sheet;
}

function groupByStringKey(
  rows: Record<string, unknown>[],
  key: string,
) {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const value = String(row[key] ?? "");
    const list = map.get(value) ?? [];
    list.push(row);
    map.set(value, list);
  }
  return map;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalar(value: unknown) {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return friendlyCell(value).toString();
}

function arrayText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => scalar(item)).filter(Boolean).join(", ")
    : scalar(value);
}

function boolText(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numericObjectValue(value: unknown, key: string) {
  const object = objectValue(value);
  const numeric = Number(object[key]);
  return Number.isFinite(numeric) ? numeric : 0;
}

function friendlyCell(value: unknown): string | number | boolean {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scalar(item)).filter(Boolean).join(" | ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${humanizeColumn(key)}: ${scalar(item)}`)
      .join(" | ");
  }
  return String(value);
}

function buildVocabularyPdfHtml(input: {
  exportedAt: string;
  rows: FriendlySheet["rows"];
}) {
  const body = input.rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(String(row["No."] ?? ""))}</td>
        <td class="word">${escapeHtml(String(row["Word"] ?? ""))}</td>
        <td>${escapeHtml(String(row["IPA"] ?? ""))}</td>
        <td>${escapeHtml(String(row["Part of speech"] ?? ""))}</td>
        <td>${escapeHtml(String(row["Level"] ?? ""))}</td>
        <td>${escapeHtml(String(row["Translations"] ?? ""))}</td>
        <td>${escapeHtml(String(row["Definition"] ?? ""))}</td>
        <td>${escapeHtml(String(row["Notes"] ?? ""))}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FluentForge Vocabulary</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; color: #111; font-size: 8.5pt; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  .meta { color: #555; margin: 0 0 5mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bbb; padding: 1.5mm; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #f1f1f1; text-align: left; }
  th:nth-child(1), td:nth-child(1) { width: 5%; }
  th:nth-child(2), td:nth-child(2) { width: 14%; }
  th:nth-child(3), td:nth-child(3) { width: 11%; }
  th:nth-child(4), td:nth-child(4) { width: 10%; }
  th:nth-child(5), td:nth-child(5) { width: 6%; }
  .word { font-weight: 700; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
<h1>FluentForge Vocabulary</h1>
<p class="meta">Generated: ${escapeHtml(input.exportedAt)} · ${input.rows.length} entries</p>
<table>
<thead><tr><th>No.</th><th>Word</th><th>IPA</th><th>Part of speech</th><th>Level</th><th>Translations</th><th>Definition</th><th>Notes</th></tr></thead>
<tbody>${body || '<tr><td colspan="8">No vocabulary entries.</td></tr>'}</tbody>
</table>
</body>
</html>`;
}

function buildReadingsHtml(input: {
  exportedAt: string;
  readings: Record<string, unknown>[];
  questionSets: Record<string, unknown>[];
  questions: Record<string, unknown>[];
}) {
  const setsByReading = groupByStringKey(input.questionSets, "reading_id");
  const questionsBySet = groupByStringKey(
    input.questions,
    "reading_question_set_id",
  );

  const readings = input.readings
    .map((reading, index) => {
      const id = String(reading["id"] ?? "");
      const sets = setsByReading.get(id) ?? [];
      const questionHtml = sets
        .flatMap((set) => questionsBySet.get(String(set["id"] ?? "")) ?? [])
        .map(
          (question, qIndex) =>
            `<li>${escapeHtml(scalar(question["prompt"]))}</li>`,
        )
        .join("");
      return `
        <article class="reading">
          <h2>${index + 1}. ${escapeHtml(scalar(reading["title"]) || "Untitled reading")}</h2>
          <p class="reading-meta">${escapeHtml(
            [
              scalar(reading["learning_language"]).toUpperCase(),
              scalar(reading["level"]),
            ].filter(Boolean).join(" · "),
          )}</p>
          <div class="body">${escapeHtml(scalar(reading["body"])).replaceAll("\n", "<br>")}</div>
          ${questionHtml ? `<h3>Questions</h3><ol>${questionHtml}</ol>` : ""}
        </article>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FluentForge Readings</title>
<style>
  @page { size: A4 portrait; margin: 17mm; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.55; }
  h1 { font-size: 19pt; margin: 0 0 2mm; }
  h2 { font-size: 15pt; margin: 0 0 1mm; }
  h3 { font-size: 11pt; margin: 5mm 0 2mm; }
  .meta, .reading-meta { color: #666; font-size: 9pt; }
  .reading { margin-top: 9mm; page-break-before: auto; }
  .reading + .reading { page-break-before: always; }
  .body { white-space: normal; }
  li { margin: 1.5mm 0; }
</style>
</head>
<body>
<h1>FluentForge Readings</h1>
<p class="meta">Generated: ${escapeHtml(input.exportedAt)} · ${input.readings.length} reading(s)</p>
${readings || "<p>No readings.</p>"}
</body>
</html>`;
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
