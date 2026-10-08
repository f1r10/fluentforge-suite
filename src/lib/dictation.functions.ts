import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gradeDictation } from "./dictation-grading";

const submitSchema = z.object({
  attemptId: z.string().uuid(),
  listeningId: z.string().uuid(),
  response: z.string().max(15_000),
  durationMs: z.number().int().min(0).max(86_400_000).default(0),
});

type DictationFeedback = ReturnType<typeof gradeDictation>["feedback"];

export const submitListeningDictation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => submitSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { data: studentId, error: studentError } = await context.supabase.rpc("current_student_id");
    if (studentError || !studentId) throw new Error("Forbidden");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: existing, error: lookupError } = await admin
      .from("listening_dictation_attempts")
      .select("student_id,listening_id,response_text,score_percent,error_count,expected_words,feedback,show_feedback")
      .eq("id", data.attemptId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing) {
      if (
        existing.student_id !== studentId ||
        existing.listening_id !== data.listeningId ||
        existing.response_text !== data.response
      ) throw new Error("Attempt ID was already used.");
      return {
        scorePercent: existing.score_percent,
        errorCount: existing.error_count,
        expectedWords: existing.expected_words,
        feedback: existing.show_feedback ? (existing.feedback as DictationFeedback) : null,
      };
    }

    const { data: listening, error: listeningError } = await admin
      .from("listenings")
      .select("id,status,transcript,transcript_source,media_id,playback_rules")
      .eq("id", data.listeningId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (listeningError) throw new Error(listeningError.message);
    if (!listening) throw new Error("Listening is not available.");

    const rules = (listening.playback_rules ?? {}) as Record<string, unknown>;
    if (
      rules["dictation_enabled"] !== true ||
      rules["show_transcript"] === true ||
      !listening.media_id ||
      !listening.transcript?.trim() ||
      !["manual", "imported"].includes(String(listening.transcript_source || ""))
    ) throw new Error("Dictation is not available.");

    const grade = gradeDictation(listening.transcript, data.response, {
      ignoreCase: true,
      ignorePunctuation: rules["dictation_ignore_punctuation"] !== false,
      ignoreDiacritics: false,
    });
    const showFeedback = rules["dictation_show_feedback"] !== false;
    const payload = {
      id: data.attemptId,
      student_id: studentId,
      listening_id: data.listeningId,
      transcript_snapshot: listening.transcript,
      response_text: data.response,
      score_percent: grade.scorePercent,
      error_count: grade.errorCount,
      expected_words: grade.expectedWords,
      feedback: grade.feedback,
      show_feedback: showFeedback,
    };
    const { error: insertedError } = await admin
      .from("listening_dictation_attempts")
      .insert(payload);
    if (insertedError) {
      if (insertedError.code === "23505") {
        // Another request won the insert. Re-run through the lookup path.
        const { data: row, error } = await admin
          .from("listening_dictation_attempts")
          .select("student_id,listening_id,response_text,score_percent,error_count,expected_words,feedback,show_feedback")
          .eq("id", data.attemptId)
          .single();
        if (error || !row ||
            row.student_id !== studentId ||
            row.listening_id !== data.listeningId ||
            row.response_text !== data.response) throw new Error("Attempt ID was already used.");
        return {
          scorePercent: row.score_percent,
          errorCount: row.error_count,
          expectedWords: row.expected_words,
          feedback: row.show_feedback ? (row.feedback as DictationFeedback) : null,
        };
      }
      throw new Error(insertedError.message);
    }

    const { error: eventError } = await admin.from("activity_events").insert({
      student_id: studentId,
      category: "practice",
      event_type: "dictation_answer",
      entity_type: "listening",
      entity_id: listening.id,
      is_correct: grade.scorePercent === 100,
      response: { value: data.response } as never,
      duration_ms: data.durationMs,
      details: {
        attempt_id: data.attemptId,
        score: grade.scorePercent,
        error_count: grade.errorCount,
        expected_words: grade.expectedWords,
      } as never,
    });
    if (eventError) throw new Error(eventError.message);
    return {
      scorePercent: grade.scorePercent,
      errorCount: grade.errorCount,
      expectedWords: grade.expectedWords,
      feedback: showFeedback ? grade.feedback : null,
    };
  });
