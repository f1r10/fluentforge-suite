import type { Database } from "@/integrations/supabase/types";
import { evaluateLessonProgress } from "./lesson-sequencing";
import type { LessonStep } from "./lesson-mode.functions";

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

type PublishedLesson = Database["public"]["Tables"]["lesson_revisions"]["Row"];

export type LessonItemAccess = {
  revisionId: string;
  allowedItemIds: Set<string>;
  stepByItemId: Map<string, { id: string; mode: LessonStep["mode"]; state: "locked" | "available" | "completed" }>;
} | null;

/** A published lesson restricts which items are exposed and gradeable.
 * Null means legacy catalog practice with no lesson, completely unchanged.
 * This runs on the server with a trusted, already authenticated student ID.
 */
export async function lessonItemAccess(
  admin: Admin,
  catalogId: string,
  studentId: string,
): Promise<LessonItemAccess> {
  const { data: lesson, error } = await admin
    .from("lesson_revisions").select("*")
    .eq("catalog_id", catalogId).eq("state", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lesson) return null;

  const steps = (lesson as PublishedLesson).steps;
  const { z } = await import("zod");
  const stepSchema = z.object({
    id: z.string().uuid(),
    kind: z.enum(["theory", "activity"]),
    title: z.string().min(1),
    required: z.boolean(),
    mode: z.enum(["view", "attempt", "pass"]),
    minScorePercent: z.number().optional(),
    itemId: z.string().uuid().optional(),
    body: z.string().optional(),
  });
  const entries = z.array(stepSchema).min(1).max(100).parse(steps) as LessonStep[];
  const { data: rows, error: progressError } = await admin
    .from("lesson_step_progress")
    .select("step_id,viewed_at,attempted_at,best_score_percent,teacher_approved")
    .eq("revision_id", lesson.id).eq("student_id", studentId);
  if (progressError) throw new Error(progressError.message);
  const progress = evaluateLessonProgress(
    entries,
    (rows ?? []).map((row) => ({
      id: row.step_id,
      viewed: !!row.viewed_at,
      attempted: !!row.attempted_at,
      bestScorePercent: row.best_score_percent,
      teacherApproved: row.teacher_approved,
    })),
    lesson.sequential,
  );
  const allowedItemIds = new Set<string>();
  const stepByItemId = new Map<string, {
    id: string; mode: LessonStep["mode"]; state: "locked" | "available" | "completed";
  }>();
  for (const step of progress.steps) {
    const definition = entries.find((entry) => entry.id === step.id)!;
    if (definition.kind !== "activity" || !definition.itemId) continue;
    // Reusing the same item in multiple steps would make unlock ambiguous;
    // teacher draft validation should forbid it.
    if (stepByItemId.has(definition.itemId)) {
      throw new Error("Lesson contains duplicate catalog activity references.");
    }
    stepByItemId.set(definition.itemId, {
      id: step.id, mode: definition.mode, state: step.state,
    });
    if (step.state !== "locked") allowedItemIds.add(definition.itemId);
  }
  return { revisionId: lesson.id, allowedItemIds, stepByItemId };
}
