import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

export const EXAM_ITEM_TYPES = ["question", "reading", "listening", "catalog"] as const;
export type ExamItemType = (typeof EXAM_ITEM_TYPES)[number];

const resultReleaseSchema = z.enum(["immediate", "after_close", "after_approval"]);
const visibilitySchema = z.enum(["never", "after_submit", "after_close", "after_approval"]);

export const examSettingsSchema = z.object({
  max_attempts: z.number().int().min(1).max(100).default(1),
  pass_score_percent: z.number().min(0).max(100).nullable().default(null),
  resume_after_disconnect: z.boolean().default(true),
  shuffle_questions: z.boolean().default(false),
  shuffle_options: z.boolean().default(false),
  section_order: z.enum(["fixed", "shuffle"]).default("fixed"),
  allow_back_navigation: z.boolean().default(true),
  copy_paste_restricted: z.boolean().default(false),
  monitor_tab_switches: z.boolean().default(true),
  max_tab_switches: z.number().int().min(0).max(1_000).nullable().default(null),
  full_duration_after_start: z.boolean().default(true),
  auto_submit: z.literal(true).default(true),
  result_release: resultReleaseSchema.default("after_approval"),
  answer_visibility: visibilitySchema.default("after_approval"),
  explanation_visibility: visibilitySchema.default("after_approval"),
});

export type ExamSettings = z.infer<typeof examSettingsSchema>;

const poolFilterSchema = z.object({
  language: z.string().max(10).nullable().default(null),
  level: z.string().max(20).nullable().default(null),
  types: z.array(z.string().max(60)).max(50).default([]),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  catalogId: z.string().uuid().nullable().default(null),
});

const poolSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  count: z.number().int().min(1).max(200),
  filters: poolFilterSchema,
});

export const poolRulesSchema = z.object({
  enabled: z.boolean().default(false),
  pools: z.array(poolSchema).max(30).default([]),
});

export type PoolRules = z.infer<typeof poolRulesSchema>;

const examInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(5_000).nullable().default(null),
    available_from: z.string().datetime().nullable().default(null),
    available_until: z.string().datetime().nullable().default(null),
    duration_minutes: z.number().int().min(1).max(1_440).nullable().default(null),
    settings: examSettingsSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.available_from &&
      value.available_until &&
      new Date(value.available_until).getTime() <= new Date(value.available_from).getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["available_until"],
        message: "End time must be after start time.",
      });
    }
  });

export type ExamInput = z.infer<typeof examInputSchema>;

const sectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  examId: z.string().uuid(),
  title: z.string().max(300).nullable().default(null),
  instructions: z.string().max(5_000).nullable().default(null),
  pool_rules: poolRulesSchema.default({ enabled: false, pools: [] }),
});

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

function normalizeSettings(value: unknown): ExamSettings {
  const parsed = examSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : examSettingsSchema.parse({});
}

function normalizePoolRules(value: unknown): PoolRules {
  const parsed = poolRulesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : poolRulesSchema.parse({});
}

async function getExamRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  examId: string,
) {
  const { data, error } = await sb
    .from("exams")
    .select(
      "id,title,description,status,available_from,available_until,duration_minutes,settings,published_snapshot,published_at,created_at,updated_at",
    )
    .eq("id", examId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Exam not found.");
  return data;
}

async function assignedStudentIdsForExam(
  admin: Admin,
  examId: string,
) {
  const { data: assignments, error } = await admin
    .from("exam_assignments")
    .select("student_id,group_id")
    .eq("exam_id", examId);
  if (error) throw new Error(error.message);

  const direct = (assignments ?? [])
    .map((row) => row.student_id)
    .filter((value): value is string => !!value);
  const groupIds = [
    ...new Set(
      (assignments ?? [])
        .map((row) => row.group_id)
        .filter((value): value is string => !!value),
    ),
  ];

  let grouped: string[] = [];
  if (groupIds.length) {
    const { data: memberships, error: membershipError } = await admin
      .from("group_memberships")
      .select("student_id")
      .in("group_id", groupIds);
    if (membershipError) throw new Error(membershipError.message);
    grouped = (memberships ?? []).map((row) => row.student_id);
  }

  return [...new Set([...direct, ...grouped])];
}

async function notifyExamAvailability(
  admin: Admin,
  exam: {
    id: string;
    title: string;
    published_at?: string | null;
    status?: string;
    available_from?: string | null;
  },
  studentIds?: string[],
) {
  if (!exam.published_at) return;
  const ids = studentIds ?? (await assignedStudentIdsForExam(admin, exam.id));
  if (!ids.length) return;

  const { notifyStudents } = await import("./notifications.functions");
  await notifyStudents(admin, ids, {
    kind: "exam_assigned",
    title: "New exam assigned",
    body: exam.available_from
      ? `${exam.title} is assigned to you. It opens at ${new Date(
          exam.available_from,
        ).toLocaleString()}.`
      : `${exam.title} is assigned to you.`,
    link: "/student/exams",
    data: { exam_id: exam.id },
    dedupeKey: `exam-assigned:${exam.id}`,
  });
}

async function ensureDraftExam(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  examId: string,
) {
  const exam = await getExamRow(sb, examId);
  if (exam.status !== "draft") {
    throw new Error("Published exam content is immutable. Only draft exams can be edited.");
  }
  return exam;
}

export const listExamsDetailed = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("exams")
      .select(
        "id,title,description,status,available_from,available_until,duration_minutes,settings,published_at,updated_at,exam_sections(count),exam_items(count),exam_assignments(count)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      available_from: row.available_from,
      available_until: row.available_until,
      duration_minutes: row.duration_minutes,
      settings: normalizeSettings(row.settings),
      published_at: row.published_at,
      updated_at: row.updated_at,
      sections: (row.exam_sections as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      items: (row.exam_items as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      assignments: (row.exam_assignments as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    }));
  });

export const saveExam = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => examInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const core = {
      title: data.title,
      description: data.description || null,
      available_from: data.available_from,
      available_until: data.available_until,
      duration_minutes: data.duration_minutes,
      settings: data.settings,
    };

    // requireTeacher has already authenticated and authorized the caller.
    // Use the trusted server client for this multi-step write so exam creation
    // is not dependent on user-scoped PostgREST/RLS role propagation.
    if (data.id) {
      await ensureDraftExam(admin, data.id);
      const { error } = await admin
        .from("exams")
        .update(core as never)
        .eq("id", data.id)
        .eq("status", "draft");
      if (error) throw new Error(error.message);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "exam_updated",
        entity_type: "exam",
        entity_id: data.id,
        summary: `Updated exam "${data.title}"`,
      });
      return { id: data.id };
    }

    const { data: created, error } = await admin
      .from("exams")
      .insert({ ...core, status: "draft" } as never)
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(error?.message ?? "Could not create exam.");
    }

    const { error: sectionError } = await admin
      .from("exam_sections")
      .insert({
        exam_id: created.id,
        title: "Section 1",
        sort_order: 0,
        pool_rules: { enabled: false, pools: [] },
      } as never);
    if (sectionError) {
      await admin.from("exams").delete().eq("id", created.id);
      throw new Error(sectionError.message);
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "exam_created",
      entity_type: "exam",
      entity_id: created.id,
      summary: `Created exam "${data.title}"`,
    });

    return { id: created.id };
  });

export const getExam = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const exam = await getExamRow(context.supabase, data.id);

    const [sectionsResult, itemsResult, assignmentsResult] = await Promise.all([
      context.supabase
        .from("exam_sections")
        .select("id,title,instructions,sort_order,pool_rules")
        .eq("exam_id", data.id)
        .order("sort_order")
        .order("id"),
      context.supabase
        .from("exam_items")
        .select("id,section_id,entity_type,entity_id,question_version,points,sort_order")
        .eq("exam_id", data.id)
        .order("sort_order")
        .order("id"),
      context.supabase
        .from("exam_assignments")
        .select("id,group_id,student_id,groups(id,name),students(id,first_name,last_name,username,status)")
        .eq("exam_id", data.id)
        .order("created_at"),
    ]);

    for (const result of [sectionsResult, itemsResult, assignmentsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const rawItems = itemsResult.data ?? [];
    const questionIds = rawItems.filter((x) => x.entity_type === "question" && x.entity_id).map((x) => x.entity_id!);
    const readingIds = rawItems.filter((x) => x.entity_type === "reading" && x.entity_id).map((x) => x.entity_id!);
    const listeningIds = rawItems.filter((x) => x.entity_type === "listening" && x.entity_id).map((x) => x.entity_id!);
    const catalogIds = rawItems.filter((x) => x.entity_type === "catalog" && x.entity_id).map((x) => x.entity_id!);

    const [questions, readings, listenings, catalogs] = await Promise.all([
      questionIds.length
        ? context.supabase
            .from("questions")
            .select("id,prompt,question_type,learning_language,level,status,deleted_at,current_version")
            .in("id", questionIds)
        : Promise.resolve({ data: [], error: null }),
      readingIds.length
        ? context.supabase
            .from("readings")
            .select("id,title,learning_language,level,status,deleted_at")
            .in("id", readingIds)
        : Promise.resolve({ data: [], error: null }),
      listeningIds.length
        ? context.supabase
            .from("listenings")
            .select("id,title,learning_language,level,status,deleted_at")
            .in("id", listeningIds)
        : Promise.resolve({ data: [], error: null }),
      catalogIds.length
        ? context.supabase
            .from("catalogs")
            .select("id,name,status,deleted_at")
            .in("id", catalogIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [questions, readings, listenings, catalogs]) {
      if (result.error) throw new Error(result.error.message);
    }

    const maps = {
      question: new Map((questions.data ?? []).map((x) => [x.id, x])),
      reading: new Map((readings.data ?? []).map((x) => [x.id, x])),
      listening: new Map((listenings.data ?? []).map((x) => [x.id, x])),
      catalog: new Map((catalogs.data ?? []).map((x) => [x.id, x])),
    };

    const resolvedItems = rawItems.map((item) => {
      const type = item.entity_type as ExamItemType;
      const entity = item.entity_id ? maps[type]?.get(item.entity_id) : null;
      const title =
        type === "question"
          ? (entity as { prompt?: string } | null)?.prompt ?? "Unavailable question"
          : type === "catalog"
            ? (entity as { name?: string } | null)?.name ?? "Unavailable catalog"
            : (entity as { title?: string } | null)?.title ?? `Unavailable ${type}`;

      return {
        ...item,
        entity_type: type,
        title,
        subtitle:
          type === "question"
            ? (entity as { question_type?: string } | null)?.question_type ?? null
            : null,
        language:
          type === "question" || type === "reading" || type === "listening"
            ? (entity as { learning_language?: string | null } | null)?.learning_language ?? null
            : null,
        level:
          type === "question" || type === "reading" || type === "listening"
            ? (entity as { level?: string | null } | null)?.level ?? null
            : null,
        status: (entity as { status?: string } | null)?.status ?? "missing",
        available: !!entity && !(entity as { deleted_at?: string | null }).deleted_at,
      };
    });

    const typedAssignments = (assignmentsResult.data ?? []) as unknown as Array<{
      id: string;
      group_id: string | null;
      student_id: string | null;
      groups: { id: string; name: string } | null;
      students: {
        id: string;
        first_name: string;
        last_name: string;
        username: string;
        status: string;
      } | null;
    }>;

    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      status: exam.status,
      available_from: exam.available_from,
      available_until: exam.available_until,
      duration_minutes: exam.duration_minutes,
      settings: normalizeSettings(exam.settings),
      published_at: exam.published_at,
      published_snapshot: exam.published_snapshot,
      sections: (sectionsResult.data ?? []).map((section) => ({
        ...section,
        pool_rules: normalizePoolRules(section.pool_rules),
        items: resolvedItems.filter((item) => item.section_id === section.id),
      })),
      unsectionedItems: resolvedItems.filter((item) => item.section_id === null),
      assignments: typedAssignments.map((assignment) => ({
        id: assignment.id,
        type: assignment.group_id ? ("group" as const) : ("student" as const),
        targetId: assignment.group_id ?? assignment.student_id!,
        label: assignment.groups
          ? assignment.groups.name
          : assignment.students
            ? `${assignment.students.first_name} ${assignment.students.last_name}`
            : "Unavailable target",
        secondary: assignment.students?.username ?? null,
        status: assignment.students?.status ?? null,
      })),
    };
  });

export const saveExamSection = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => sectionInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);

    const core = {
      title: data.title || null,
      instructions: data.instructions || null,
      pool_rules: data.pool_rules,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("exam_sections")
        .update(core as never)
        .eq("id", data.id)
        .eq("exam_id", data.examId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: last } = await context.supabase
      .from("exam_sections")
      .select("sort_order")
      .eq("exam_id", data.examId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("exam_sections")
      .insert({
        exam_id: data.examId,
        ...core,
        sort_order: (last?.sort_order ?? -1) + 1,
      } as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create section.");
    return { id: row.id };
  });

export const deleteExamSection = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ examId: z.string().uuid(), sectionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);
    const { count } = await context.supabase
      .from("exam_sections")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", data.examId);
    if ((count ?? 0) <= 1) throw new Error("An exam must keep at least one section.");

    const { error } = await context.supabase
      .from("exam_sections")
      .delete()
      .eq("id", data.sectionId)
      .eq("exam_id", data.examId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderExamSections = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ examId: z.string().uuid(), sectionIds: z.array(z.string().uuid()).min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);
    const { error } = await context.supabase.rpc("reorder_exam_sections", {
      p_exam_id: data.examId,
      p_section_ids: data.sectionIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function validateExamEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  type: ExamItemType,
  id: string,
) {
  if (type === "question") {
    const { data, error } = await sb
      .from("questions")
      .select("id,context_kind,current_version,status")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.status === "archived") throw new Error("Question not found.");
    if (data.context_kind !== "none") {
      throw new Error("Context-bound questions must be added through their reading or listening.");
    }
    return { version: data.current_version as number };
  }

  const table = type === "reading" ? "readings" : type === "listening" ? "listenings" : "catalogs";
  const { data, error } = await sb
    .from(table)
    .select("id,status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status === "archived") throw new Error(`${type} not found.`);
  return { version: null };
}

export const addExamItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        sectionId: z.string().uuid(),
        items: z
          .array(
            z.object({
              entity_type: z.enum(EXAM_ITEM_TYPES),
              entity_id: z.string().uuid(),
              points: z.number().min(0).max(10_000).nullable().default(null),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);

    const { data: section, error: sectionError } = await context.supabase
      .from("exam_sections")
      .select("id")
      .eq("id", data.sectionId)
      .eq("exam_id", data.examId)
      .maybeSingle();
    if (sectionError) throw new Error(sectionError.message);
    if (!section) throw new Error("Section not found.");

    const unique = Array.from(
      new Map(data.items.map((item) => [`${item.entity_type}:${item.entity_id}`, item])).values(),
    );

    const { data: existingRows, error: existingError } = await context.supabase
      .from("exam_items")
      .select("entity_type,entity_id")
      .eq("exam_id", data.examId)
      .eq("section_id", data.sectionId);
    if (existingError) throw new Error(existingError.message);
    const existing = new Set(
      (existingRows ?? [])
        .filter((row) => !!row.entity_id)
        .map((row) => `${row.entity_type}:${row.entity_id}`),
    );
    const pending = unique.filter((item) => !existing.has(`${item.entity_type}:${item.entity_id}`));
    if (!pending.length) return { ok: true };

    const validated = [];
    for (const item of pending) {
      const result = await validateExamEntity(context.supabase, item.entity_type, item.entity_id);
      validated.push({ ...item, question_version: result.version });
    }

    const { data: last } = await context.supabase
      .from("exam_items")
      .select("sort_order")
      .eq("exam_id", data.examId)
      .eq("section_id", data.sectionId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const start = (last?.sort_order ?? -1) + 1;
    const { error } = await context.supabase.from("exam_items").insert(
      validated.map((item, index) => ({
        exam_id: data.examId,
        section_id: data.sectionId,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        question_version: item.question_version,
        points: item.points,
        sort_order: start + index,
      })),
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeExamItem = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ examId: z.string().uuid(), sectionId: z.string().uuid(), itemId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);
    const { error } = await context.supabase
      .from("exam_items")
      .delete()
      .eq("id", data.itemId)
      .eq("exam_id", data.examId)
      .eq("section_id", data.sectionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderExamItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        sectionId: z.string().uuid(),
        itemIds: z.array(z.string().uuid()).max(2_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);
    const { error } = await context.supabase.rpc("reorder_exam_items", {
      p_exam_id: data.examId,
      p_section_id: data.sectionId,
      p_item_ids: data.itemIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchExamContent = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        sectionId: z.string().uuid().nullable().default(null),
        search: z.string().max(200).default(""),
        type: z.enum(["all", ...EXAM_ITEM_TYPES]).default("all"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const safe = data.search.trim().replace(/[,()%]/g, " ");
    const { data: existingRows, error: existingError } = await context.supabase
      .from("exam_items")
      .select("section_id,entity_type,entity_id")
      .eq("exam_id", data.examId);
    if (existingError) throw new Error(existingError.message);
    const inExam = new Set(
      (existingRows ?? [])
        .filter((row) => !!row.entity_id)
        .map((row) => `${row.entity_type}:${row.entity_id}`),
    );
    const inSection = new Set(
      (existingRows ?? [])
        .filter((row) => row.section_id === data.sectionId && !!row.entity_id)
        .map((row) => `${row.entity_type}:${row.entity_id}`),
    );

    const results: Array<{
      entity_type: ExamItemType;
      entity_id: string;
      title: string;
      subtitle: string | null;
      language: string | null;
      level: string | null;
      inExam: boolean;
      inSection: boolean;
    }> = [];

    if (data.type === "all" || data.type === "question") {
      let query = context.supabase
        .from("questions")
        .select("id,prompt,question_type,learning_language,level,context_kind")
        .eq("status", "active")
        .is("deleted_at", null)
        .eq("context_kind", "none")
        .order("updated_at", { ascending: false })
        .limit(data.type === "all" ? 12 : 50);
      if (safe) query = query.ilike("prompt", `%${safe}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        results.push({
          entity_type: "question",
          entity_id: row.id,
          title: row.prompt,
          subtitle: row.question_type,
          language: row.learning_language,
          level: row.level,
          inExam: inExam.has(`question:${row.id}`),
          inSection: inSection.has(`question:${row.id}`),
        });
      }
    }

    if (data.type === "all" || data.type === "reading") {
      let query = context.supabase
        .from("readings")
        .select("id,title,learning_language,level")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(data.type === "all" ? 12 : 50);
      if (safe) query = query.ilike("title", `%${safe}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        results.push({
          entity_type: "reading",
          entity_id: row.id,
          title: row.title,
          subtitle: null,
          language: row.learning_language,
          level: row.level,
          inExam: inExam.has(`reading:${row.id}`),
          inSection: inSection.has(`reading:${row.id}`),
        });
      }
    }

    if (data.type === "all" || data.type === "listening") {
      let query = context.supabase
        .from("listenings")
        .select("id,title,learning_language,level")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(data.type === "all" ? 12 : 50);
      if (safe) query = query.ilike("title", `%${safe}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        results.push({
          entity_type: "listening",
          entity_id: row.id,
          title: row.title,
          subtitle: null,
          language: row.learning_language,
          level: row.level,
          inExam: inExam.has(`listening:${row.id}`),
          inSection: inSection.has(`listening:${row.id}`),
        });
      }
    }

    if (data.type === "all" || data.type === "catalog") {
      let query = context.supabase
        .from("catalogs")
        .select("id,name")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name")
        .limit(data.type === "all" ? 12 : 50);
      if (safe) query = query.ilike("name", `%${safe}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        results.push({
          entity_type: "catalog",
          entity_id: row.id,
          title: row.name,
          subtitle: null,
          language: null,
          level: null,
          inExam: inExam.has(`catalog:${row.id}`),
          inSection: inSection.has(`catalog:${row.id}`),
        });
      }
    }

    return results;
  });

export const previewExamPool = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => poolFilterSchema.parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("questions")
      .select("id,prompt,question_type,learning_language,level", { count: "exact" })
      .eq("status", "active")
      .eq("context_kind", "none")
      .is("deleted_at", null)
      .limit(10);

    if (data.language) query = query.eq("learning_language", data.language);
    if (data.level) query = query.eq("level", data.level);
    if (data.types.length) query = query.in("question_type", data.types);
    if (data.topicIds.length) {
      const { data: topicRows, error } = await context.supabase
        .from("question_topics")
        .select("question_id")
        .in("topic_id", data.topicIds);
      if (error) throw new Error(error.message);
      const ids = [...new Set((topicRows ?? []).map((row) => row.question_id))];
      if (!ids.length) return { count: 0, sample: [] };
      query = query.in("id", ids);
    }
    if (data.catalogId) {
      const { data: catalogRows, error } = await context.supabase
        .from("catalog_items")
        .select("entity_id")
        .eq("catalog_id", data.catalogId)
        .eq("entity_type", "question");
      if (error) throw new Error(error.message);
      const ids = [...new Set((catalogRows ?? []).map((row) => row.entity_id))];
      if (!ids.length) return { count: 0, sample: [] };
      query = query.in("id", ids);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return { count: count ?? 0, sample: rows ?? [] };
  });

export const searchExamAssignmentTargets = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        kind: z.enum(["group", "student"]),
        search: z.string().max(120).default(""),
        page: z.number().int().min(0).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 40;
    const { data: existing, error: existingError } = await context.supabase
      .from("exam_assignments")
      .select("group_id,student_id")
      .eq("exam_id", data.examId);
    if (existingError) throw new Error(existingError.message);
    const assigned = new Set(
      (existing ?? [])
        .map((row) => (data.kind === "group" ? row.group_id : row.student_id))
        .filter((value): value is string => !!value),
    );

    if (data.kind === "group") {
      let query = context.supabase
        .from("groups")
        .select("id,name,description", { count: "exact" })
        .is("deleted_at", null)
        .order("name")
        .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
      if (data.search.trim()) {
        const safe = data.search.trim().replace(/[,()%]/g, " ");
        query = query.ilike("name", `%${safe}%`);
      }
      const { data: rows, count, error } = await query;
      if (error) throw new Error(error.message);
      return {
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          label: row.name,
          secondary: row.description,
          assigned: assigned.has(row.id),
        })),
        total: count ?? 0,
        pageSize,
      };
    }

    let query = context.supabase
      .from("students")
      .select("id,first_name,last_name,username,status", { count: "exact" })
      .is("deleted_at", null)
      .neq("status", "archived")
      .order("last_name")
      .order("first_name")
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,username.ilike.%${safe}%`);
    }
    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((row) => ({
        id: row.id,
        label: `${row.first_name} ${row.last_name}`,
        secondary: row.username,
        status: row.status,
        assigned: assigned.has(row.id),
      })),
      total: count ?? 0,
      pageSize,
    };
  });

export const addExamAssignment = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        kind: z.enum(["group", "student"]),
        targetId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const exam = await getExamRow(context.supabase, data.examId);

    if (data.kind === "group") {
      const { data: target, error } = await context.supabase
        .from("groups")
        .select("id")
        .eq("id", data.targetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!target) throw new Error("Group not found.");

      const { error: insertError } = await context.supabase.from("exam_assignments").upsert(
        { exam_id: data.examId, group_id: data.targetId, student_id: null },
        { onConflict: "exam_id,group_id", ignoreDuplicates: true },
      );
      if (insertError) throw new Error(insertError.message);
    } else {
      const { data: target, error } = await context.supabase
        .from("students")
        .select("id,status")
        .eq("id", data.targetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!target || target.status === "archived") throw new Error("Student not found.");

      const { error: insertError } = await context.supabase.from("exam_assignments").upsert(
        { exam_id: data.examId, group_id: null, student_id: data.targetId },
        { onConflict: "exam_id,student_id", ignoreDuplicates: true },
      );
      if (insertError) throw new Error(insertError.message);
    }

    if (exam.published_at) {
      const { adminClient } = await import("./security.server");
      const admin = await adminClient();
      let studentIds: string[] = [];
      if (data.kind === "student") {
        studentIds = [data.targetId];
      } else {
        const { data: memberships, error: membershipError } = await admin
          .from("group_memberships")
          .select("student_id")
          .eq("group_id", data.targetId);
        if (membershipError) throw new Error(membershipError.message);
        studentIds = (memberships ?? []).map((row) => row.student_id);
      }
      await notifyExamAvailability(admin, exam, studentIds);
    }

    return { ok: true };
  });

export const removeExamAssignment = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ examId: z.string().uuid(), assignmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("exam_assignments")
      .delete()
      .eq("id", data.assignmentId)
      .eq("exam_id", data.examId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function snapshotQuestion(admin: Admin, questionId: string) {
  const { data: question, error } = await admin
    .from("questions")
    .select(
      "id,current_version,question_type,prompt,instructions,payload,answer_key,scoring,normalization,explanation,grading_mode,learning_language,level,difficulty,media_id",
    )
    .eq("id", questionId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!question) throw new Error("A question included in this exam is no longer available.");

  const { data: version, error: versionError } = await admin
    .from("question_versions")
    .select("version,snapshot")
    .eq("question_id", question.id)
    .eq("version", question.current_version)
    .maybeSingle();
  if (versionError) throw new Error(versionError.message);

  return {
    kind: "question",
    question_id: question.id,
    version: question.current_version,
    snapshot: version?.snapshot ?? {
      question_type: question.question_type,
      prompt: question.prompt,
      instructions: question.instructions,
      payload: question.payload,
      answer_key: question.answer_key,
      scoring: question.scoring,
      normalization: question.normalization,
      explanation: question.explanation,
      grading_mode: question.grading_mode,
    },
    metadata: {
      learning_language: question.learning_language,
      level: question.level,
      difficulty: question.difficulty,
      media_id: question.media_id,
    },
  };
}

async function snapshotReading(admin: Admin, readingId: string) {
  const { data: reading, error } = await admin
    .from("readings")
    .select("id,title,body,learning_language,level,word_count,display_layout,metadata")
    .eq("id", readingId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!reading) throw new Error("A reading included in this exam is no longer available.");

  const { data: sets, error: setError } = await admin
    .from("reading_question_sets")
    .select("id,title,instructions,sort_order")
    .eq("reading_id", readingId)
    .order("sort_order");
  if (setError) throw new Error(setError.message);

  const setSnapshots = [];
  for (const set of sets ?? []) {
    const { data: questions, error: questionError } = await admin
      .from("questions")
      .select("id,context_sort")
      .eq("reading_question_set_id", set.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("context_sort");
    if (questionError) throw new Error(questionError.message);

    const questionSnapshots = [];
    for (const question of questions ?? []) {
      questionSnapshots.push(await snapshotQuestion(admin, question.id));
    }

    setSnapshots.push({
      id: set.id,
      title: set.title,
      instructions: set.instructions,
      questions: questionSnapshots,
    });
  }

  return {
    kind: "reading",
    reading: {
      id: reading.id,
      title: reading.title,
      body: reading.body,
      learning_language: reading.learning_language,
      level: reading.level,
      word_count: reading.word_count,
      display_layout: reading.display_layout,
      metadata: reading.metadata,
    },
    question_sets: setSnapshots,
  };
}

async function snapshotListening(admin: Admin, listeningId: string) {
  const { data: listening, error } = await admin
    .from("listenings")
    .select(
      "id,title,media_id,transcript,transcript_segments,transcript_source,learning_language,level,playback_rules,metadata",
    )
    .eq("id", listeningId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!listening) throw new Error("A listening included in this exam is no longer available.");

  const [sectionsResult, setsResult, mediaResult] = await Promise.all([
    admin
      .from("listening_sections")
      .select("id,title,start_seconds,end_seconds,sort_order")
      .eq("listening_id", listeningId)
      .order("sort_order"),
    admin
      .from("listening_question_sets")
      .select("id,section_id,title,instructions,sort_order")
      .eq("listening_id", listeningId)
      .order("sort_order"),
    listening.media_id
      ? admin
          .from("media_assets")
          .select("id,kind,storage_path,external_url,mime_type,size_bytes,duration_seconds,metadata")
          .eq("id", listening.media_id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const result of [sectionsResult, setsResult, mediaResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const setSnapshots = [];
  for (const set of setsResult.data ?? []) {
    const { data: questions, error: questionError } = await admin
      .from("questions")
      .select("id,context_sort")
      .eq("listening_question_set_id", set.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("context_sort");
    if (questionError) throw new Error(questionError.message);

    const questionSnapshots = [];
    for (const question of questions ?? []) {
      questionSnapshots.push(await snapshotQuestion(admin, question.id));
    }

    setSnapshots.push({
      id: set.id,
      section_id: set.section_id,
      title: set.title,
      instructions: set.instructions,
      questions: questionSnapshots,
    });
  }

  return {
    kind: "listening",
    listening: {
      id: listening.id,
      title: listening.title,
      media_id: listening.media_id,
      transcript: listening.transcript,
      transcript_segments: listening.transcript_segments,
      transcript_source: listening.transcript_source,
      learning_language: listening.learning_language,
      level: listening.level,
      playback_rules: listening.playback_rules,
      metadata: listening.metadata,
      media: mediaResult.data,
    },
    sections: sectionsResult.data ?? [],
    question_sets: setSnapshots,
  };
}

async function snapshotCatalog(admin: Admin, catalogId: string) {
  const { data: catalog, error } = await admin
    .from("catalogs")
    .select("id,name,description")
    .eq("id", catalogId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!catalog) throw new Error("A catalog included in this exam is no longer available.");

  const { data: items, error: itemError } = await admin
    .from("catalog_items")
    .select("entity_type,entity_id,sort_order")
    .eq("catalog_id", catalogId)
    .order("sort_order");
  if (itemError) throw new Error(itemError.message);

  const snapshots = [];
  const skipped: Array<{ entity_type: string; entity_id: string; reason: string }> = [];

  for (const item of items ?? []) {
    if (item.entity_type === "question") {
      snapshots.push(await snapshotQuestion(admin, item.entity_id));
    } else if (item.entity_type === "reading") {
      snapshots.push(await snapshotReading(admin, item.entity_id));
    } else if (item.entity_type === "listening") {
      snapshots.push(await snapshotListening(admin, item.entity_id));
    } else {
      skipped.push({
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        reason: "This catalog item is not directly assessable.",
      });
    }
  }

  if (!snapshots.length) throw new Error(`Catalog "${catalog.name}" has no assessable content.`);

  return {
    kind: "catalog",
    catalog: {
      id: catalog.id,
      name: catalog.name,
      description: catalog.description,
    },
    items: snapshots,
    skipped,
  };
}

async function poolCandidates(
  admin: Admin,
  filters: z.infer<typeof poolFilterSchema>,
) {
  let query = admin
    .from("questions")
    .select("id")
    .eq("status", "active")
    .eq("context_kind", "none")
    .is("deleted_at", null)
    .limit(2_000);

  if (filters.language) query = query.eq("learning_language", filters.language);
  if (filters.level) query = query.eq("level", filters.level);
  if (filters.types.length) query = query.in("question_type", filters.types);

  if (filters.topicIds.length) {
    const { data: topicRows, error } = await admin
      .from("question_topics")
      .select("question_id")
      .in("topic_id", filters.topicIds);
    if (error) throw new Error(error.message);
    const ids = [...new Set((topicRows ?? []).map((row) => row.question_id))];
    if (!ids.length) return [];
    query = query.in("id", ids);
  }

  if (filters.catalogId) {
    const { data: catalogRows, error } = await admin
      .from("catalog_items")
      .select("entity_id")
      .eq("catalog_id", filters.catalogId)
      .eq("entity_type", "question");
    if (error) throw new Error(error.message);
    const ids = [...new Set((catalogRows ?? []).map((row) => row.entity_id))];
    if (!ids.length) return [];
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const snapshots = [];
  for (const row of data ?? []) snapshots.push(await snapshotQuestion(admin, row.id));
  return snapshots;
}

export const publishExam = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ examId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const exam = await ensureDraftExam(admin, data.examId);

    if (exam.available_until && new Date(exam.available_until).getTime() <= Date.now()) {
      throw new Error("The exam close time is already in the past.");
    }

    const publishSettings = normalizeSettings(exam.settings);
    const needsCloseTime =
      publishSettings.result_release === "after_close" ||
      publishSettings.answer_visibility === "after_close" ||
      publishSettings.explanation_visibility === "after_close";
    if (needsCloseTime && !exam.available_until) {
      throw new Error(
        'A closing time is required when result, answer, or explanation visibility uses "after close".',
      );
    }

    const [sectionsResult, itemsResult] = await Promise.all([
      admin
        .from("exam_sections")
        .select("id,title,instructions,sort_order,pool_rules")
        .eq("exam_id", data.examId)
        .order("sort_order"),
      admin
        .from("exam_items")
        .select("id,section_id,entity_type,entity_id,points,sort_order")
        .eq("exam_id", data.examId)
        .order("sort_order"),
    ]);

    if (sectionsResult.error) throw new Error(sectionsResult.error.message);
    if (itemsResult.error) throw new Error(itemsResult.error.message);

    if (!(sectionsResult.data ?? []).length) throw new Error("Add at least one exam section.");

    const sectionSnapshots = [];
    let assessableCount = 0;

    for (const section of sectionsResult.data ?? []) {
      const fixedSnapshots = [];
      const sectionItems = (itemsResult.data ?? []).filter((item) => item.section_id === section.id);

      for (const item of sectionItems) {
        if (!item.entity_id) continue;
        let snapshot: unknown;
        if (item.entity_type === "question") snapshot = await snapshotQuestion(admin, item.entity_id);
        else if (item.entity_type === "reading") snapshot = await snapshotReading(admin, item.entity_id);
        else if (item.entity_type === "listening") snapshot = await snapshotListening(admin, item.entity_id);
        else if (item.entity_type === "catalog") snapshot = await snapshotCatalog(admin, item.entity_id);
        else throw new Error("Unsupported exam item type.");

        fixedSnapshots.push({
          item_id: item.id,
          entity_type: item.entity_type,
          points: item.points,
          snapshot,
        });
        assessableCount++;
      }

      const rules = normalizePoolRules(section.pool_rules);
      const pools = [];
      if (rules.enabled) {
        for (const pool of rules.pools) {
          const candidates = await poolCandidates(admin, pool.filters);
          if (candidates.length < pool.count) {
            throw new Error(
              `Pool "${pool.name}" requires ${pool.count} questions but only ${candidates.length} match.`,
            );
          }
          pools.push({
            id: pool.id,
            name: pool.name,
            count: pool.count,
            filters: pool.filters,
            candidates,
          });
          assessableCount += pool.count;
        }
      }

      sectionSnapshots.push({
        id: section.id,
        title: section.title,
        instructions: section.instructions,
        sort_order: section.sort_order,
        fixed_items: fixedSnapshots,
        pools,
      });
    }

    if (!assessableCount) throw new Error("Add at least one assessable item or random pool before publishing.");

    const publishedAt = new Date().toISOString();
    const snapshot = {
      schema_version: 1,
      published_at: publishedAt,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        available_from: exam.available_from,
        available_until: exam.available_until,
        duration_minutes: exam.duration_minutes,
        settings: normalizeSettings(exam.settings),
      },
      sections: sectionSnapshots,
    };

    const status =
      exam.available_from && new Date(exam.available_from).getTime() > Date.now()
        ? "scheduled"
        : "active";

    const { error: updateError } = await admin
      .from("exams")
      .update({
        published_snapshot: snapshot as never,
        published_at: publishedAt,
        status,
      })
      .eq("id", data.examId)
      .eq("status", "draft");
    if (updateError) throw new Error(updateError.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "exam_published",
      entity_type: "exam",
      entity_id: data.examId,
      summary: `Published exam "${exam.title}"`,
      details: {
        status,
        assessable_count: assessableCount,
        sections: sectionSnapshots.length,
      },
    });

    await notifyExamAvailability(admin, {
      id: exam.id,
      title: exam.title,
      published_at: publishedAt,
      status,
      available_from: exam.available_from,
    });

    return {
      ok: true,
      status,
      published_at: publishedAt,
      assessable_count: assessableCount,
    };
  });

export const setExamLifecycleStatus = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        examId: z.string().uuid(),
        status: z.enum(["scheduled", "active", "finished", "archived"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const exam = await getExamRow(context.supabase, data.examId);
    if (!exam.published_at) throw new Error("Publish the exam before changing its lifecycle status.");

    const { error } = await context.supabase
      .from("exams")
      .update({ status: data.status })
      .eq("id", data.examId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const trashDraftExam = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ examId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureDraftExam(context.supabase, data.examId);
    const { error } = await context.supabase
      .from("exams")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.examId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
