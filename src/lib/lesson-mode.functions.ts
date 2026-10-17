import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTeacher } from "./teacher-middleware";
import {
  evaluateLessonProgress,
  validateLessonStepRules,
  type LessonStepOutcome,
} from "./lesson-sequencing";

const uuid = z.string().uuid();
const lessonStepSchema = z.object({
  id: uuid,
  kind: z.enum(["theory", "activity"]),
  title: z.string().trim().min(1).max(200),
  required: z.boolean(),
  mode: z.enum(["view", "attempt", "pass"]),
  minScorePercent: z.number().min(0).max(100).optional(),
  itemId: uuid.optional(),
  body: z.string().max(30_000).optional(),
}).strict().superRefine((step, ctx) => {
  if (step.kind === "theory" && (step.mode !== "view" || !step.body?.trim() || step.itemId)) {
    ctx.addIssue({ code: "custom", message: "A theory step must contain text and use view completion." });
  }
  if (step.kind === "activity" && (!step.itemId || step.mode === "view" || step.body)) {
    ctx.addIssue({ code: "custom", message: "An activity step must reference a catalog item and use attempt/pass." });
  }
  if (step.mode === "pass" && step.minScorePercent === undefined) {
    ctx.addIssue({ code: "custom", message: "A passing step needs a minimum score." });
  }
});
export type LessonStep = z.infer<typeof lessonStepSchema>;

const lessonInputSchema = z.object({
  catalogId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  sequential: z.boolean().default(true),
  steps: z.array(lessonStepSchema).min(1).max(100),
}).strict();
const lessonIdentitySchema = z.object({ catalogId: uuid });

function parseSteps(value: unknown): LessonStep[] {
  const steps = z.array(lessonStepSchema).min(1).max(100).parse(value);
  validateLessonStepRules(steps);
  return steps;
}

async function assertActiveCatalog(catalogId: string) {
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { data, error } = await admin
    .from("catalogs")
    .select("id,name,status")
    .eq("id", catalogId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog not found or inactive.");
  return { admin, catalog: data };
}

async function assertAssignedCatalog(studentId: string, catalogId: string): Promise<void> {
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { data: direct, error: directError } = await admin
    .from("catalog_assignments").select("id")
    .eq("catalog_id", catalogId).eq("student_id", studentId).limit(1);
  if (directError) throw new Error(directError.message);
  if (direct?.length) return;

  const { data: memberships, error: memberError } = await admin
    .from("group_memberships").select("group_id").eq("student_id", studentId);
  if (memberError) throw new Error(memberError.message);
  const groupIds = (memberships ?? []).map((row) => row.group_id);
  if (!groupIds.length) throw new Error("Lesson is not assigned to you.");

  const { data: assigned, error } = await admin
    .from("catalog_assignments").select("id")
    .eq("catalog_id", catalogId).in("group_id", groupIds).limit(1);
  if (error) throw new Error(error.message);
  if (!assigned?.length) throw new Error("Lesson is not assigned to you.");
}

async function activeStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<string> {
  const { data: studentId, error } = await supabase.rpc("current_student_id");
  if (error || !studentId) throw new Error("Student access required.");
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { data: student, error: studentError } = await admin
    .from("students").select("id").eq("id", String(studentId))
    .eq("status", "active").is("deleted_at", null).maybeSingle();
  if (studentError) throw new Error(studentError.message);
  if (!student) throw new Error("Student is not active.");
  return String(studentId);
}

async function publishedLesson(catalogId: string) {
  const { admin } = await assertActiveCatalog(catalogId);
  const { data, error } = await admin
    .from("lesson_revisions")
    .select("id,catalog_id,revision,title,description,sequential,steps,published_at")
    .eq("catalog_id", catalogId).eq("state", "published").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function verifyPublishableActivities(catalogId: string, steps: LessonStep[]): Promise<void> {
  const itemIds = [...new Set(steps.filter((step) => step.kind === "activity")
    .map((step) => step.itemId!))];
  if (!itemIds.length) return;
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { data: items, error } = await admin
    .from("catalog_items").select("id,entity_type,entity_id")
    .eq("catalog_id", catalogId).in("id", itemIds);
  if (error) throw new Error(error.message);
  if ((items ?? []).length !== itemIds.length) {
    throw new Error("The lesson references removed catalog activities.");
  }
  for (const type of ["question", "vocabulary", "reading", "listening"] as const) {
    const table = {
      question: "questions", vocabulary: "vocabulary_entries",
      reading: "readings", listening: "listenings",
    }[type];
    const ids = (items ?? []).filter((item) => item.entity_type === type)
      .map((item) => item.entity_id);
    if (!ids.length) continue;
    // Use the same active/deleted rules as the established catalog practice.
    const { data: valid, error: entityError } = await admin.from(table)
      .select("id").in("id", ids)
      .eq("status", "active").is("deleted_at", null);
    if (entityError) throw new Error(entityError.message);
    if ((valid ?? []).length !== new Set(ids).size) {
      throw new Error("Publish requires every referenced activity to be active.");
    }
  }
}

async function lessonOutcomes(revisionId: string, studentId: string): Promise<LessonStepOutcome[]> {
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { data, error } = await admin
    .from("lesson_step_progress")
    .select("step_id,viewed_at,attempted_at,best_score_percent,teacher_approved")
    .eq("revision_id", revisionId).eq("student_id", studentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.step_id,
    viewed: !!row.viewed_at,
    attempted: !!row.attempted_at,
    bestScorePercent: row.best_score_percent,
    teacherApproved: row.teacher_approved,
  }));
}

export const getTeacherLesson = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((input) => lessonIdentitySchema.parse(input))
  .handler(async ({ data }) => {
    const { admin, catalog } = await assertActiveCatalog(data.catalogId);
    const { data: versions, error } = await admin
      .from("lesson_revisions")
      .select("*").eq("catalog_id", data.catalogId).in("state", ["draft", "published"])
      .order("revision", { ascending: false });
    if (error) throw new Error(error.message);
    return { catalog, draft: versions?.find((row) => row.state === "draft") ?? null,
      published: versions?.find((row) => row.state === "published") ?? null };
  });

export const saveLessonDraft = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((input) => lessonInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { admin } = await assertActiveCatalog(data.catalogId);
    const steps = parseSteps(data.steps);
    const activityIds = steps.filter((step) => step.kind === "activity")
      .map((step) => step.itemId!);
    const ids = [...new Set(activityIds)];
    if (ids.length !== activityIds.length) {
      throw new Error("Each catalog activity may appear only once per lesson revision.");
    }
    if (ids.length) {
      const { data: items, error } = await admin
        .from("catalog_items").select("id")
        .eq("catalog_id", data.catalogId).in("id", ids);
      if (error) throw new Error(error.message);
      if ((items ?? []).length !== ids.length) {
        throw new Error("Every activity must reference an item already in this catalog.");
      }
    }
    const { data: rows, error } = await admin
      .from("lesson_revisions")
      .select("id,revision,state")
      .eq("catalog_id", data.catalogId).order("revision", { ascending: false });
    if (error) throw new Error(error.message);
    const draft = rows?.find((row) => row.state === "draft");
    const payload = {
      title: data.title,
      description: data.description,
      sequential: data.sequential,
      steps: steps as unknown as Json,
    };
    if (draft) {
      const { error: updateError } = await admin
        .from("lesson_revisions").update(payload).eq("id", draft.id).eq("state", "draft");
      if (updateError) throw new Error(updateError.message);
      return { id: draft.id, revision: draft.revision };
    }
    const revision = Math.max(0, ...(rows ?? []).map((row) => row.revision)) + 1;
    const { data: saved, error: insertError } = await admin
      .from("lesson_revisions")
      .insert({ ...payload, catalog_id: data.catalogId, revision, state: "draft" })
      .select("id,revision").single();
    if (insertError || !saved) throw new Error(insertError?.message ?? "Could not save lesson.");
    return saved;
  });

export const publishLessonDraft = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((input) => z.object({ catalogId: uuid, draftId: uuid }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await assertActiveCatalog(data.catalogId);
    const { data: draft, error } = await admin
      .from("lesson_revisions").select("steps")
      .eq("id", data.draftId).eq("catalog_id", data.catalogId)
      .eq("state", "draft").maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) throw new Error("Lesson draft not found.");
    const validatedSteps = parseSteps(draft.steps);
    await verifyPublishableActivities(data.catalogId, validatedSteps);
    // Atomic transition: the previous published revision is archived in the
    // same DB transaction; historical student progress is never rewritten.
    const { data: result, error: publishError } = await admin.rpc(
      "publish_lesson_revision",
      { p_catalog_id: data.catalogId, p_draft_id: data.draftId },
    );
    if (publishError) throw new Error(publishError.message);
    return { publishedId: result };
  });

export const getStudentLesson = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => lessonIdentitySchema.parse(input))
  .handler(async ({ context, data }) => {
    const studentId = await activeStudentId(context.supabase);
    await assertAssignedCatalog(studentId, data.catalogId);
    const lesson = await publishedLesson(data.catalogId);
    if (!lesson) return null;
    const steps = parseSteps(lesson.steps);
    const progress = evaluateLessonProgress(
      steps, await lessonOutcomes(lesson.id, studentId), lesson.sequential,
    );
    return {
      id: lesson.id,
      revision: lesson.revision,
      title: lesson.title,
      description: lesson.description,
      ...progress,
      steps: progress.steps.map((step) => {
        const definition = steps.find((entry) => entry.id === step.id)!;
        return {
          id: step.id, title: definition.title, kind: definition.kind,
          required: step.required, mode: step.mode, state: step.state,
          // Locked activities may not receive item IDs or theory content.
          itemId: step.state === "locked" ? null : definition.itemId ?? null,
          body: step.state === "locked" ? null : definition.body ?? null,
        };
      }),
    };
  });

export const markLessonTheoryViewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ catalogId: uuid, revisionId: uuid, stepId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const studentId = await activeStudentId(context.supabase);
    await assertAssignedCatalog(studentId, data.catalogId);
    const lesson = await publishedLesson(data.catalogId);
    if (!lesson || lesson.id !== data.revisionId) {
      throw new Error("Lesson is not published or is no longer current.");
    }
    const steps = parseSteps(lesson.steps);
    const step = steps.find((item) => item.id === data.stepId);
    if (!step || step.kind !== "theory" || step.mode !== "view") {
      throw new Error("Only theory reading can be acknowledged without grading.");
    }
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: existing, error: rowError } = await admin
      .from("lesson_step_progress")
      .select("viewed_at")
      .eq("revision_id", lesson.id).eq("student_id", studentId)
      .eq("step_id", step.id).maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (existing?.viewed_at) return { ok: true, alreadyCompleted: true };
    const progress = evaluateLessonProgress(
      steps, await lessonOutcomes(lesson.id, studentId), lesson.sequential,
    );
    const view = progress.steps.find((item) => item.id === step.id);
    if (!view || view.state === "locked") throw new Error("This lesson step is locked.");
    const { error } = await admin.from("lesson_step_progress").upsert({
      revision_id: lesson.id,
      student_id: studentId,
      step_id: step.id,
      viewed_at: new Date().toISOString(),
    }, { onConflict: "revision_id,student_id,step_id" });
    if (error) throw new Error(error.message);
    return { ok: true, alreadyCompleted: false };
  });
