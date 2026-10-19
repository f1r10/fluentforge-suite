/** Server-only lesson progression; never infer a grade from untrusted client payloads. */
import type { adminClient } from "./security.server";
import { evaluateLessonProgress, type LessonStepRule, type LessonStepOutcome } from "./lesson-sequencing";

type Admin = Awaited<ReturnType<typeof adminClient>>;
export type PublishedStep = LessonStepRule & {
  entity_type: "question" | "vocabulary" | "reading" | "listening";
  entity_id: string;
  question_version: number | null;
};
export type Publication = {
  catalog_id: string;
  revision: number;
  title: string;
  sequential: boolean;
  steps: PublishedStep[];
  published_at: string;
};

function db(admin: Admin) {
  // The generated types have not yet been regenerated after migration 0046.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export async function latestPublishedLesson(
  admin: Admin, catalogId: string,
): Promise<Publication | null> {
  const { data, error } = await db(admin).from("lesson_publications")
    .select("catalog_id,revision,title,sequential,steps,published_at")
    .eq("catalog_id", catalogId)
    .order("revision", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as Publication | null;
}

export async function computeLessonProgress(
  admin: Admin, studentId: string, lesson: Publication,
) {
  const [viewResult, attemptResult] = await Promise.all([
    db(admin).from("student_lesson_views").select("step_id")
      .eq("student_id", studentId)
      .eq("catalog_id", lesson.catalog_id)
      .eq("revision", lesson.revision),
    db(admin).from("student_lesson_attempts").select("step_id,score_percent")
      .eq("student_id", studentId)
      .eq("catalog_id", lesson.catalog_id)
      .eq("revision", lesson.revision),
  ]);
  if (viewResult.error) throw new Error(viewResult.error.message);
  if (attemptResult.error) throw new Error(attemptResult.error.message);
  const outcomes = new Map<string, LessonStepOutcome>();
  for (const row of (viewResult.data ?? []) as Array<{ step_id: string }>) {
    outcomes.set(row.step_id, { id: row.step_id, viewed: true });
  }
  for (const row of (attemptResult.data ?? []) as Array<{
    step_id: string; score_percent: number | string;
  }>) {
    const previous = outcomes.get(row.step_id) ?? { id: row.step_id };
    const score = Number(row.score_percent);
    outcomes.set(row.step_id, {
      ...previous,
      attempted: true,
      bestScorePercent: Math.max(previous.bestScorePercent ?? 0, score),
    });
  }
  return evaluateLessonProgress(lesson.steps, [...outcomes.values()], lesson.sequential);
}

export type VerifiedGrade = {
  entity_id: string;
  entity_type: "question" | "vocabulary";
  question_version?: number | null;
  activity_event_id: number;
  score_percent: number;
};

/** Invoke only after an authoritative server grade has been persisted. */
export async function recordVerifiedLessonAttempts(
  admin: Admin, studentId: string, catalogId: string, grades: VerifiedGrade[],
) {
  if (!grades.length) return;
  const lesson = await latestPublishedLesson(admin, catalogId);
  if (!lesson) return;

  const rows: Array<{
    student_id: string; catalog_id: string; revision: number;
    step_id: string; activity_event_id: number; score_percent: number;
  }> = [];
  for (const grade of grades) {
    if (!Number.isFinite(grade.score_percent)) continue;
    const step = lesson.steps.find((candidate) =>
      candidate.entity_type === grade.entity_type &&
      candidate.entity_id === grade.entity_id &&
      (grade.entity_type !== "question" ||
        candidate.question_version === grade.question_version),
    );
    if (!step) continue;
    rows.push({
      student_id: studentId,
      catalog_id: catalogId,
      revision: lesson.revision,
      step_id: step.id,
      activity_event_id: grade.activity_event_id,
      score_percent: Math.min(100, Math.max(0, grade.score_percent)),
    });
  }
  if (!rows.length) return;
  const { error } = await db(admin).from("student_lesson_attempts")
    .upsert(rows, { onConflict: "activity_event_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
