/** Trusted Lesson Mode progress writer.
 * Only called AFTER server-side grading; never accept score fields from a client.
 * Legacy catalog practice works unchanged when no lesson is published.
 */
import type { adminClient } from "./security.server";
import type { LessonStepRule, LessonStepOutcome } from "./lesson-sequencing";
import { evaluateLessonProgress } from "./lesson-sequencing";

type Admin = Awaited<ReturnType<typeof adminClient>>;
type PublishedStep = LessonStepRule & {
  entity_type: "question" | "vocabulary" | "reading" | "listening";
  entity_id: string;
  question_version?: number | null;
  title?: string | null;
};
type Publication = {
  catalog_id: string;
  revision: number;
  title: string;
  sequential: boolean;
  steps: PublishedStep[];
  published_at: string;
};

function db(admin: Admin) {
  // Newly-added lesson tables are additive migrations; generated Supabase
  // types are refreshed in a separate build-time database codegen workflow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export async function latestPublishedLesson(
  admin: Admin, catalogId: string,
): Promise<Publication | null> {
  const { data, error } = await db(admin).from("lesson_publications")
    .select("catalog_id,revision,title,sequential,steps,published_at")
    .eq("catalog_id", catalogId).order("revision", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Publication | null;
}

export async function lessonProgress(
  admin: Admin,
  studentId: string,
  lesson: Publication,
) {
  const [views, attempts] = await Promise.all([
    db(admin).from("student_lesson_views")
      .select("step_id").eq("student_id", studentId)
      .eq("catalog_id", lesson.catalog_id).eq("revision", lesson.revision),
    db(admin).rpc("lesson_attempt_summary", {
      _student_id: studentId,
      _catalog_id: lesson.catalog_id,
      _revision: lesson.revision,
    }),
  ]);
  if (views.error) throw new Error(views.error.message);
  if (attempts.error) throw new Error(attempts.error.message);
  const outcomes = new Map<string, LessonStepOutcome>();
  for (const row of views.data ?? []) {
    outcomes.set(row.step_id, { id: row.step_id, viewed: true });
  }
  for (const row of attempts.data ?? []) {
    const existing = outcomes.get(row.step_id) ?? { id: row.step_id };
    const score = Number(row.best_score_percent);
    outcomes.set(row.step_id, {
      ...existing, attempted: Number(row.attempt_count) > 0,
      bestScorePercent: Math.max(existing.bestScorePercent ?? 0, score),
    });
  }
  return evaluateLessonProgress(
    lesson.steps, [...outcomes.values()], lesson.sequential,
  );
}

type GradedItem = {
  entity_id: string;
  entity_type: "question" | "vocabulary";
  question_version?: number | null;
  score_percent: number;
  source_event_id: number;
};

export async function recordVerifiedLessonAttempts(
  admin: Admin, studentId: string, catalogId: string, graded: GradedItem[],
) {
  if (!graded.length) return;
  const lesson = await latestPublishedLesson(admin, catalogId);
  if (!lesson) return;
  const entries = [];
  for (const item of graded) {
    const step = lesson.steps.find((s) =>
      s.entity_type === item.entity_type && s.entity_id === item.entity_id &&
      (item.entity_type !== "question" ||
        stepVersionMatches(s.question_version, item.question_version)));
    if (!step) continue;
    entries.push({
      student_id: studentId,
      catalog_id: catalogId,
      revision: lesson.revision,
      step_id: step.id,
      source_event_id: item.source_event_id,
      score_percent: Math.max(0, Math.min(100, item.score_percent)),
    });
  }
  if (!entries.length) return;
  const { error } = await db(admin).from("student_lesson_attempts")
    .upsert(entries, {
      onConflict: "student_id,catalog_id,revision,step_id,source_event_id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);
}

function stepVersionMatches(
  publishedVersion: number | null | undefined,
  attemptedVersion: number | null | undefined,
): boolean {
  return typeof publishedVersion === "number" &&
    typeof attemptedVersion === "number" &&
    publishedVersion === attemptedVersion;
}


/** Content availability is evaluated from server-verified completed steps.
 * No publication => exact legacy catalog behavior remains unchanged.
 */
export async function permittedLessonContent(
  admin: Admin, studentId: string, catalogId: string,
): Promise<Set<string> | null> {
  const published = await latestPublishedLesson(admin, catalogId);
  if (!published) return null;
  const progress = await lessonProgress(admin, studentId, published);
  const permittedSteps = new Set(
    progress.steps.filter((step) => step.state !== "locked").map((step) => step.id),
  );
  return new Set(published.steps.filter((step) => permittedSteps.has(step.id))
    .map((step) => step.entity_type + ":" + step.entity_id));
}

/** Reject direct API attempts to answer a locked lesson's questions.
 * Questions within an available reading/listening block remain permitted.
 */
export async function assertLessonQuestionsAllowed(
  admin: Admin, studentId: string, catalogId: string,
  questions: Array<{
    id: string;
    reading_question_set_id: string | null;
    listening_question_set_id: string | null;
  }>,
): Promise<void> {
  const allowed = await permittedLessonContent(admin, studentId, catalogId);
  if (!allowed) return;
  const unavailable = questions.filter((item) => !allowed.has("question:" + item.id));
  if (!unavailable.length) return;

  const readingIds = [...new Set(unavailable.map((q) => q.reading_question_set_id)
    .filter((id): id is string => !!id))];
  const listeningIds = [...new Set(unavailable.map((q) => q.listening_question_set_id)
    .filter((id): id is string => !!id))];
  const [readingSets, listeningSets] = await Promise.all([
    readingIds.length ? admin.from("reading_question_sets")
      .select("id,reading_id").in("id", readingIds)
      : Promise.resolve({ data: [], error: null }),
    listeningIds.length ? admin.from("listening_question_sets")
      .select("id,listening_id").in("id", listeningIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (readingSets.error) throw new Error(readingSets.error.message);
  if (listeningSets.error) throw new Error(listeningSets.error.message);
  const readingParents = new Map((readingSets.data ?? []).map((r) => [r.id, r.reading_id]));
  const listeningParents = new Map((listeningSets.data ?? []).map((r) => [r.id, r.listening_id]));
  for (const question of unavailable) {
    const readingParent = question.reading_question_set_id
      ? readingParents.get(question.reading_question_set_id) : null;
    const listeningParent = question.listening_question_set_id
      ? listeningParents.get(question.listening_question_set_id) : null;
    if ((readingParent && allowed.has("reading:" + readingParent)) ||
        (listeningParent && allowed.has("listening:" + listeningParent))) {
      continue;
    }
    throw new Error("Finish the preceding lesson steps before answering this question.");
  }
}
