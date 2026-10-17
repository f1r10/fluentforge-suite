import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import {
  BACKUP_MAGIC,
  BACKUP_SCHEMA,
  BACKUP_TABLES,
  BACKUP_VERSION,
  SAFE_SETTING_KEYS,
  parseBackupPackage,
  sanitizeBackupRow,
  validateStoragePayload,
  type BackupTable,
  type FluentForgeBackup,
} from "./backup-format";

const BACKUP_BUCKET = "backups";
const BACKUP_MIME = "application/gzip";
const PAGE_SIZE = 1_000;
const MAX_BACKUP_FILE_BYTES = 512 * 1024 * 1024;
const MAX_RAW_STORAGE_BYTES = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED_PACKAGE_BYTES = 420 * 1024 * 1024;

const RESTORE_ORDER: BackupTable[] = [
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
];

const CORE_TABLES = [
  "students",
  "questions",
  "vocabulary_entries",
  "readings",
  "listenings",
  "catalogs",
  "exams",
  "exam_attempts",
  "media_assets",
  "source_files",
] as const;

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("backups")
      .select(
        "id,kind,status,storage_path,size_bytes,mime_type,checksum_sha256,manifest,error,created_at,completed_at,last_restored_at,restore_state",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getBackupSchedule = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("system_settings")
      .select("value")
      .eq("key", "backup_schedule")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const value =
      data?.value && typeof data.value === "object"
        ? (data.value as Record<string, unknown>)
        : {};
    return {
      enabled: value["enabled"] === true,
      interval_hours: clampInteger(value["interval_hours"], 1, 720, 24),
      retention_count: clampInteger(value["retention_count"], 1, 50, 7),
    };
  });

export const saveBackupSchedule = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        enabled: z.boolean(),
        interval_hours: z.number().int().min(1).max(720),
        retention_count: z.number().int().min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("system_settings")
      .upsert(
        {
          key: "backup_schedule",
          value: data as never,
          is_public: false,
        },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);

    const { adminClient, audit } = await import("./security.server");
    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "backup_schedule_changed",
      entity_type: "system_setting",
      entity_id: "backup_schedule",
      summary: data.enabled
        ? `Scheduled backups enabled every ${data.interval_hours} hour(s)`
        : "Scheduled backups disabled",
      details: data,
    });
    return { ok: true };
  });

export async function runScheduledBackupIfDue() {
  const { adminClient, audit } = await import("./security.server");
  const admin = await adminClient();

  const { data: settingRow, error: settingError } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "backup_schedule")
    .maybeSingle();
  if (settingError) throw new Error(settingError.message);

  const setting =
    settingRow?.value && typeof settingRow.value === "object"
      ? (settingRow.value as Record<string, unknown>)
      : {};
  const enabled = setting["enabled"] === true;
  const intervalHours = clampInteger(
    setting["interval_hours"],
    1,
    720,
    24,
  );
  const retentionCount = clampInteger(
    setting["retention_count"],
    1,
    50,
    7,
  );

  if (!enabled) {
    return { status: "disabled" as const };
  }

  const { data: jobId, error: claimError } = await admin.rpc(
    "claim_scheduled_backup",
    { p_interval_hours: intervalHours },
  );
  if (claimError) throw new Error(claimError.message);
  if (!jobId) {
    return { status: "not_due" as const };
  }

  try {
    const backup = await buildBackup(admin);
    const json = Buffer.from(JSON.stringify(backup), "utf8");
    if (json.byteLength > MAX_UNCOMPRESSED_PACKAGE_BYTES) {
      throw new Error(
        "Scheduled backup package is too large for the in-process backup engine.",
      );
    }

    const { gzipSync } = await import("node:zlib");
    const compressed = gzipSync(json, { level: 6 });
    if (compressed.byteLength > MAX_BACKUP_FILE_BYTES) {
      throw new Error("Compressed scheduled backup exceeds 512 MB.");
    }

    const checksum = await sha256Buffer(compressed);
    const stamp = backup.created_at.replace(/[:.]/g, "-");
    const storagePath = `scheduled/${stamp}-${jobId}.ffbackup`;
    const { error: uploadError } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, compressed, {
        contentType: BACKUP_MIME,
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    const completedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("backups")
      .update({
        status: "completed",
        storage_path: storagePath,
        size_bytes: compressed.byteLength,
        mime_type: BACKUP_MIME,
        checksum_sha256: checksum,
        manifest: backup.manifest as never,
        completed_at: completedAt,
        error: null,
      })
      .eq("id", jobId);
    if (updateError) throw new Error(updateError.message);

    await audit(admin, {
      actor_type: "system",
      action: "scheduled_backup_created",
      entity_type: "backup",
      entity_id: jobId,
      summary: "Created scheduled FluentForge application backup",
      details: {
        interval_hours: intervalHours,
        retention_count: retentionCount,
        package_bytes: compressed.byteLength,
        checksum_sha256: checksum,
      },
    });

    await pruneScheduledBackups(admin, retentionCount, jobId);

    return {
      status: "completed" as const,
      id: jobId,
      sizeBytes: compressed.byteLength,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    await admin
      .from("backups")
      .update({
        status: "failed",
        error: message.slice(0, 5_000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    const { notifyTeacher } = await import("./notifications.functions");
    await notifyTeacher(admin, {
      kind: "backup_warning",
      title: "Scheduled backup failed",
      body: message,
      link: "/teacher/backups",
      data: { backup_id: jobId },
      dedupeKey: `scheduled-backup-failed:${jobId}`,
    });

    throw error;
  }
}

export const createApplicationBackup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error: jobError } = await admin
      .from("backups")
      .insert({
        kind: "manual",
        status: "processing",
        manifest: {},
        restore_state: {},
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create backup job.");
    }

    try {
      const backup = await buildBackup(admin);
      const json = Buffer.from(JSON.stringify(backup), "utf8");
      if (json.byteLength > MAX_UNCOMPRESSED_PACKAGE_BYTES) {
        throw new Error(
          "Backup package is too large for the in-process backup engine. Use infrastructure-level database/object-storage backup for this installation.",
        );
      }

      const { gzipSync } = await import("node:zlib");
      const compressed = gzipSync(json, { level: 6 });
      if (compressed.byteLength > MAX_BACKUP_FILE_BYTES) {
        throw new Error("Compressed backup exceeds the 512 MB package limit.");
      }

      const checksum = await sha256Buffer(compressed);
      const stamp = backup.created_at.replace(/[:.]/g, "-");
      const storagePath = `manual/${stamp}-${job.id}.ffbackup`;

      const { error: uploadError } = await admin.storage
        .from(BACKUP_BUCKET)
        .upload(storagePath, compressed, {
          contentType: BACKUP_MIME,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const completedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("backups")
        .update({
          status: "completed",
          storage_path: storagePath,
          size_bytes: compressed.byteLength,
          mime_type: BACKUP_MIME,
          checksum_sha256: checksum,
          manifest: backup.manifest as never,
          completed_at: completedAt,
          error: null,
        })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "application_backup_created",
        entity_type: "backup",
        entity_id: job.id,
        summary: "Created FluentForge application backup",
        details: {
          schema: backup.schema,
          row_counts: backup.manifest.row_counts,
          storage_objects: backup.manifest.storage_objects,
          storage_bytes: backup.manifest.storage_bytes,
          package_bytes: compressed.byteLength,
          checksum_sha256: checksum,
        },
      });

      const { data: signed, error: signedError } = await admin.storage
        .from(BACKUP_BUCKET)
        .createSignedUrl(storagePath, 15 * 60);
      if (signedError || !signed) {
        throw new Error(
          signedError?.message ?? "Could not create backup download URL.",
        );
      }

      return {
        id: job.id,
        url: signed.signedUrl,
        filename: `fluentforge-${stamp}.ffbackup`,
        manifest: backup.manifest,
        sizeBytes: compressed.byteLength,
      };
    } catch (error) {
      await admin
        .from("backups")
        .update({
          status: "failed",
          error:
            error instanceof Error
              ? error.message.slice(0, 5_000)
              : String(error).slice(0, 5_000),
        })
        .eq("id", job.id);
      throw error;
    }
  });

export const getBackupDownload = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const backup = await getBackupRow(admin, data.id);

    const { data: signed, error } = await admin.storage
      .from(BACKUP_BUCKET)
      .createSignedUrl(backup.storage_path, 15 * 60);
    if (error || !signed) {
      throw new Error(error?.message ?? "Could not create backup download URL.");
    }

    return {
      url: signed.signedUrl,
      filename: `fluentforge-${backup.id}.ffbackup`,
      expiresIn: 15 * 60,
    };
  });

export const beginBackupUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        filename: z.string().trim().min(1).max(255),
        sizeBytes: z.number().int().min(1).max(MAX_BACKUP_FILE_BYTES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!data.filename.toLowerCase().endsWith(".ffbackup")) {
      throw new Error("Restore files must use the .ffbackup extension.");
    }

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: row, error: rowError } = await admin
      .from("backups")
      .insert({
        kind: "uploaded",
        status: "processing",
        size_bytes: data.sizeBytes,
        manifest: {},
        restore_state: {},
      })
      .select("id")
      .single();
    if (rowError || !row) {
      throw new Error(rowError?.message ?? "Could not create restore upload.");
    }

    const path = `incoming/${row.id}.ffbackup`;
    const { error: pathError } = await admin
      .from("backups")
      .update({ storage_path: path, mime_type: BACKUP_MIME })
      .eq("id", row.id);
    if (pathError) throw new Error(pathError.message);

    const { data: signed, error: signedError } = await admin.storage
      .from(BACKUP_BUCKET)
      .createSignedUploadUrl(path);
    if (signedError || !signed) {
      await admin.from("backups").delete().eq("id", row.id);
      throw new Error(signedError?.message ?? "Could not authorize backup upload.");
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "backup_restore_upload_started",
      entity_type: "backup",
      entity_id: row.id,
      summary: "Started .ffbackup restore upload",
      details: { filename: data.filename, size_bytes: data.sizeBytes },
    });

    return {
      id: row.id,
      bucket: BACKUP_BUCKET,
      path,
      token: signed.token,
    };
  });

export const finalizeBackupUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: row, error: rowError } = await admin
      .from("backups")
      .select("id,kind,status,storage_path,size_bytes")
      .eq("id", data.id)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row || row.kind !== "uploaded" || !row.storage_path) {
      throw new Error("Restore upload not found.");
    }
    if (row.status === "completed") {
      return { id: row.id, alreadyFinalized: true };
    }

    const compressed = await downloadObject(admin, BACKUP_BUCKET, row.storage_path);
    if (compressed.byteLength !== Number(row.size_bytes)) {
      throw new Error(
        `Uploaded backup size mismatch: expected ${row.size_bytes}, received ${compressed.byteLength}.`,
      );
    }

    const checksum = await sha256Buffer(compressed);
    const backup = await decodeBackup(compressed);
    const completedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("backups")
      .update({
        status: "completed",
        checksum_sha256: checksum,
        manifest: backup.manifest as never,
        completed_at: completedAt,
        error: null,
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "backup_restore_upload_validated",
      entity_type: "backup",
      entity_id: row.id,
      summary: "Validated uploaded FluentForge backup",
      details: {
        schema: backup.schema,
        checksum_sha256: checksum,
        manifest: backup.manifest,
      },
    });

    return {
      id: row.id,
      alreadyFinalized: false,
      manifest: backup.manifest,
      checksum,
    };
  });

export const getRestorePreview = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const row = await getBackupRow(admin, data.id);
    const packageBytes = await downloadObject(
      admin,
      BACKUP_BUCKET,
      row.storage_path,
    );
    await verifyChecksum(packageBytes, row.checksum_sha256);
    const backup = await decodeBackup(packageBytes);
    const target = await targetState(admin);
    const state = normalizeRestoreState(row.restore_state);
    const resumable = state.status === "in_progress";

    return {
      backup: {
        id: row.id,
        kind: row.kind,
        created_at: backup.created_at,
        schema: backup.schema,
        checksum_sha256: row.checksum_sha256,
        manifest: backup.manifest,
        security: backup.security,
      },
      target,
      canRestore:
        resumable ||
        Object.values(target).every((count) => Number(count) === 0),
      resumable,
      restoreState: state,
    };
  });

export const restoreApplicationBackup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        confirmation: z.literal("RESTORE EMPTY INSTALLATION"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const row = await getBackupRow(admin, data.id);
    let state = normalizeRestoreState(row.restore_state);

    if (state.status === "completed") {
      throw new Error("This backup has already been restored on this installation.");
    }

    const target = await targetState(admin);
    if (
      state.status !== "in_progress" &&
      !Object.values(target).every((count) => Number(count) === 0)
    ) {
      throw new Error(
        "Restore is allowed only on an empty installation. Existing learning data was detected.",
      );
    }

    const packageBytes = await downloadObject(
      admin,
      BACKUP_BUCKET,
      row.storage_path,
    );
    await verifyChecksum(packageBytes, row.checksum_sha256);
    const backup = await decodeBackup(packageBytes);

    state = {
      status: "in_progress",
      storage_restored: state.storage_restored,
      completed_tables: state.completed_tables,
      started_at: state.started_at ?? new Date().toISOString(),
    };
    await saveRestoreState(admin, row.id, state);

    if (!state.storage_restored) {
      await restoreStorage(admin, backup);
      state.storage_restored = true;
      await saveRestoreState(admin, row.id, state);
    }

    for (const table of RESTORE_ORDER) {
      if (state.completed_tables.includes(table)) continue;
      await restoreTable(admin, table, backup.tables[table] ?? []);
      state.completed_tables.push(table);
      await saveRestoreState(admin, row.id, state);
    }

    const completedAt = new Date().toISOString();
    const completedState = {
      ...state,
      status: "completed" as const,
      completed_at: completedAt,
    };

    const { error: finishError } = await admin
      .from("backups")
      .update({
        last_restored_at: completedAt,
        restore_state: completedState as never,
      })
      .eq("id", row.id);
    if (finishError) throw new Error(finishError.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "application_backup_restored",
      entity_type: "backup",
      entity_id: row.id,
      summary: "Restored FluentForge application backup",
      details: {
        schema: backup.schema,
        checksum_sha256: row.checksum_sha256,
        row_counts: backup.manifest.row_counts,
        storage_objects: backup.manifest.storage_objects,
      },
    });

    return {
      ok: true,
      restoredTables: completedState.completed_tables.length,
      storageObjects: backup.manifest.storage_objects,
    };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: row, error } = await admin
      .from("backups")
      .select("id,storage_path,restore_state")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { ok: true };

    const state = normalizeRestoreState(row.restore_state);
    if (state.status === "in_progress") {
      throw new Error("Cannot delete a backup while restore is in progress.");
    }

    if (row.storage_path) {
      const { error: removeError } = await admin.storage
        .from(BACKUP_BUCKET)
        .remove([row.storage_path]);
      if (removeError) throw new Error(removeError.message);
    }
    const { error: deleteError } = await admin
      .from("backups")
      .delete()
      .eq("id", row.id);
    if (deleteError) throw new Error(deleteError.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "application_backup_deleted",
      entity_type: "backup",
      entity_id: row.id,
      summary: "Deleted application backup package",
    });

    return { ok: true };
  });

async function pruneScheduledBackups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  retentionCount: number,
  currentId: string,
) {
  const { data: rows, error } = await admin
    .from("backups")
    .select("id,storage_path")
    .eq("kind", "scheduled")
    .eq("status", "completed")
    .neq("id", currentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const stale = (rows ?? []).slice(Math.max(0, retentionCount - 1));
  for (const row of stale) {
    if (row.storage_path) {
      const { error: removeError } = await admin.storage
        .from(BACKUP_BUCKET)
        .remove([row.storage_path]);
      if (removeError) throw new Error(removeError.message);
    }
    const { error: deleteError } = await admin
      .from("backups")
      .delete()
      .eq("id", row.id);
    if (deleteError) throw new Error(deleteError.message);
  }
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

async function buildBackup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<FluentForgeBackup> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const rowCounts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const rows = await fetchBackupTable(admin, table);
    tables[table] = rows;
    rowCounts[table] = rows.length;
  }

  const storage = await collectStorage(admin, tables);
  const storageBytes = storage.reduce(
    (sum, object) => sum + object.size_bytes,
    0,
  );

  return parseBackupPackage({
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    schema: BACKUP_SCHEMA,
    product: "FluentForge",
    created_at: new Date().toISOString(),
    security: {
      excluded: [
        "admin_users",
        "admin_recovery_codes",
        "user_roles",
        "student_access_keys",
        "student_sessions",
        "login_attempts",
        "media_upload_sessions",
        "source_upload_sessions",
        "import_jobs",
        "import_items",
        "processing_jobs",
        "export_jobs",
        "backups",
        "AI/OCR/API secrets and environment variables",
      ],
    },
    manifest: {
      row_counts: rowCounts,
      storage_objects: storage.length,
      storage_bytes: storageBytes,
    },
    tables,
    storage,
  });
}

async function fetchBackupTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: BackupTable,
) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  for (;;) {
    let query = admin
      .from(table)
      .select("*")
      .range(offset, offset + PAGE_SIZE - 1);

    if (table === "system_settings") {
      query = query.in("key", [...SAFE_SETTING_KEYS]);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Could not back up ${table}: ${error.message}`);

    const batch = ((data ?? []) as Record<string, unknown>[])
      .map((row) => sanitizeBackupRow(table, row))
      .filter((row): row is Record<string, unknown> => !!row);
    rows.push(...batch);

    if ((data ?? []).length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset >= 500_000) {
      throw new Error(`Backup table ${table} exceeded 500,000 row safety limit.`);
    }
  }

  return rows;
}

async function collectStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tables: Record<string, Record<string, unknown>[]>,
) {
  const refs = new Map<
    string,
    { bucket: "media" | "sources" | "branding"; path: string; mime_type: string | null }
  >();

  for (const row of tables["media_assets"] ?? []) {
    const path = typeof row["storage_path"] === "string" ? row["storage_path"] : null;
    if (!path) continue;
    refs.set(`media:${path}`, {
      bucket: "media",
      path,
      mime_type: typeof row["mime_type"] === "string" ? row["mime_type"] : null,
    });
  }

  for (const row of tables["source_files"] ?? []) {
    const path = typeof row["storage_path"] === "string" ? row["storage_path"] : null;
    if (!path) continue;
    refs.set(`sources:${path}`, {
      bucket: "sources",
      path,
      mime_type: typeof row["mime_type"] === "string" ? row["mime_type"] : null,
    });
  }

  const brandingRow = (tables["system_settings"] ?? []).find(
    (row) => row["key"] === "branding",
  );
  const brandingValue =
    brandingRow?.["value"] && typeof brandingRow["value"] === "object"
      ? (brandingRow["value"] as Record<string, unknown>)
      : null;
  for (const key of [
    "logo_storage_path",
    "favicon_storage_path",
    "login_image_storage_path",
  ] as const) {
    const path =
      brandingValue && typeof brandingValue[key] === "string"
        ? (brandingValue[key] as string)
        : null;
    if (!path) continue;
    refs.set(`branding:${path}`, {
      bucket: "branding",
      path,
      mime_type: brandingMimeType(path),
    });
  }

  const objects: Array<{
    bucket: "media" | "sources" | "branding";
    path: string;
    mime_type: string | null;
    size_bytes: number;
    sha256: string;
    data_base64: string;
  }> = [];
  let totalBytes = 0;

  for (const ref of refs.values()) {
    const bytes = await downloadObject(admin, ref.bucket, ref.path);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_RAW_STORAGE_BYTES) {
      throw new Error(
        "Storage objects exceed the 256 MB in-process backup safety limit. Use infrastructure-level object-storage backup for larger installations.",
      );
    }

    objects.push({
      ...ref,
      size_bytes: bytes.byteLength,
      sha256: await sha256Buffer(bytes),
      data_base64: bytes.toString("base64"),
    });
  }

  return objects;
}

async function decodeBackup(compressed: Buffer) {
  if (compressed.byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new Error("Backup file exceeds the 512 MB package limit.");
  }

  const { gunzipSync } = await import("node:zlib");
  let raw: Buffer;
  try {
    raw = gunzipSync(compressed, {
      maxOutputLength: MAX_UNCOMPRESSED_PACKAGE_BYTES,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not decompress backup: ${error.message}`
        : "Could not decompress backup.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("Backup payload is not valid JSON.");
  }

  const backup = parseBackupPackage(value);
  validateStoragePayload(backup, MAX_RAW_STORAGE_BYTES);

  for (const object of backup.storage) {
    const bytes = Buffer.from(object.data_base64, "base64");
    if (bytes.byteLength !== object.size_bytes) {
      throw new Error(`Storage object size mismatch: ${object.path}`);
    }
    const checksum = await sha256Buffer(bytes);
    if (checksum !== object.sha256) {
      throw new Error(`Storage object checksum mismatch: ${object.path}`);
    }
  }

  return backup;
}

async function restoreStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  backup: FluentForgeBackup,
) {
  for (const object of backup.storage) {
    const bytes = Buffer.from(object.data_base64, "base64");
    const { error } = await admin.storage
      .from(object.bucket)
      .upload(object.path, bytes, {
        contentType: object.mime_type ?? "application/octet-stream",
        upsert: true,
      });
    if (error) {
      throw new Error(
        `Could not restore ${object.bucket}/${object.path}: ${error.message}`,
      );
    }
  }
}

async function restoreTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: BackupTable,
  inputRows: Record<string, unknown>[],
) {
  let rows = inputRows
    .map((row) => sanitizeBackupRow(table, row))
    .filter((row): row is Record<string, unknown> => !!row);
  if (!rows.length) return;

  if (table === "system_settings") {
    rows = rows.map((row) => {
      if (row["key"] !== "branding" || !row["value"] || typeof row["value"] !== "object") {
        return row;
      }

      const value = { ...(row["value"] as Record<string, unknown>) };
      for (const kind of ["logo", "favicon", "login_image"] as const) {
        const pathKey = `${kind}_storage_path`;
        const urlKey = `${kind}_url`;
        const path =
          typeof value[pathKey] === "string"
            ? (value[pathKey] as string)
            : null;
        if (!path) continue;
        const { data } = admin.storage.from("branding").getPublicUrl(path);
        value[urlKey] = data.publicUrl;
      }

      return { ...row, value };
    });
  }

  if (table === "topics" || table === "catalogs") {
    const withoutParents = rows.map((row) => ({ ...row, parent_id: null }));
    await upsertBatches(admin, table, withoutParents);
    await upsertBatches(admin, table, rows);
    return;
  }

  if (table === "activity_events" || table === "audit_logs") {
    await insertBatches(admin, table, rows);
    return;
  }

  await upsertBatches(admin, table, rows);
}

async function upsertBatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  rows: Record<string, unknown>[],
) {
  for (const batch of chunks(rows, 250)) {
    const { error } = await admin.from(table).upsert(batch);
    if (error) throw new Error(`Could not restore ${table}: ${error.message}`);
  }
}

async function insertBatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  rows: Record<string, unknown>[],
) {
  for (const batch of chunks(rows, 250)) {
    const { error } = await admin.from(table).insert(batch);
    if (error) throw new Error(`Could not restore ${table}: ${error.message}`);
  }
}

async function targetState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
) {
  const output: Record<string, number> = {};
  for (const table of CORE_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    output[table] = count ?? 0;
  }
  return output;
}

async function getBackupRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
) {
  const { data, error } = await admin
    .from("backups")
    .select(
      "id,kind,status,storage_path,size_bytes,mime_type,checksum_sha256,manifest,error,created_at,completed_at,last_restored_at,restore_state",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "completed" || !data.storage_path) {
    throw new Error("Backup is not available.");
  }
  return data;
}

async function saveRestoreState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
  state: RestoreState,
) {
  const { error } = await admin
    .from("backups")
    .update({ restore_state: state as never })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

type RestoreState = {
  status: "idle" | "in_progress" | "completed";
  storage_restored: boolean;
  completed_tables: BackupTable[];
  started_at?: string;
  completed_at?: string;
};

function normalizeRestoreState(value: unknown): RestoreState {
  if (!value || typeof value !== "object") {
    return {
      status: "idle",
      storage_restored: false,
      completed_tables: [],
    };
  }

  const row = value as Record<string, unknown>;
  const allowed = new Set<string>(BACKUP_TABLES);
  const completed = Array.isArray(row["completed_tables"])
    ? row["completed_tables"].filter(
        (value): value is BackupTable =>
          typeof value === "string" && allowed.has(value),
      )
    : [];

  return {
    status:
      row["status"] === "in_progress" || row["status"] === "completed"
        ? row["status"]
        : "idle",
    storage_restored: row["storage_restored"] === true,
    completed_tables: [...new Set(completed)],
    started_at:
      typeof row["started_at"] === "string" ? row["started_at"] : undefined,
    completed_at:
      typeof row["completed_at"] === "string" ? row["completed_at"] : undefined,
  };
}

async function downloadObject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  bucket: string,
  path: string,
) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(
      error?.message ?? `Could not download ${bucket}/${path}.`,
    );
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  return bytes;
}

async function verifyChecksum(bytes: Buffer, expected: string | null) {
  if (!expected) return;
  const actual = await sha256Buffer(bytes);
  if (actual !== expected) {
    throw new Error("Backup package checksum verification failed.");
  }
}

async function sha256Buffer(bytes: Buffer) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function brandingMimeType(path: string) {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "ico") return "image/x-icon";
  return "application/octet-stream";
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}
