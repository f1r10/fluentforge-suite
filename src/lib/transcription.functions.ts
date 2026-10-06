import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { getProcessingService } from "./processing.service";

const MEDIA_BUCKET = "media";

export const startListeningTranscription = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ listeningId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: listening, error } = await admin
      .from("listenings")
      .select(
        "id,title,media_id,learning_language,media_assets(id,kind,storage_path,external_url,original_filename,deleted_at)",
      )
      .eq("id", data.listeningId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listening?.media_id) throw new Error("Attach audio or video media first.");

    const media = listening.media_assets as unknown as {
      id: string;
      kind: string;
      storage_path: string | null;
      external_url: string | null;
      original_filename: string | null;
      deleted_at: string | null;
    } | null;

    if (!media || media.deleted_at || !["audio", "video"].includes(media.kind)) {
      throw new Error("Listening media is not available for transcription.");
    }

    const { data: existing } = await admin
      .from("processing_jobs")
      .select("id,status")
      .eq("kind", "transcription")
      .eq("entity_type", "listening")
      .eq("entity_id", listening.id)
      .in("status", ["queued", "processing"])
      .limit(1)
      .maybeSingle();
    if (existing) return { jobId: existing.id, reused: true };

    let sourceUrl = media.external_url;
    if (!sourceUrl && media.storage_path) {
      const { data: signed, error: signedError } = await admin.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(media.storage_path, 2 * 60 * 60);
      if (signedError || !signed) {
        throw new Error(
          signedError?.message ?? "Could not authorize media transcription.",
        );
      }
      sourceUrl = signed.signedUrl;
    }
    if (!sourceUrl) throw new Error("Listening media has no accessible source.");

    const submitted = await getProcessingService().transcribeMedia({
      mediaId: media.id,
      sourceUrl,
      filename: media.original_filename ?? `listening-${listening.id}`,
      language: listening.learning_language ?? undefined,
    });
    if (submitted.status === "not_implemented" || !submitted.jobId) {
      throw new Error(
        submitted.message ?? "Local transcription service is not configured.",
      );
    }

    const { data: job, error: jobError } = await admin
      .from("processing_jobs")
      .insert({
        kind: "transcription",
        entity_type: "listening",
        entity_id: listening.id,
        processor_job_id: submitted.jobId,
        status: submitted.status === "processing" ? "processing" : "queued",
        progress: submitted.progress ?? 0,
        params: {
          media_id: media.id,
          language: listening.learning_language,
        },
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create transcription job.");
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "listening_transcription_started",
      entity_type: "listening",
      entity_id: listening.id,
      summary: `Started local transcription for "${listening.title}"`,
      details: { processing_job_id: job.id },
    });

    return { jobId: job.id, reused: false };
  });

export const syncTranscriptionJob = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: job, error } = await admin
      .from("processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("kind", "transcription")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Transcription job not found.");

    if (job.status === "completed" || job.status === "failed") {
      return { status: job.status, progress: job.progress };
    }

    const state = await getProcessingService().getImportStatus(
      job.processor_job_id,
    );
    const mappedStatus =
      state.status === "not_implemented" ? "failed" : state.status;

    await admin
      .from("processing_jobs")
      .update({
        status: mappedStatus,
        progress: state.progress ?? 0,
        result: (state.result ?? {}) as never,
        error: state.error ?? state.message ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (mappedStatus === "completed" && job.entity_id) {
      const result = state.result ?? {};
      const transcript =
        typeof result["transcript"] === "string" ? result["transcript"] : "";
      const segments = Array.isArray(result["segments"]) ? result["segments"] : [];

      if (!transcript) {
        throw new Error("Transcription service completed without transcript text.");
      }

      const { error: updateError } = await admin
        .from("listenings")
        .update({
          transcript,
          transcript_segments: segments as never,
          transcript_source: "local_whisper",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.entity_id);
      if (updateError) throw new Error(updateError.message);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "listening_transcription_completed",
        entity_type: "listening",
        entity_id: job.entity_id,
        summary: "Local Whisper transcription completed",
        details: {
          processing_job_id: job.id,
          language: result["language"] ?? null,
          model: result["model"] ?? null,
          segments: segments.length,
        },
      });
    }

    return { status: mappedStatus, progress: state.progress ?? 0 };
  });

export const getListeningTranscriptionJob = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ listeningId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("processing_jobs")
      .select("id,status,progress,error,result,created_at,updated_at")
      .eq("kind", "transcription")
      .eq("entity_type", "listening")
      .eq("entity_id", data.listeningId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return job ?? null;
  });
