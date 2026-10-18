import type { Database } from "@/integrations/supabase/types";
import { lessonItemAccess } from "./lesson-access.server";

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;
type Score = { points: number; possible: number } | null;

/**
 * Server-only bridge between a real authoritative practice event and an
 * unlocked published lesson step. The student cannot send scores or event IDs.
 * Passing progress is only driven by scores calculated by the existing grader.
 */
export async function recordGradedLessonActivity(
  admin: Admin,
  catalogId: string,
  studentId: string,
  catalogItemId: string,
  eventId: number,
  score: Score,
): Promise<void> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new Error("The authoritative activity event is missing.");
  }
  const access = await lessonItemAccess(admin, catalogId, studentId);
  if (!access) return; // legacy catalogs behave exactly as before
  const step = access.stepByItemId.get(catalogItemId);
  if (!step || step.state === "locked") {
    // Unrestricted catalog practice remains unchanged. Attempts made before
    // a lesson step is unlocked do not automatically advance lesson progress.
    if (!access.enforceCatalogLocks) return;
    throw new Error("This lesson activity is not unlocked.");
  }

  let percent: number | null = null;
  if (score) {
    if (
      !Number.isFinite(score.points) ||
      !Number.isFinite(score.possible) ||
      score.possible <= 0
    ) throw new Error("Invalid graded lesson score.");
    percent = Math.max(0, Math.min(100, (score.points / score.possible) * 100));
  }
  // Only the service-role RPC can write progress. It also checks that the
  // referenced grading event belongs to the same student and revision.
  const args: Database["public"]["Functions"]["record_lesson_step_grade"]["Args"] = {
    p_revision_id: access.revisionId,
    p_student_id: studentId,
    p_step_id: step.id,
    p_score_percent: percent,
    p_event_id: eventId,
  };
  const { error } = await admin.rpc("record_lesson_step_grade", args);
  if (error) throw new Error(error.message);
}
