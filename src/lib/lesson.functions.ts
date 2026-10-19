/** Teacher publishing and authorized student Lesson Mode endpoints. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTeacher } from "./teacher-middleware";
import { validateLessonStepRules, type LessonStepRule } from "./lesson-sequencing";
import { latestPublishedLesson, computeLessonProgress } from "./lesson-progress.server";
import type { adminClient } from "./security.server";

const uuid = z.string().uuid();
const step = z.object({
  id: uuid, required: z.boolean(), mode: z.enum(["view","attempt","pass"]),
  minScorePercent: z.number().min(0).max(100).optional(),
}).strict();
const draftInput = z.object({
  catalogId: uuid, sequential: z.boolean(),
  steps: z.array(step).min(1).max(100),
}).strict();

type Admin = Awaited<ReturnType<typeof adminClient>>;
function db(client: unknown) {
  // Pending regeneration of generated types following additive migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}
async function studentIdFromSession(supabase: unknown): Promise<string> {
  const { data, error } = await db(supabase).rpc("current_student_id");
  if (error || !data) throw new Error("Student access required.");
  return String(data);
}
async function checkAssignment(admin: Admin, studentId: string, catalogId: string) {
  const { data: membership, error: membershipError } = await admin
    .from("group_memberships").select("group_id").eq("student_id", studentId);
  if (membershipError) throw new Error(membershipError.message);
  const groups = (membership ?? []).map((row) => row.group_id);
  const [direct, viaGroup, catalog] = await Promise.all([
    admin.from("catalog_assignments").select("id").eq("catalog_id", catalogId)
      .eq("student_id", studentId).limit(1),
    groups.length ? admin.from("catalog_assignments").select("id")
      .eq("catalog_id", catalogId).in("group_id", groups).limit(1)
      : Promise.resolve({data: [], error:null}),
    admin.from("catalogs").select("id").eq("id", catalogId)
      .eq("status", "active").is("deleted_at", null).maybeSingle(),
  ]);
  for (const result of [direct,viaGroup,catalog]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!catalog.data || !(direct.data?.length || viaGroup.data?.length)) {
    throw new Error("This catalog is not assigned to you.");
  }
}
export const getTeacherLesson = createServerFn({method:"GET"})
  .middleware([requireTeacher])
  .inputValidator((input) => z.object({catalogId:uuid}).parse(input))
  .handler(async ({data}) => {
    const {adminClient} = await import("./security.server");
    const admin = await adminClient();
    const catalog = await admin.from("catalogs").select("id,name,status")
      .eq("id", data.catalogId).is("deleted_at",null).maybeSingle();
    if (catalog.error || !catalog.data) throw new Error("Catalog not found.");
    const {data:draft,error} = await db(admin).from("lesson_drafts")
      .select("catalog_id,sequential,steps,updated_at")
      .eq("catalog_id",data.catalogId).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      catalog: catalog.data,
      draft: (draft??null) as {catalog_id:string;sequential:boolean;
        steps:LessonStepRule[];updated_at:string}|null,
      latest: await latestPublishedLesson(admin,data.catalogId),
    };
  });
export const saveLessonDraft = createServerFn({method:"POST"})
  .middleware([requireTeacher])
  .inputValidator((input)=>draftInput.parse(input))
  .handler(async ({data,context}) => {
    validateLessonStepRules(data.steps);
    if (!data.steps.some(step => step.required)) {
      throw new Error("A lesson must have at least one required step.");
    }
    const {adminClient,audit} = await import("./security.server");
    const admin=await adminClient();
    const catalog=await admin.from("catalogs").select("id")
      .eq("id",data.catalogId).is("deleted_at",null).maybeSingle();
    if (catalog.error || !catalog.data) throw new Error("Catalog not found.");
    const ids=data.steps.map(x=>x.id);
    const {data:items,error}=await admin.from("catalog_items")
      .select("id,entity_type").eq("catalog_id",data.catalogId).in("id",ids);
    if(error) throw new Error(error.message);
    if((items??[]).length!==ids.length) throw new Error("Invalid lesson item.");
    const kinds=new Map((items??[]).map(x=>[x.id,x.entity_type]));
    for(const x of data.steps){
      if(x.mode!=="view" && !["question","vocabulary"].includes(kinds.get(x.id)??"")) {
        throw new Error("Only questions and vocabulary support attempt or pass.");
      }
    }
    const saved=await db(admin).from("lesson_drafts").upsert({
      catalog_id:data.catalogId,sequential:data.sequential,steps:data.steps,
      updated_at:new Date().toISOString(),
    },{onConflict:"catalog_id"});
    if(saved.error) throw new Error(saved.error.message);
    await audit(admin,{actor_type:"teacher",actor_id:context.userId,
      action:"lesson_draft_saved",entity_type:"catalog",entity_id:data.catalogId,
      summary:"Saved lesson draft"});
    return {saved:true};
  });
export const publishLessonDraft = createServerFn({method:"POST"})
  .middleware([requireTeacher])
  .inputValidator((input)=>z.object({catalogId:uuid}).parse(input))
  .handler(async ({data,context}) => {
    const {adminClient,audit}=await import("./security.server");
    const admin=await adminClient();
    const {data:revision,error}=await db(admin).rpc(
      "publish_catalog_lesson",{_catalog_id:data.catalogId});
    if(error) throw new Error(error.message);
    await audit(admin,{actor_type:"teacher",actor_id:context.userId,
      action:"lesson_published",entity_type:"catalog",entity_id:data.catalogId,
      summary:"Published lesson revision "+String(revision)});
    return {revision:Number(revision)};
  });
export const getStudentLesson = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({catalogId:uuid}).parse(input))
  .handler(async ({data,context}) => {
    const studentId=await studentIdFromSession(context.supabase);
    const {adminClient}=await import("./security.server");
    const admin=await adminClient();
    await checkAssignment(admin,studentId,data.catalogId);
    const lesson=await latestPublishedLesson(admin,data.catalogId);
    return lesson
      ? {lesson,progress:await computeLessonProgress(admin,studentId,lesson)}
      : {lesson:null,progress:null};
  });
export const markLessonStepViewed = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({catalogId:uuid,stepId:uuid}).parse(input))
  .handler(async ({data,context}) => {
    const studentId=await studentIdFromSession(context.supabase);
    const {adminClient}=await import("./security.server");
    const admin=await adminClient();
    await checkAssignment(admin,studentId,data.catalogId);
    const lesson=await latestPublishedLesson(admin,data.catalogId);
    if(!lesson) throw new Error("Lesson not published.");
    const step=lesson.steps.find(x=>x.id===data.stepId);
    if(!step || step.mode!=="view") throw new Error("Not a view step.");
    const progress=await computeLessonProgress(admin,studentId,lesson);
    if(progress.steps.find(x=>x.id===data.stepId)?.state==="locked"){
      throw new Error("Complete previous steps first.");
    }
    const result=await db(admin).from("student_lesson_views").upsert({
      student_id:studentId,catalog_id:data.catalogId,
      revision:lesson.revision,step_id:data.stepId,
    },{onConflict:"student_id,catalog_id,revision,step_id",
      ignoreDuplicates:true});
    if(result.error) throw new Error(result.error.message);
    return {progress:await computeLessonProgress(admin,studentId,lesson)};
  });
