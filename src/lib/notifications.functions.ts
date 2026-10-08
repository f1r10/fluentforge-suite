import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Admin = Awaited<
  ReturnType<typeof import("./security.server")["adminClient"]>
>;

export type NotificationInput = {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
};

async function insertNotification(
  admin: Admin,
  row: {
    recipient_type: "teacher" | "student";
    student_id: string | null;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    data: Record<string, unknown>;
    dedupe_key: string | null;
  },
) {
  if (row.dedupe_key) {
    const { error } = await admin
      .from("notifications")
      .upsert(row as never, {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin
    .from("notifications")
    .insert(row as never);
  if (error) throw new Error(error.message);
}

export async function notifyTeacher(
  admin: Admin,
  input: NotificationInput,
) {
  await insertNotification(admin, {
    recipient_type: "teacher",
    student_id: null,
    kind: input.kind.slice(0, 100),
    title: input.title.slice(0, 300),
    body: input.body?.slice(0, 5_000) ?? null,
    link: input.link?.slice(0, 1_000) ?? null,
    data: input.data ?? {},
    dedupe_key: input.dedupeKey?.slice(0, 500) ?? null,
  });
}

export async function notifyStudent(
  admin: Admin,
  studentId: string,
  input: NotificationInput,
) {
  await insertNotification(admin, {
    recipient_type: "student",
    student_id: studentId,
    kind: input.kind.slice(0, 100),
    title: input.title.slice(0, 300),
    body: input.body?.slice(0, 5_000) ?? null,
    link: input.link?.slice(0, 1_000) ?? null,
    data: input.data ?? {},
    dedupe_key: input.dedupeKey?.slice(0, 500) ?? null,
  });
}

export async function notifyStudents(
  admin: Admin,
  studentIds: string[],
  input: NotificationInput,
) {
  for (const studentId of [...new Set(studentIds)]) {
    await notifyStudent(admin, studentId, {
      ...input,
      dedupeKey: input.dedupeKey
        ? `${input.dedupeKey}:${studentId}`
        : null,
    });
  }
}

export const listTeacherNotifications = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        page: z.number().int().min(0).default(0),
        unreadOnly: z.boolean().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 50;
    let query = context.supabase
      .from("notifications")
      .select(
        "id,kind,title,body,link,data,read_at,created_at",
        { count: "exact" },
      )
      .eq("recipient_type", "teacher")
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.unreadOnly) query = query.is("read_at", null);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize,
    };
  });

export const markTeacherNotification = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        all: z.boolean().default(false),
        unread: z.boolean().default(false),
      })
      .refine((value) => value.id || value.all, {
        message: "Notification id or all is required.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("notifications")
      .update({
        read_at: data.unread ? null : new Date().toISOString(),
      })
      .eq("recipient_type", "teacher");

    if (!data.all && data.id) query = query.eq("id", data.id);
    if (data.all && !data.unread) query = query.is("read_at", null);

    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        page: z.number().int().min(0).default(0),
        unreadOnly: z.boolean().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: sid, error: sidError } = await context.supabase.rpc(
      "current_student_id",
    );
    if (sidError) throw new Error(sidError.message);
    if (!sid) throw new Error("Forbidden");

    const pageSize = 30;
    let query = context.supabase
      .from("notifications")
      .select("id,kind,title,body,link,data,read_at,created_at", {
        count: "exact",
      })
      .eq("recipient_type", "student")
      .eq("student_id", sid)
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    if (data.unreadOnly) query = query.is("read_at", null);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize,
    };
  });

export const markMyNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        all: z.boolean().default(false),
      })
      .refine((value) => value.id || value.all)
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) throw new Error("Forbidden");

    let query = context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_type", "student")
      .eq("student_id", sid)
      .is("read_at", null);
    if (!data.all && data.id) query = query.eq("id", data.id);

    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reportQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        questionId: z.string().uuid(),
        comment: z.string().trim().max(2_000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) throw new Error("Forbidden");

    const { data: question, error: questionError } = await context.supabase
      .from("questions")
      .select("id,prompt")
      .eq("id", data.questionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (questionError) throw new Error(questionError.message);
    if (!question) throw new Error("Question not found.");

    const { data: existing } = await context.supabase
      .from("question_reports")
      .select("id")
      .eq("student_id", sid)
      .eq("question_id", data.questionId)
      .is("resolved_at", null)
      .maybeSingle();

    if (!existing) {
      const { error } = await context.supabase
        .from("question_reports")
        .insert({
          student_id: sid,
          question_id: data.questionId,
          comment: data.comment || null,
        });
      if (error) throw new Error(error.message);
    }

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    await notifyTeacher(admin, {
      kind: "question_reported",
      title: "A student reported a question",
      body: data.comment || question.prompt.slice(0, 500),
      link: "/teacher/reviews",
      data: {
        question_id: data.questionId,
        student_id: sid,
      },
      dedupeKey: `question-report:${sid}:${data.questionId}`,
    });

    return { ok: true, alreadyReported: !!existing };
  });
