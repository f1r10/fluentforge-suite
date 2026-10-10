import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

export const TRASH_TYPES = [
  "student",
  "question",
  "vocabulary",
  "reading",
  "listening",
  "catalog",
  "exam",
  "media",
] as const;

export type TrashType = (typeof TRASH_TYPES)[number];

const trashTypeSchema = z.enum(TRASH_TYPES);

export const listTrash = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        type: z.enum(["all", ...TRASH_TYPES]).default("all"),
        search: z.string().max(160).default(""),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const search = data.search.trim().toLocaleLowerCase();
    const wants = (type: TrashType) =>
      data.type === "all" || data.type === type;

    const [
      studentsResult,
      questionsResult,
      vocabularyResult,
      readingsResult,
      listeningsResult,
      catalogsResult,
      examsResult,
      mediaResult,
      maintenanceResult,
    ] = await Promise.all([
      wants("student")
        ? context.supabase
            .from("students")
            .select(
              "id,first_name,last_name,username,status,updated_at,created_at",
            )
            .eq("status", "archived")
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("question")
        ? context.supabase
            .from("questions")
            .select(
              "id,prompt,question_type,status,deleted_at,updated_at",
            )
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("vocabulary")
        ? context.supabase
            .from("vocabulary_entries")
            .select("id,word,status,deleted_at,updated_at")
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("reading")
        ? context.supabase
            .from("readings")
            .select("id,title,status,deleted_at,updated_at")
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("listening")
        ? context.supabase
            .from("listenings")
            .select("id,title,status,deleted_at,updated_at")
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("catalog")
        ? context.supabase
            .from("catalogs")
            .select("id,name,status,deleted_at,updated_at")
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("exam")
        ? context.supabase
            .from("exams")
            .select("id,title,status,deleted_at,updated_at")
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      wants("media")
        ? context.supabase
            .from("media_assets")
            .select(
              "id,original_filename,kind,deleted_at,created_at",
            )
            .not("deleted_at", "is", null)
            .order("deleted_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      context.supabase
        .from("system_settings")
        .select("value")
        .eq("key", "maintenance")
        .maybeSingle(),
    ]);

    for (const result of [
      studentsResult,
      questionsResult,
      vocabularyResult,
      readingsResult,
      listeningsResult,
      catalogsResult,
      examsResult,
      mediaResult,
      maintenanceResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const rows = [
      ...(studentsResult.data ?? []).map((row) => ({
        type: "student" as const,
        id: row.id,
        title: `${row.first_name} ${row.last_name}`,
        subtitle: row.username,
        status: row.status,
        trashed_at: row.updated_at ?? row.created_at,
      })),
      ...(questionsResult.data ?? []).map((row) => ({
        type: "question" as const,
        id: row.id,
        title: row.prompt,
        subtitle: row.question_type,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(vocabularyResult.data ?? []).map((row) => ({
        type: "vocabulary" as const,
        id: row.id,
        title: row.word,
        subtitle: null,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(readingsResult.data ?? []).map((row) => ({
        type: "reading" as const,
        id: row.id,
        title: row.title,
        subtitle: null,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(listeningsResult.data ?? []).map((row) => ({
        type: "listening" as const,
        id: row.id,
        title: row.title,
        subtitle: null,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(catalogsResult.data ?? []).map((row) => ({
        type: "catalog" as const,
        id: row.id,
        title: row.name,
        subtitle: null,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(examsResult.data ?? []).map((row) => ({
        type: "exam" as const,
        id: row.id,
        title: row.title,
        subtitle: null,
        status: row.status,
        trashed_at: row.deleted_at ?? row.updated_at,
      })),
      ...(mediaResult.data ?? []).map((row) => ({
        type: "media" as const,
        id: row.id,
        title: row.original_filename || row.id,
        subtitle: row.kind,
        status: "trashed",
        trashed_at: row.deleted_at ?? row.created_at,
      })),
    ]
      .filter((row) => {
        if (!search) return true;
        return [row.title, row.subtitle, row.type, row.status]
          .filter(Boolean)
          .some((value) =>
            String(value).toLocaleLowerCase().includes(search),
          );
      })
      .sort(
        (a, b) =>
          new Date(b.trashed_at).getTime() -
          new Date(a.trashed_at).getTime(),
      );

    const maintenance =
      maintenanceResult.data?.value &&
      typeof maintenanceResult.data.value === "object"
        ? (maintenanceResult.data.value as Record<string, unknown>)
        : {};

    return {
      rows,
      retention_days:
        typeof maintenance["trash_retention_days"] === "number"
          ? maintenance["trash_retention_days"]
          : 30,
    };
  });

export const restoreTrashItem = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        type: trashTypeSchema,
        id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    switch (data.type) {
      case "student": {
        const { error } = await admin
          .from("students")
          .update({ status: "active" })
          .eq("id", data.id)
          .eq("status", "archived")
          .is("deleted_at", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "question": {
        const { error } = await admin
          .from("questions")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "vocabulary": {
        const { error } = await admin
          .from("vocabulary_entries")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "reading": {
        const { error } = await admin
          .from("readings")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "listening": {
        const { error } = await admin
          .from("listenings")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "catalog": {
        const { error } = await admin
          .from("catalogs")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "exam": {
        const { error } = await admin
          .from("exams")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
      case "media": {
        const { error } = await admin
          .from("media_assets")
          .update({ deleted_at: null })
          .eq("id", data.id)
          .not("deleted_at", "is", null);
        if (error) throw new Error(error.message);
        break;
      }
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "trash_item_restored",
      entity_type: data.type,
      entity_id: data.id,
      summary: `Restored ${data.type} from trash`,
    });

    return { ok: true };
  });

export const trashContextContent = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        type: z.enum(["reading", "listening"]),
        id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const now = new Date().toISOString();

    const table = data.type === "reading" ? "readings" : "listenings";
    const { data: row, error: readError } = await admin
      .from(table)
      .select("id,title")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) throw new Error("Content was not found.");

    const { error } = await admin
      .from(table)
      .update({ deleted_at: now })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: `${data.type}_trashed`,
      entity_type: data.type,
      entity_id: data.id,
      summary: `Moved ${data.type} "${row.title}" to trash`,
    });

    return { ok: true };
  });
