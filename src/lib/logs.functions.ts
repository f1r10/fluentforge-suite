import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const PAGE_SIZE = 60;

function safeSearch(value: string) {
  return value.trim().replace(/[,()%]/g, " ");
}

export const listStudentActivityLogs = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(160).default(""),
        category: z.string().max(80).default("all"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("activity_events")
      .select(
        "id,student_id,category,event_type,entity_type,entity_id,attempt_id,is_correct,duration_ms,details,created_at,students(first_name,last_name,username)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.category !== "all") {
      query = query.eq("category", data.category);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    const needle = safeSearch(data.search).toLocaleLowerCase();
    const mapped = (rows ?? []).map((row) => {
      const student = row.students as unknown as {
        first_name: string;
        last_name: string;
        username: string;
      } | null;
      const details =
        row.details && typeof row.details === "object"
          ? (row.details as Record<string, unknown>)
          : {};
      return {
        id: row.id,
        student_id: row.student_id,
        student_name: student
          ? `${student.first_name} ${student.last_name}`
          : null,
        username: student?.username ?? null,
        category: row.category,
        event_type: row.event_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        attempt_id: row.attempt_id,
        is_correct: row.is_correct,
        duration_ms: row.duration_ms,
        details: summarizeDetails(details),
        created_at: row.created_at,
      };
    });

    const filtered = needle
      ? mapped.filter((row) =>
          [
            row.student_name,
            row.username,
            row.category,
            row.event_type,
            row.entity_type,
            row.details,
          ].some((value) =>
            value?.toLocaleLowerCase().includes(needle),
          ),
        )
      : mapped;

    return {
      rows: filtered,
      total: needle ? filtered.length : count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const listSystemAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(160).default(""),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("audit_logs")
      .select(
        "id,actor_type,actor_id,action,entity_type,entity_id,summary,details,ip,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.search.trim()) {
      const safe = safeSearch(data.search);
      query = query.or(
        `action.ilike.%${safe}%,summary.ilike.%${safe}%,entity_type.ilike.%${safe}%`,
      );
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []).map((row) => ({
        ...row,
        details:
          row.details && typeof row.details === "object"
            ? summarizeDetails(row.details as Record<string, unknown>)
            : "",
      })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const listTechnicalLoginLogs = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(160).default(""),
        success: z.enum(["all", "success", "failed"]).default("all"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("login_attempts")
      .select("id,kind,identifier,ip,success,created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.success !== "all") {
      query = query.eq("success", data.success === "success");
    }
    if (data.search.trim()) {
      const safe = safeSearch(data.search);
      query = query.or(
        `identifier.ilike.%${safe}%,kind.ilike.%${safe}%,ip.ilike.%${safe}%`,
      );
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

function summarizeDetails(details: Record<string, unknown>) {
  const hiddenKeys = new Set([
    "password",
    "access_key",
    "secret",
    "token",
    "response",
  ]);
  const parts: string[] = [];

  for (const [key, raw] of Object.entries(details)) {
    if (hiddenKeys.has(key.toLocaleLowerCase())) continue;
    if (raw === null || raw === undefined) continue;
    if (parts.length >= 8) break;

    let value: string;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      value = String(raw);
    } else if (Array.isArray(raw)) {
      value = `${raw.length} item(s)`;
    } else {
      value = "…";
    }
    parts.push(`${key}: ${value}`);
  }

  return parts.join(" · ");
}
