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
const documentExtensions = new Set(["pdf", "epub", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "ppt", "pptx"]);

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

function normalizeYouTubeUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid YouTube URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP(S) YouTube URLs are accepted.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (!allowed.has(host)) {
    throw new Error("Only YouTube URLs are accepted.");
  }
  if (url.searchParams.has("list")) {
    throw new Error("Import one YouTube video at a time, not a playlist.");
  }

  return url.toString();
}

function youtubeVideoId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0] ?? "")) {
      return parts[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
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

export const listYouTubeImports = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("media_import_jobs")
      .select(
        "id,source_url,status,progress,error,result,media_asset_id,created_at,updated_at,completed_at",
      )
      .eq("source_kind", "youtube")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveYouTubeReference = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        url: z.string().trim().min(1).max(2_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sourceUrl = normalizeYouTubeUrl(data.url);
    const videoId = youtubeVideoId(sourceUrl);
    if (!videoId) throw new Error("Could not determine the YouTube video id.");

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: media, error } = await admin
      .from("media_assets")
      .insert({
        kind: "other",
        storage_path: null,
        external_url: sourceUrl,
        original_filename: `YouTube ${videoId}`,
        mime_type: "text/html",
        size_bytes: null,
        checksum: null,
        metadata: {
          source: "youtube",
          youtube_video_id: videoId,
          reference_only: true,
          embed_url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
            videoId,
          )}`,
        },
      })
      .select("id")
      .single();
    if (error || !media) {
      throw new Error(error?.message ?? "Could not save YouTube reference.");
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "youtube_reference_saved",
      entity_type: "media",
      entity_id: media.id,
      summary: "Saved a YouTube reference without downloading media",
      details: {
        source_url: sourceUrl,
        video_id: videoId,
      },
    });

    return { id: media.id };
  });

export const startYouTubeImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        url: z.string().trim().min(1).max(2_000),
        rightsConfirmed: z.literal(true),
        preferredHeight: z.number().int().min(144).max(2160).default(1080),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sourceUrl = normalizeYouTubeUrl(data.url);
    const maxVideoMb = await configuredMaxVideoMb(context.supabase);
    const maxAllowedBytes = maxVideoMb * MiB;
    const id = crypto.randomUUID();
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const storagePath = `video/${yyyy}/${mm}/${id}-youtube.mp4`;

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { error: insertError } = await admin
      .from("media_import_jobs")
      .insert({
        id,
        source_kind: "youtube",
        source_url: sourceUrl,
        storage_path: storagePath,
        status: "queued",
        progress: 0,
        rights_confirmed_at: now.toISOString(),
      });
    if (insertError) throw new Error(insertError.message);

    try {
      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);
      if (signedError || !signed?.signedUrl) {
        throw new Error(
          signedError?.message ?? "Could not authorize media import upload.",
        );
      }

      const { getProcessingService } = await import("./processing.service");
      const processing = await getProcessingService().importYouTube({
        sourceUrl,
        uploadUrl: signed.signedUrl,
        maxBytes: maxAllowedBytes,
        preferredHeight: data.preferredHeight,
      });
      if (
        processing.status === "not_implemented" ||
        !processing.jobId
      ) {
        throw new Error(
          processing.message ?? "YouTube processing service is unavailable.",
        );
      }

      const { error: updateError } = await admin
        .from("media_import_jobs")
        .update({
          processor_job_id: processing.jobId,
          status:
            processing.status === "processing"
              ? "processing"
              : "queued",
          progress: processing.progress ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "youtube_import_started",
        entity_type: "media_import",
        entity_id: id,
        summary: "Started authorized YouTube media import",
        details: {
          source_url: sourceUrl,
          max_video_mb: maxVideoMb,
          preferred_height: data.preferredHeight,
        },
      });

      return {
        id,
        status: processing.status,
        maxVideoMb,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      await admin
        .from("media_import_jobs")
        .update({
          status: "failed",
          progress: 100,
          error: message.slice(0, 5_000),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      const { notifyTeacher } = await import("./notifications.functions");
      await notifyTeacher(admin, {
        kind: "media_import_failed",
        title: "YouTube import could not start",
        body: message,
        link: "/teacher/media",
        data: { media_import_job_id: id, source_url: sourceUrl },
        dedupeKey: `youtube-import-failed:${id}`,
      });
      throw error;
    }
  });

export const syncYouTubeImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: job, error: jobError } = await admin
      .from("media_import_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("source_kind", "youtube")
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("YouTube import job not found.");
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    if (!job.processor_job_id) {
      throw new Error("YouTube import is not linked to a processing job.");
    }

    const { getProcessingService } = await import("./processing.service");
    const state = await getProcessingService().getImportStatus(
      job.processor_job_id,
    );

    if (state.status === "failed" || state.status === "not_implemented") {
      const message =
        state.error ?? state.message ?? "YouTube import failed.";
      await admin.storage.from(BUCKET).remove([job.storage_path]);
      await admin
        .from("media_import_jobs")
        .update({
          status: "failed",
          progress: 100,
          error: message.slice(0, 5_000),
          result: (state.result ?? {}) as never,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const { notifyTeacher } = await import("./notifications.functions");
      await notifyTeacher(admin, {
        kind: "media_import_failed",
        title: "YouTube import failed",
        body: message,
        link: "/teacher/media",
        data: {
          media_import_job_id: job.id,
          source_url: job.source_url,
        },
        dedupeKey: `youtube-import-failed:${job.id}`,
      });

      return { ...job, status: "failed", progress: 100, error: message };
    }

    if (state.status !== "completed") {
      const status =
        state.status === "processing" ? "processing" : "queued";
      await admin
        .from("media_import_jobs")
        .update({
          status,
          progress: state.progress ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return {
        ...job,
        status,
        progress: state.progress ?? 0,
      };
    }

    const result = state.result ?? {};
    const checksum =
      typeof result["checksum_sha256"] === "string" &&
      /^[a-f0-9]{64}$/i.test(result["checksum_sha256"])
        ? result["checksum_sha256"].toLowerCase()
        : null;
    const sizeBytes = Number(result["size_bytes"] ?? 0);
    const maxVideoMb = await configuredMaxVideoMb(context.supabase);
    if (
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > maxVideoMb * MiB
    ) {
      await admin.storage.from(BUCKET).remove([job.storage_path]);
      throw new Error("Imported media size is invalid.");
    }

    let mediaId: string | null = null;
    if (checksum) {
      const { data: existing, error: existingError } = await admin
        .from("media_assets")
        .select("id")
        .eq("checksum", checksum)
        .is("deleted_at", null)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) {
        mediaId = existing.id;
        await admin.storage.from(BUCKET).remove([job.storage_path]);
      }
    }

    if (!mediaId) {
      const title =
        typeof result["title"] === "string"
          ? result["title"]
          : "YouTube video";
      const filename =
        typeof result["filename"] === "string"
          ? result["filename"].slice(0, 255)
          : `${safeFilename(title)}.mp4`;
      const mimeType =
        typeof result["mime_type"] === "string"
          ? result["mime_type"].slice(0, 255)
          : "video/mp4";

      const { data: media, error: mediaError } = await admin
        .from("media_assets")
        .insert({
          kind: "video",
          storage_path: job.storage_path,
          external_url: null,
          original_filename: filename,
          mime_type: mimeType,
          size_bytes: Math.floor(sizeBytes),
          checksum,
          duration_seconds:
            typeof result["duration_seconds"] === "number"
              ? result["duration_seconds"]
              : null,
          width:
            typeof result["width"] === "number"
              ? Math.floor(result["width"])
              : null,
          height:
            typeof result["height"] === "number"
              ? Math.floor(result["height"])
              : null,
          metadata: {
            source: "youtube",
            source_url: job.source_url,
            youtube_video_id:
              typeof result["source_id"] === "string"
                ? result["source_id"]
                : null,
            title,
            uploader:
              typeof result["uploader"] === "string"
                ? result["uploader"]
                : null,
            channel:
              typeof result["channel"] === "string"
                ? result["channel"]
                : null,
            thumbnail:
              typeof result["thumbnail"] === "string"
                ? result["thumbnail"]
                : null,
            processor_job_id: job.processor_job_id,
            imported_at: new Date().toISOString(),
            rights_confirmed_at: job.rights_confirmed_at,
          },
        } as never)
        .select("id")
        .single();
      if (mediaError || !media) {
        throw new Error(
          mediaError?.message ?? "Could not finalize YouTube media.",
        );
      }
      mediaId = media.id;
    }

    const completedAt = new Date().toISOString();
    await admin
      .from("media_import_jobs")
      .update({
        status: "completed",
        progress: 100,
        media_asset_id: mediaId,
        result: result as never,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", job.id);

    const { notifyTeacher } = await import("./notifications.functions");
    await notifyTeacher(admin, {
      kind: "media_import_completed",
      title: "YouTube import completed",
      body:
        typeof result["title"] === "string"
          ? result["title"]
          : "The video is available in Media Library.",
      link: "/teacher/media",
      data: {
        media_import_job_id: job.id,
        media_asset_id: mediaId,
      },
      dedupeKey: `youtube-import-completed:${job.id}`,
    });

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "youtube_import_completed",
      entity_type: "media",
      entity_id: mediaId,
      summary: "Completed authorized YouTube media import",
      details: {
        media_import_job_id: job.id,
        source_url: job.source_url,
        checksum,
        size_bytes: sizeBytes,
      },
    });

    return {
      ...job,
      status: "completed",
      progress: 100,
      media_asset_id: mediaId,
      result,
      completed_at: completedAt,
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
      .select("id,kind,mime_type,storage_path,external_url")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!media) throw new Error("Media not found.");
    if (media.external_url) return { url: media.external_url, expiresIn: null, kind: media.kind, mimeType: media.mime_type };
    if (!media.storage_path) throw new Error("Media has no storage location.");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: signed, error: signedError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(media.storage_path, 15 * 60);
    if (signedError || !signed) {
      throw new Error(signedError?.message ?? "Could not create preview URL.");
    }

    return { url: signed.signedUrl, expiresIn: 15 * 60, kind: media.kind, mimeType: media.mime_type };
  });

export const trashMedia = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [questions, listenings, readings, vocabulary, libraryBooks] =
      await Promise.all([
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
        context.supabase
          .from("library_books")
          .select("id", { count: "exact", head: true })
          .eq("media_id", data.id)
          .is("deleted_at", null),
      ]);

    for (const result of [
      questions,
      listenings,
      readings,
      vocabulary,
      libraryBooks,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const dependencies = {
      questions: questions.count ?? 0,
      listenings: listenings.count ?? 0,
      readings: readings.count ?? 0,
      vocabulary: vocabulary.count ?? 0,
      library: libraryBooks.count ?? 0,
    };
    if (Object.values(dependencies).some((count) => count > 0)) {
      throw new Error(
        `Media is still in use (questions: ${dependencies.questions}, listenings: ${dependencies.listenings}, readings: ${dependencies.readings}, vocabulary: ${dependencies.vocabulary}, library: ${dependencies.library}).`,
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
