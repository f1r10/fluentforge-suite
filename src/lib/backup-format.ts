import { z } from "zod";

export const BACKUP_MAGIC = "FLUENTFORGE_BACKUP";
export const BACKUP_VERSION = 2;
export const BACKUP_SCHEMA = "2026-10-18/v2";

export const BACKUP_TABLES = [
  "languages",
  "system_settings",
  "students",
  "groups",
  "group_memberships",
  "import_profiles",
  "media_assets",
  "source_files",
  "topics",
  "tags",
  "readings",
  "reading_media",
  "reading_question_sets",
  "listenings",
  "listening_sections",
  "listening_question_sets",
  "questions",
  "question_versions",
  "question_topics",
  "question_tags",
  "vocabulary_entries",
  "vocabulary_translations",
  "vocabulary_examples",
  "vocabulary_topics",
  "vocabulary_tags",
  "vocabulary_learner_states",
  "student_vocabulary_state",
  "catalogs",
  "catalog_items",
  "lesson_revisions",
  "lesson_step_progress",
  "catalog_assignments",
  "exams",
  "exam_sections",
  "exam_items",
  "exam_assignments",
  "exam_attempts",
  "exam_listening_plays",
  "attempt_answers",
  "manual_reviews",
  "teacher_feedback",
  "student_notes",
  "question_reports",
  "favorites",
  "notifications",
  "source_collection_items",
  "activity_events",
  "audit_logs",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export const SAFE_SETTING_KEYS = new Set([
  "branding",
  "interface",
  "student_dashboard",
  "teacher_dashboard",
  "practice_defaults",
  "exam_defaults",
  "media",
  "retention",
  "maintenance",
]);

const rowSchema = z.record(z.string(), z.unknown());

const storageObjectSchema = z.object({
  bucket: z.enum(["media", "sources", "branding"]),
  path: z
    .string()
    .min(1)
    .max(1_024)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("..") &&
        !value.includes("\\") &&
        !value.split("/").some((part) => part === "" || part === "."),
      "Unsafe storage path.",
    ),
  mime_type: z.string().max(300).nullable(),
  size_bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data_base64: z.string(),
});

const packageSchema = z.object({
  magic: z.literal(BACKUP_MAGIC),
  version: z.literal(BACKUP_VERSION),
  schema: z.literal(BACKUP_SCHEMA),
  created_at: z.string().datetime(),
  product: z.literal("FluentForge"),
  security: z.object({
    excluded: z.array(z.string()).max(100),
  }),
  manifest: z.object({
    row_counts: z.record(z.string(), z.number().int().min(0)),
    storage_objects: z.number().int().min(0),
    storage_bytes: z.number().int().min(0),
  }),
  tables: z.record(z.string(), z.array(rowSchema)),
  storage: z.array(storageObjectSchema),
});

export type FluentForgeBackup = z.infer<typeof packageSchema>;

export function parseBackupPackage(value: unknown): FluentForgeBackup {
  // V1 archives remain restorable after the additive Lesson Mode migration.
  // Do not rewrite existing content or fabricate progress: new tables are empty
  // when loading a pre-Lesson-Mode backup.
  let candidate = value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const old = value as Record<string, unknown>;
    if (old["version"] === 1 && old["schema"] === "2026-10-06/v1") {
      const tables = old["tables"];
      const manifest = old["manifest"];
      if (tables && typeof tables === "object" && !Array.isArray(tables) &&
          manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
        const oldTables = tables as Record<string, unknown>;
        if ("lesson_revisions" in oldTables || "lesson_step_progress" in oldTables) {
          throw new Error("V1 archive contains unexpected lesson tables.");
        }
        const rawManifest = manifest as Record<string, unknown>;
        const counts = rawManifest["row_counts"];
        candidate = {
          ...old,
          version: BACKUP_VERSION,
          schema: BACKUP_SCHEMA,
          tables: { ...oldTables, lesson_revisions: [], lesson_step_progress: [] },
          manifest: {
            ...rawManifest,
            row_counts: {
              ...(counts && typeof counts === "object" ? counts : {}),
              lesson_revisions: 0,
              lesson_step_progress: 0,
            },
          },
        };
      }
    }
  }
  const parsed = packageSchema.parse(candidate);
  const allowed = new Set<string>(BACKUP_TABLES);

  for (const table of Object.keys(parsed.tables)) {
    if (!allowed.has(table)) {
      throw new Error(`Backup contains unsupported table: ${table}`);
    }
  }

  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(parsed.tables[table])) {
      throw new Error(`Backup is missing table: ${table}`);
    }
  }

  const computedStorageBytes = parsed.storage.reduce(
    (sum, object) => sum + object.size_bytes,
    0,
  );
  if (computedStorageBytes !== parsed.manifest.storage_bytes) {
    throw new Error("Backup storage byte manifest does not match package.");
  }
  if (parsed.storage.length !== parsed.manifest.storage_objects) {
    throw new Error("Backup storage object manifest does not match package.");
  }

  for (const table of BACKUP_TABLES) {
    const expected = parsed.manifest.row_counts[table];
    if (expected !== parsed.tables[table].length) {
      throw new Error(`Backup row count mismatch for ${table}.`);
    }
  }

  return parsed;
}

export function sanitizeBackupRow(
  table: BackupTable,
  source: Record<string, unknown>,
) {
  const row = { ...source };

  if (table === "students") {
    row["auth_user_id"] = null;
  }
  if (table === "questions") {
    delete row["search"];
  }
  if (table === "activity_events" || table === "audit_logs") {
    delete row["id"];
  }
  if (table === "lesson_step_progress") {
    // Old activity_events IDs are intentionally not restored: new identity
    // values are allocated when those rows are inserted later. Never carry
    // a stale FK into lesson progress (or point at an unrelated event).
    // The authoritative grade/completion snapshot remains unchanged.
    row["last_graded_event_id"] = null;
  }
  if (
    table === "system_settings" &&
    typeof row["key"] === "string" &&
    !SAFE_SETTING_KEYS.has(row["key"])
  ) {
    return null;
  }

  return row;
}

export function validateStoragePayload(
  backup: FluentForgeBackup,
  maxBytes: number,
) {
  if (backup.manifest.storage_bytes > maxBytes) {
    throw new Error(
      `Backup storage payload exceeds safety limit (${backup.manifest.storage_bytes} bytes).`,
    );
  }
}
