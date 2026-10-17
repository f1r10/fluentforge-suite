/** Server-authorized Lesson Mode built on catalog items and canonical practice grading. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTeacher } from "./teacher-middleware";
import { validateLessonStepRules, type LessonStepRule } from "./lesson-sequencing";
import { latestPublishedLesson, lessonProgress } from "./lesson-progress.server";

const uuid = z.string().uuid();
const stepSchema = z.object({
  id: uuid, required: z.boolean(),
  mode: z.enum(["view", "attempt", "pass"]),
  minScorePercent: z.number().min(0).max(100).optional(),
}).strict();
const draftSchema = z.object({
  catalogId: uuid, sequential: z.boolean().default(true),
  enforceLocks: z.boolean().default(false),
  steps: z.array(stepSchema).min(1).max(100),
}).strict();

function lessonDb(client: unknown) {
  // Generated DB types predate the additive lesson migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

async function requireAssignedCatalog(admin: Admin, studentId: string, catalogId: string) {
  const memberships = await admin.from("group_memberships")
    .select("group_id").eq("student_id", studentId);
  if (memberships.error) throw new Error(memberships.error.message);
  const groups = (memberships.data ?? []).map((row) => row.group_id);
  const [direct, indirect, catalog] = await Promise.all([
    admin.from("catalog_assignments").select("id").eq("student_id", studentId)
      .eq("catalog_id", catalogId).limit(1),
    groups.length ? admin.from("catalog_assignments").select("id")
      .eq("catalog_id", catalogId).in("group_id", groups).limit(1)
      : Promise.resolve({ data: [], error: null }),
    admin.from("catalogs").select("id").eq("id", catalogId)
      .eq("status", "active").is("deleted_at", null).maybeSingle(),
  ]);
  for (const result of [direct, indirect, catalog]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!catalog.data || !(direct.data?.length || indirect.data?.length)) {
    throw new Error("This lesson is not assigned to you.");
  }
}

async function currentStudentId(supabase: unknown): Promise<string> {
  const { data, error } = await lessonDb(supabase).rpc("current_student_id");
  if (error || !data) throw new Error("Student access required.");
  return String(data);
}

export const getTeacherLesson = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((input) => z.object({ catalogId: uuid }).parse(input))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const catalog = await admin.from("catalogs").select("id,status,name")
      .eq("id", data.catalogId).is("deleted_at", null).maybeSingle();
    if (catalog.error || !catalog.data) throw new Error("Catalog not found.");
    const { data: draft, error } = await lessonDb(admin).from("lesson_drafts")
      .select("catalog_id,sequential,enforce_locks,steps,updated_at")
      .eq("catalog_id", data.catalogId).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      catalog: catalog.data,
      draft: draft as { catalog_id: string; sequential: boolean; enforce_locks: boolean;
        steps: LessonStepRule[]; updated_at: string } | null,
      latest: await latestPublishedLesson(admin, data.catalogId),
    };
  });

export const saveLessonDraft = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((input) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    validateLessonStepRules(data.steps);
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const catalog = await admin.from("catalogs").select("id")
      .eq("id", data.catalogId).is("deleted_at", null).maybeSingle();
    if (catalog.error || !catalog.data) throw new Error("Catalog not found.");
    const ids = data.steps.map((step) => step.id);
    const { data: items, error } = await admin.from("catalog_items")
      .select("id,entity_type").eq("catalog_id", data.catalogId).in("id", ids);
    if (error) throw new Error(error.message);
    if ((items ?? []).length !== ids.length) {
      throw new Error("A lesson step is no longer part of this catalog.");
    }
    const types = new Map((items ?? []).map((item) => [item.id, item.entity_type]));
    for (const step of data.steps) {
      if (step.mode !== "view" &&
          !["question", "vocabulary"].includes(types.get(step.id) ?? "")) {
        throw new Error("Only question and vocabulary steps support verified attempt/pass.");
      }
    }
    const result = await lessonDb(admin).from("lesson_drafts").upsert({
      catalog_id: data.catalogId, sequential: data.sequential,
      enforce_locks: data.enforceLocks,
      steps: data.steps, updated_at: new Date().toISOString(),
    }, { onConflict: "catalog_id" });
    if (result.error) throw new Error(result.error.message);
    await audit(admin, {
      actor_type: "teacher", actor_id: context.userId,
      action: "lesson_draft_saved", entity_type: "catalog",
      entity_id: data.catalogId, summary: "Saved lesson draft",
    });
    return { saved: true };
  });

export const publishLessonDraft = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((input) => z.object({ catalogId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const result = await lessonDb(admin).rpc(
      "publish_catalog_lesson", { _catalog_id: data.catalogId },
    );
    if (result.error) throw new Error(result.error.message);
    await audit(admin, {
      actor_type: "teacher", actor_id: context.userId,
      action: "lesson_published", entity_type: "catalog",
      entity_id: data.catalogId, summary: "Published lesson revision " + result.data,
    });
    return { revision: Number(result.data) };
  });

export const getStudentLesson = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ catalogId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    await requireAssignedCatalog(admin, studentId, data.catalogId);
    const lesson = await latestPublishedLesson(admin, data.catalogId);
    if (!lesson) return { lesson: null, progress: null };
    return { lesson, progress: await lessonProgress(admin, studentId, lesson) };
  });

export const markLessonStepViewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ catalogId: uuid, stepId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    await requireAssignedCatalog(admin, studentId, data.catalogId);
    const lesson = await latestPublishedLesson(admin, data.catalogId);
    if (!lesson) throw new Error("No published lesson is available.");
    const step = lesson.steps.find((item) => item.id === data.stepId);
    if (!step || step.mode !== "view") {
      throw new Error("Only view steps can be marked as viewed.");
    }
    const progress = await lessonProgress(admin, studentId, lesson);
    if (progress.steps.find((item) => item.id === data.stepId)?.state === "locked") {
      throw new Error("Complete the previous required lesson step first.");
    }
    const result = await lessonDb(admin).from("student_lesson_views").upsert({
      student_id: studentId, catalog_id: data.catalogId,
      revision: lesson.revision, step_id: data.stepId,
    }, {
      onConflict: "student_id,catalog_id,revision,step_id",
      ignoreDuplicates: true,
    });
    if (result.error) throw new Error(result.error.message);
    return { progress: await lessonProgress(admin, studentId, lesson) };
  });
