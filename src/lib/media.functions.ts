import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const BUCKET = "media";
const PAGE_SIZE = 40;
const MiB = 1024 * 1024;

const MEDIA_KINDS = ["image", "audio", "video", "document", "other"] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

const blockedExtensions = new Set([
  "exe",
  "dll",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "vbs",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "svg",
  "php",
  "sh",
  "jar",
  "apk",
  "docm",
  "xlsm",
  "pptm",
]);

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic"]);
const audioExtensions = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "weba"]);
const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi"]);
const documentExtensions = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "ppt", "pptx"]);

function extension(filename: string) {
  const part = filename.trim().toLowerCase().split(".").pop();
  return part && part !== filename.toLowerCase() ? part : "";
}

function deriveKind(filename: string, mimeType: string): MediaKind {
  const ext = extension(filename);
  if (blockedExtensions.has(ext)) {
    throw new Error("This file type is not allowed.");
  }

  if (mimeType.startsWith("image/") || imageExtensions.has(ext)) return "image";
  if (mimeType.startsWith("audio/") || audioExtensions.has(ext)) return "audio";
  if (mimeType.startsWith("video/") || videoExtensions.has(ext)) return "video";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    documentExtensions.has(ext)
  ) {
    return "document";
  }

  return "other";
}

function safeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  return cleaned || "upload";
}

function maxBytes(kind: MediaKind, maxVideoMb: number) {
  if (kind === "video") return maxVideoMb * MiB;
  if (kind === "audio") return 500 * MiB;
  if (kind === "image") return 50 * MiB;
  if (kind === "document") return 100 * MiB;
  return 100 * MiB;
}

async function configuredMaxVideoMb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
) {
  const { data, error } = await sb
    .from("system_settings")
    .select("value")
    .eq("key", "media")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value =
    data?.value && typeof data.value === "object"
      ? (data.value as Record<string, unknown>)
      : {};
  const configured = Number(value["max_video_mb"] ?? 700);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 2_048)
    : 700;
}

export const listMedia = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        kind: z.enum(["all", ...MEDIA_KINDS]).default("all"),
        includeDeleted: z.boolean().default(false),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("media_assets")
      .select(
        "id,kind,storage_path,external_url,original_filename,mime_type,size_bytes,duration_seconds,width,height,metadata,created_at,deleted_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (!data.includeDeleted) query = query.is("deleted_at", null);
    if (data.kind !== "all") query = query.eq("kind", data.kind);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      query = query.ilike("original_filename", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const createMediaUploadSession = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255).default("application/octet-stream"),
        sizeBytes: z.number().int().min(1).max(2_500 * MiB),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const kind = deriveKind(data.filename, data.mimeType);
    const maxVideoMb = await configuredMaxVideoMb(context.supabase);
    const limit = maxBytes(kind, maxVideoMb);
    if (data.sizeBytes > limit) {
      throw new Error(
        kind === "video"
          ? `Video files are limited to ${maxVideoMb} MB.`
          : `This ${kind} file is too large.`,
      );
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const storagePath = `${kind}/${yyyy}/${mm}/${crypto.randomUUID()}-${safeFilename(data.filename)}`;
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

    const { data: session, error: sessionError } = await admin
      .from("media_upload_sessions")
      .insert({
        storage_path: storagePath,
        kind,
        original_filename: data.filename,
        mime_type: data.mimeType || null,
        expected_size_bytes: data.sizeBytes,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (sessionError || !session) {
      throw new Error(sessionError?.message ?? "Could not create upload session.");
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (signedError || !signed) {
      await admin.from("media_upload_sessions").delete().eq("id", session.id);
      throw new Error(signedError?.message ?? "Could not authorize upload.");
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "media_upload_started",
      entity_type: "media_upload",
      entity_id: session.id,
      summary: `Started media upload "${data.filename}"`,
      details: {
        kind,
        size_bytes: data.sizeBytes,
      },
    });

    return {
      sessionId: session.id,
      bucket: BUCKET,
      path: storagePath,
      token: signed.token,
      kind,
      expiresAt,
      maxVideoMb,
    };
  });

export const finalizeMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        checksum: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().default(null),
        durationSeconds: z.number().min(0).max(86_400).nullable().default(null),
        width: z.number().int().min(1).max(100_000).nullable().default(null),
        height: z.number().int().min(1).max(100_000).nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: session, error: sessionError } = await admin
      .from("media_upload_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("Upload session not found.");
    if (session.finalized_at && session.media_asset_id) {
      return { id: session.media_asset_id, deduplicated: false };
    }
    if (Date.now() > new Date(session.expires_at).getTime()) {
      throw new Error("Upload session expired.");
    }

    const slash = session.storage_path.lastIndexOf("/");
    const folder = slash >= 0 ? session.storage_path.slice(0, slash) : "";
    const name = slash >= 0 ? session.storage_path.slice(slash + 1) : session.storage_path;

    const { data: objects, error: objectError } = await admin.storage
      .from(BUCKET)
      .list(folder, { search: name, limit: 10 });
    if (objectError) throw new Error(objectError.message);

    const object = (objects ?? []).find((candidate) => candidate.name === name);
    if (!object) throw new Error("Uploaded object was not found.");

    const storedSize = Number(
      (object.metadata as Record<string, unknown> | null)?.["size"] ??
        session.expected_size_bytes,
    );
    if (
      Number.isFinite(storedSize) &&
      Math.abs(storedSize - session.expected_size_bytes) > 0
    ) {
      await admin.storage.from(BUCKET).remove([session.storage_path]);
      throw new Error("Uploaded file size does not match the authorized upload.");
    }

    if (data.checksum) {
      const { data: existing, error: existingError } = await admin
        .from("media_assets")
        .select("id")
        .eq("checksum", data.checksum.toLowerCase())
        .is("deleted_at", null)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) {
        await admin.storage.from(BUCKET).remove([session.storage_path]);
        await admin
          .from("media_upload_sessions")
          .update({
            finalized_at: new Date().toISOString(),
            media_asset_id: existing.id,
          })
          .eq("id", session.id);

        return { id: existing.id, deduplicated: true };
      }
    }

    const { data: media, error: mediaError } = await admin
      .from("media_assets")
      .insert({
        kind: session.kind,
        storage_path: session.storage_path,
        original_filename: session.original_filename,
        mime_type: session.mime_type,
        size_bytes: session.expected_size_bytes,
        checksum: data.checksum?.toLowerCase() ?? null,
        duration_seconds: data.durationSeconds,
        width: data.width,
        height: data.height,
        metadata: {
          storage_adapter: "supabase",
          upload_session_id: session.id,
        },
      })
      .select("id")
      .single();
    if (mediaError || !media) {
      throw new Error(mediaError?.message ?? "Could not save media metadata.");
    }

    await admin
      .from("media_upload_sessions")
      .update({
        finalized_at: new Date().toISOString(),
        media_asset_id: media.id,
      })
      .eq("id", session.id);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "media_uploaded",
      entity_type: "media",
      entity_id: media.id,
      summary: `Uploaded media "${session.original_filename}"`,
      details: {
        kind: session.kind,
        size_bytes: session.expected_size_bytes,
      },
    });

    return { id: media.id, deduplicated: false };
  });

export const getMediaPreviewUrl = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: media, error } = await context.supabase
      .from("media_assets")
      .select("id,storage_path,external_url")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!media) throw new Error("Media not found.");
    if (media.external_url) return { url: media.external_url, expiresIn: null };
    if (!media.storage_path) throw new Error("Media has no storage location.");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: signed, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(media.storage_path, 15 * 60);
    if (signedError || !signed) {
      throw new Error(signedError?.message ?? "Could not create preview URL.");
    }

    return { url: signed.signedUrl, expiresIn: 15 * 60 };
  });

export const trashMedia = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [questions, listenings, readings, vocabulary] = await Promise.all([
      context.supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("media_id", data.id)
        .is("deleted_at", null),
      context.supabase
        .from("listenings")
        .select("id", { count: "exact", head: true })
        .eq("media_id", data.id)
        .is("deleted_at", null),
      context.supabase
        .from("reading_media")
        .select("reading_id", { count: "exact", head: true })
        .eq("media_id", data.id),
      context.supabase
        .from("vocabulary_entries")
        .select("id", { count: "exact", head: true })
        .eq("audio_media_id", data.id)
        .is("deleted_at", null),
    ]);

    for (const result of [questions, listenings, readings, vocabulary]) {
      if (result.error) throw new Error(result.error.message);
    }

    const dependencies = {
      questions: questions.count ?? 0,
      listenings: listenings.count ?? 0,
      readings: readings.count ?? 0,
      vocabulary: vocabulary.count ?? 0,
    };
    if (Object.values(dependencies).some((count) => count > 0)) {
      throw new Error(
        `Media is still in use (questions: ${dependencies.questions}, listenings: ${dependencies.listenings}, readings: ${dependencies.readings}, vocabulary: ${dependencies.vocabulary}).`,
      );
    }

    const { error } = await context.supabase
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreMedia = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("media_assets")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
