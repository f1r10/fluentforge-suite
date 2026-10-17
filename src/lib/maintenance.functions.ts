import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

type Admin = Awaited<
  ReturnType<typeof import("./security.server")["adminClient"]>
>;

const DEFAULTS = {
  trash_retention_days: 30,
  temp_session_grace_hours: 24,
  export_retention_hours: 24,
};

const settingsSchema = z.object({
  trash_retention_days: z.number().int().min(1).max(3_650),
  temp_session_grace_hours: z.number().int().min(1).max(720),
  export_retention_hours: z.number().int().min(1).max(720),
});

type MaintenanceSettings = z.infer<typeof settingsSchema>;

export const getMaintenanceSettings = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const settings = await loadSettings(context.supabase);
    const preview = await buildPreview(context.supabase, settings);
    return { settings, preview };
  });

export const saveMaintenanceSettings = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("system_settings").upsert({
      key: "maintenance",
      value: data,
      is_public: false,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runMaintenanceCleanup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ confirmation: z.literal("PERMANENTLY DELETE") }).parse(d),
  )
  .handler(async ({ context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const settings = await loadSettings(admin);
    const trashCutoff = new Date(
      Date.now() - settings.trash_retention_days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const tempCutoff = new Date(
      Date.now() - settings.temp_session_grace_hours * 60 * 60 * 1000,
    ).toISOString();
    const exportCutoff = new Date(
      Date.now() - settings.export_retention_hours * 60 * 60 * 1000,
    ).toISOString();

    const result = {
      questions: 0,
      vocabulary: 0,
      readings: 0,
      listenings: 0,
      catalogs: 0,
      media: 0,
      source_originals: 0,
      expired_exports: 0,
      media_upload_sessions: 0,
      source_upload_sessions: 0,
    };

    // Expired export binaries are removed while job history remains visible.
    const { data: expiredExports, error: exportError } = await admin
      .from("export_jobs")
      .select("id,storage_path")
      .not("storage_path", "is", null)
      .lt("expires_at", new Date().toISOString())
      .limit(1_000);
    if (exportError) throw new Error(exportError.message);
    const exportPaths = (expiredExports ?? [])
      .map((row) => row.storage_path)
      .filter((value): value is string => !!value);
    await removeStorage(admin, "exports", exportPaths);
    if ((expiredExports ?? []).length) {
      await updateRowsByIds(
        admin,
        "export_jobs",
        (expiredExports ?? []).map((row) => row.id),
        {
          storage_path: null,
          updated_at: new Date().toISOString(),
        },
      );
      result.expired_exports = expiredExports?.length ?? 0;
    }

    // Abandoned signed-upload sessions can leave orphan objects.
    result.media_upload_sessions = await cleanupUploadSessions(
      admin,
      "media_upload_sessions",
      "media",
      tempCutoff,
    );
    result.source_upload_sessions = await cleanupUploadSessions(
      admin,
      "source_upload_sessions",
      "sources",
      tempCutoff,
    );

    // Source provenance rows are retained. Only old trashed source binaries
    // are removed, so imported entities can still reference their source row.
    const { data: oldSources, error: sourceError } = await admin
      .from("source_files")
      .select("id,storage_path")
      .not("storage_path", "is", null)
      .not("deleted_at", "is", null)
      .lt("deleted_at", trashCutoff)
      .limit(1_000);
    if (sourceError) throw new Error(sourceError.message);
    const sourcePaths = (oldSources ?? [])
      .map((row) => row.storage_path)
      .filter((value): value is string => !!value);
    await removeStorage(admin, "sources", sourcePaths);
    if ((oldSources ?? []).length) {
      await updateRowsByIds(
        admin,
        "source_files",
        (oldSources ?? []).map((row) => row.id),
        {
          storage_path: null,
          original_deleted_at: new Date().toISOString(),
        },
      );
      result.source_originals = oldSources?.length ?? 0;
    }

    // When a reading/listening is permanently removed, its context-dependent
    // questions are removed with it. Published exam snapshots remain immutable.
    const readingIds = await oldDeletedIds(admin, "readings", trashCutoff);
    const readingSetIds = await childIds(
      admin,
      "reading_question_sets",
      "reading_id",
      readingIds,
    );
    const readingQuestionIds = await childIds(
      admin,
      "questions",
      "reading_question_set_id",
      readingSetIds,
    );

    const listeningIds = await oldDeletedIds(admin, "listenings", trashCutoff);
    const listeningSetIds = await childIds(
      admin,
      "listening_question_sets",
      "listening_id",
      listeningIds,
    );
    const listeningQuestionIds = await childIds(
      admin,
      "questions",
      "listening_question_set_id",
      listeningSetIds,
    );

    const directlyDeletedQuestions = await oldDeletedIds(
      admin,
      "questions",
      trashCutoff,
    );
    const questionIds = [
      ...new Set([
        ...directlyDeletedQuestions,
        ...readingQuestionIds,
        ...listeningQuestionIds,
      ]),
    ];

    await cleanupPolymorphicRefs(admin, "question", questionIds);
    result.questions = await deleteByIds(admin, "questions", questionIds);

    await cleanupPolymorphicRefs(admin, "reading", readingIds);
    result.readings = await deleteByIds(admin, "readings", readingIds);

    await cleanupPolymorphicRefs(admin, "listening", listeningIds);
    result.listenings = await deleteByIds(admin, "listenings", listeningIds);

    const vocabularyIds = await oldDeletedIds(
      admin,
      "vocabulary_entries",
      trashCutoff,
    );
    await cleanupPolymorphicRefs(admin, "vocabulary", vocabularyIds);
    result.vocabulary = await deleteByIds(
      admin,
      "vocabulary_entries",
      vocabularyIds,
    );

    const catalogIds = await oldDeletedIds(admin, "catalogs", trashCutoff);
    result.catalogs = await deleteByIds(admin, "catalogs", catalogIds);

    // Media is removed only after a second dependency check.
    const { data: oldMedia, error: mediaError } = await admin
      .from("media_assets")
      .select("id,storage_path")
      .not("deleted_at", "is", null)
      .lt("deleted_at", trashCutoff)
      .limit(500);
    if (mediaError) throw new Error(mediaError.message);

    for (const media of oldMedia ?? []) {
      if (await mediaInUse(admin, media.id)) continue;
      if (media.storage_path) {
        await removeStorage(admin, "media", [media.storage_path]);
      }
      const { error } = await admin
        .from("media_assets")
        .delete()
        .eq("id", media.id)
        .not("deleted_at", "is", null);
      if (error) throw new Error(error.message);
      result.media += 1;
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "maintenance_cleanup_run",
      entity_type: "system",
      summary: "Retention cleanup completed",
      details: {
        settings,
        trash_cutoff: trashCutoff,
        temp_cutoff: tempCutoff,
        export_cutoff: exportCutoff,
        result,
      },
    });

    return {
      ok: true,
      settings,
      result,
      preview: await buildPreview(admin, settings),
    };
  });

async function loadSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<MaintenanceSettings> {
  const { data, error } = await sb
    .from("system_settings")
    .select("value")
    .eq("key", "maintenance")
    .maybeSingle();
  if (error) throw new Error(error.message);

  const parsed = settingsSchema.safeParse(data?.value);
  return parsed.success ? parsed.data : DEFAULTS;
}

async function buildPreview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  settings: MaintenanceSettings,
) {
  const trashCutoff = new Date(
    Date.now() - settings.trash_retention_days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const tempCutoff = new Date(
    Date.now() - settings.temp_session_grace_hours * 60 * 60 * 1000,
  ).toISOString();

  const [
    questions,
    vocabulary,
    readings,
    listenings,
    catalogs,
    media,
    sourceOriginals,
    expiredExports,
    mediaUploads,
    sourceUploads,
  ] = await Promise.all([
    countDeleted(sb, "questions", trashCutoff),
    countDeleted(sb, "vocabulary_entries", trashCutoff),
    countDeleted(sb, "readings", trashCutoff),
    countDeleted(sb, "listenings", trashCutoff),
    countDeleted(sb, "catalogs", trashCutoff),
    countDeleted(sb, "media_assets", trashCutoff),
    countDeletedWithStorage(sb, "source_files", trashCutoff),
    countExpiredExports(sb),
    countExpiredSessions(sb, "media_upload_sessions", tempCutoff),
    countExpiredSessions(sb, "source_upload_sessions", tempCutoff),
  ]);

  return {
    questions,
    vocabulary,
    readings,
    listenings,
    catalogs,
    media,
    source_originals: sourceOriginals,
    expired_exports: expiredExports,
    media_upload_sessions: mediaUploads,
    source_upload_sessions: sourceUploads,
  };
}

async function countDeleted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  table: string,
  cutoff: string,
) {
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countDeletedWithStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  table: string,
  cutoff: string,
) {
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .not("storage_path", "is", null)
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countExpiredExports(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
) {
  const { count, error } = await sb
    .from("export_jobs")
    .select("id", { count: "exact", head: true })
    .not("storage_path", "is", null)
    .lt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countExpiredSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  table: string,
  cutoff: string,
) {
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .is("finalized_at", null)
    .lt("expires_at", cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function oldDeletedIds(
  admin: Admin,
  table: string,
  cutoff: string,
) {
  const { data, error } = await admin
    .from(table)
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .limit(1_000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string }) => row.id);
}

async function childIds(
  admin: Admin,
  table: string,
  foreignKey: string,
  parentIds: string[],
) {
  if (!parentIds.length) return [];
  const ids: string[] = [];
  for (const batch of chunks(parentIds, 100)) {
    const { data, error } = await admin
      .from(table)
      .select("id")
      .in(foreignKey, batch)
      .limit(10_000);
    if (error) throw new Error(error.message);
    ids.push(...(data ?? []).map((row: { id: string }) => row.id));
  }
  return ids;
}

async function cleanupPolymorphicRefs(
  admin: Admin,
  entityType: string,
  entityIds: string[],
) {
  if (!entityIds.length) return;
  for (const batch of chunks(entityIds, 100)) {
    for (const table of ["catalog_items", "favorites", "source_collection_items"]) {
      const { error } = await admin
        .from(table)
        .delete()
        .eq("entity_type", entityType)
        .in("entity_id", batch);
      if (error) throw new Error(error.message);
    }
  }
}

async function deleteByIds(
  admin: Admin,
  table: string,
  ids: string[],
) {
  let deleted = 0;
  for (const batch of chunks(ids, 100)) {
    const { data, error } = await admin
      .from(table)
      .delete()
      .in("id", batch)
      .select("id");
    if (error) throw new Error(error.message);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

async function updateRowsByIds(
  admin: Admin,
  table: string,
  ids: string[],
  values: Record<string, unknown>,
) {
  for (const batch of chunks(ids, 100)) {
    const { error } = await admin.from(table).update(values).in("id", batch);
    if (error) throw new Error(error.message);
  }
}

async function cleanupUploadSessions(
  admin: Admin,
  table: "media_upload_sessions" | "source_upload_sessions",
  bucket: "media" | "sources",
  cutoff: string,
) {
  const { data, error } = await admin
    .from(table)
    .select("id,storage_path")
    .is("finalized_at", null)
    .lt("expires_at", cutoff)
    .limit(1_000);
  if (error) throw new Error(error.message);

  const paths = (data ?? []).map((row) => row.storage_path).filter(Boolean);
  await removeStorage(admin, bucket, paths);

  const ids = (data ?? []).map((row) => row.id);
  await deleteByIds(admin, table, ids);
  return ids.length;
}

async function removeStorage(
  admin: Admin,
  bucket: string,
  paths: string[],
) {
  for (const batch of chunks(paths, 100)) {
    if (!batch.length) continue;
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(error.message);
  }
}

async function mediaInUse(admin: Admin, mediaId: string) {
  const [questions, listenings, readings, vocabulary] = await Promise.all([
    admin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("media_id", mediaId),
    admin
      .from("listenings")
      .select("id", { count: "exact", head: true })
      .eq("media_id", mediaId),
    admin
      .from("reading_media")
      .select("reading_id", { count: "exact", head: true })
      .eq("media_id", mediaId),
    admin
      .from("vocabulary_entries")
      .select("id", { count: "exact", head: true })
      .eq("audio_media_id", mediaId),
  ]);

  for (const result of [questions, listenings, readings, vocabulary]) {
    if (result.error) throw new Error(result.error.message);
  }

  return [questions, listenings, readings, vocabulary].some(
    (result) => (result.count ?? 0) > 0,
  );
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}
