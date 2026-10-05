import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const requireTeacher = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "teacher").maybeSingle();
    if (!data) throw new Error("Forbidden");
    return next();
  });

const t = () => createServerFn({ method: "POST" }).middleware([requireTeacher]);

export const getWhoAmI = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    const isTeacher = !!roles?.some((r) => r.role === "teacher");
    if (isTeacher) {
      const { data: a } = await context.supabase.from("admin_users").select("username, display_name").eq("auth_user_id", context.userId).maybeSingle();
      return { role: "teacher" as const, username: a?.username ?? "", name: a?.display_name ?? a?.username ?? "" };
    }
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) return { role: "none" as const };
    const { data: s } = await context.supabase.from("students").select("id, first_name, last_name, username, interface_language").eq("id", sid).single();
    return { role: "student" as const, ...s! };
  });

// ---------- Dashboard ----------
export const getTeacherDashboard = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const c = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const [students, active, groups, catalogs, questions, vocab, exams, pendingReviews, unreadInbox, online] = await Promise.all([
      c(sb.from("students").select("id", { count: "exact", head: true }).is("deleted_at", null).neq("status", "archived")),
      c(sb.from("students").select("id", { count: "exact", head: true }).gte("last_active_at", dayStart.toISOString())),
      c(sb.from("groups").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      c(sb.from("catalogs").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      c(sb.from("questions").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      c(sb.from("vocabulary_entries").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      c(sb.from("exams").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", ["scheduled", "active"])),
      c(sb.from("manual_reviews").select("id", { count: "exact", head: true }).eq("status", "pending")),
      c(sb.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_type", "teacher").is("read_at", null)),
      sb.from("student_sessions").select("last_seen_at, current_location, students!inner(id, first_name, last_name)").is("revoked_at", null).gte("last_seen_at", since).order("last_seen_at", { ascending: false }).limit(20),
    ]);
    const { data: upcomingExams } = await sb.from("exams").select("id, title, status, available_from, available_until").is("deleted_at", null).order("created_at", { ascending: false }).limit(5);
    const { data: recentCatalogs } = await sb.from("catalogs").select("id, name, updated_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(5);
    const { data: activity } = await sb.from("activity_events").select("id, event_type, created_at, details, students(first_name, last_name)").order("created_at", { ascending: false }).limit(10);
    return {
      counts: { students, activeToday: active, groups, catalogs, questions, vocab, exams, pendingReviews, unreadInbox },
      online: (online.data ?? []).map((o) => ({ ...(o.students as unknown as { id: string; first_name: string; last_name: string }), last_seen_at: o.last_seen_at, location: o.current_location })),
      upcomingExams: upcomingExams ?? [],
      recentCatalogs: recentCatalogs ?? [],
      activity: (activity ?? []).map((a) => ({ id: a.id, type: a.event_type, at: a.created_at, student: a.students as unknown as { first_name: string; last_name: string } | null })),
    };
  });

// ---------- Students ----------
export const listStudents = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ search: z.string().max(100).default(""), status: z.enum(["active", "disabled", "archived", "all"]).default("all"), groupId: z.string().uuid().optional(), page: z.number().int().min(0).default(0) }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const size = 50;
    let q = context.supabase
      .from("students")
      .select("id, first_name, last_name, username, status, last_active_at, created_at, group_memberships(group_id, groups(id, name))" + (data.groupId ? ", gm:group_memberships!inner(group_id)" : ""), { count: "exact" })
      .is("deleted_at", null)
      .order("last_name")
      .range(data.page * size, data.page * size + size - 1);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.groupId) q = q.eq("gm.group_id", data.groupId);
    if (data.search) {
      const s = data.search.replace(/[,()%]/g, "");
      q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,username.ilike.%${s}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      rows: ((rows ?? []) as unknown as Array<Record<string, unknown> & { group_memberships: { groups: { id: string; name: string } }[] }>).map((r) => ({
        id: r.id as string, first_name: r.first_name as string, last_name: r.last_name as string, username: r.username as string,
        status: r.status as "active" | "disabled" | "archived", last_active_at: r.last_active_at as string | null,
        groups: r.group_memberships.map((m) => m.groups).filter(Boolean),
      })),
    };
  });

export function suggestUsername(first: string, last: string) {
  const map: Record<string, string> = { ə: "e", ı: "i", ö: "o", ü: "u", ğ: "g", ş: "s", ç: "c", İ: "i" };
  const clean = (s: string) => s.toLowerCase().split("").map((ch) => map[ch] ?? ch).join("").normalize("NFD").replace(/[^a-z0-9]/g, "");
  return [clean(first), clean(last)].filter(Boolean).join(".");
}

async function issueKey(admin: Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>, studentId: string, username: string) {
  const { randomToken, sha256 } = await import("./security.server");
  const key = `${username}@${randomToken(32)}`;
  await admin.from("student_access_keys").update({ revoked_at: new Date().toISOString() }).eq("student_id", studentId).is("revoked_at", null);
  await admin.from("student_access_keys").insert({ student_id: studentId, key_hash: sha256(key), key_hint: key.slice(-4) });
  return key;
}

export const createStudent = t()
  .inputValidator((d) => z.object({ first_name: z.string().trim().min(1).max(80), last_name: z.string().trim().min(1).max(80), username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/), groupIds: z.array(z.string().uuid()).default([]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, randomToken, randomPassword, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: exists } = await admin.from("students").select("id").eq("username", data.username).maybeSingle();
    if (exists) throw new Error("This username is already taken.");
    const { data: u, error } = await admin.auth.admin.createUser({ email: `student-${randomToken(14).toLowerCase()}@accounts.local`, password: randomPassword(), email_confirm: true });
    if (error || !u.user) throw new Error(error?.message ?? "Could not create student");
    await admin.from("user_roles").insert({ user_id: u.user.id, role: "student" });
    const { data: st, error: e2 } = await admin.from("students").insert({ first_name: data.first_name, last_name: data.last_name, username: data.username, auth_user_id: u.user.id }).select("id").single();
    if (e2) throw new Error(e2.message);
    if (data.groupIds.length) await admin.from("group_memberships").insert(data.groupIds.map((g) => ({ group_id: g, student_id: st.id })));
    const key = await issueKey(admin, st.id, data.username);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "student_created", entity_type: "student", entity_id: st.id, summary: `Created student ${data.first_name} ${data.last_name}` });
    return { id: st.id, key };
  });

export const regenerateKey = t()
  .inputValidator((d) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: st } = await admin.from("students").select("id, username").eq("id", data.studentId).single();
    if (!st) throw new Error("Not found");
    const key = await issueKey(admin, st.id, st.username);
    await admin.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("student_id", st.id).is("revoked_at", null);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "key_regenerated", entity_type: "student", entity_id: st.id, summary: `New access key for ${st.username}` });
    return { key };
  });

export const setStudentStatus = t()
  .inputValidator((d) => z.object({ studentId: z.string().uuid(), status: z.enum(["active", "disabled", "archived"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    await admin.from("students").update({ status: data.status }).eq("id", data.studentId);
    if (data.status !== "active") await admin.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("student_id", data.studentId).is("revoked_at", null);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "student_status", entity_type: "student", entity_id: data.studentId, summary: `Student status set to ${data.status}` });
    return { ok: true };
  });

export const terminateSessions = t()
  .inputValidator((d) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    await admin.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("student_id", data.studentId).is("revoked_at", null);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "sessions_terminated", entity_type: "student", entity_id: data.studentId, summary: "Ended all student sessions" });
    return { ok: true };
  });

export const updateStudent = t()
  .inputValidator((d) => z.object({ studentId: z.string().uuid(), first_name: z.string().trim().min(1).max(80), last_name: z.string().trim().min(1).max(80), groupIds: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await sb.from("students").update({ first_name: data.first_name, last_name: data.last_name }).eq("id", data.studentId);
    await sb.from("group_memberships").delete().eq("student_id", data.studentId);
    if (data.groupIds.length) await sb.from("group_memberships").insert(data.groupIds.map((g) => ({ group_id: g, student_id: data.studentId })));
    return { ok: true };
  });

// ---------- Groups ----------
export const listGroups = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("groups").select("id, name, description, group_memberships(count)").is("deleted_at", null).order("name");
    return (data ?? []).map((g) => ({ id: g.id, name: g.name, description: g.description, members: (g.group_memberships as unknown as { count: number }[])[0]?.count ?? 0 }));
  });

export const saveGroup = t()
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), description: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) await context.supabase.from("groups").update({ name: data.name, description: data.description ?? null }).eq("id", data.id);
    else await context.supabase.from("groups").insert({ name: data.name, description: data.description ?? null });
    return { ok: true };
  });

export const deleteGroup = t()
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("groups").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

// ---------- Catalogs & exams (overview) ----------
export const listCatalogs = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("catalogs").select("id, name, description, status, updated_at, catalog_items(count)").is("deleted_at", null).order("sort_order").order("name");
    return (data ?? []).map((c) => ({ ...c, items: (c.catalog_items as unknown as { count: number }[])[0]?.count ?? 0 }));
  });

export const createCatalog = t()
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("catalogs").insert({ name: data.name, description: data.description ?? null });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listExams = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("exams").select("id, title, status, available_from, available_until, duration_minutes, updated_at").is("deleted_at", null).order("created_at", { ascending: false });
    return data ?? [];
  });

export const createExam = t()
  .inputValidator((d) => z.object({ title: z.string().trim().min(1).max(160), duration_minutes: z.number().int().min(1).max(1440).nullable(), available_from: z.string().nullable(), available_until: z.string().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: defaults } = await context.supabase.from("system_settings").select("value").eq("key", "exam_defaults").maybeSingle();
    const { error } = await context.supabase.from("exams").insert({ ...data, settings: (defaults?.value ?? {}) as never });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Settings ----------
export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("system_settings").select("key, value");
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, unknown>>;
  });

export const saveBranding = t()
  .inputValidator((d) =>
    z.object({
      system_name: z.string().trim().min(1).max(100), short_name: z.string().max(40), login_title: z.string().max(120),
      welcome_message: z.string().max(1000), login_instructions: z.string().max(1000), footer: z.string().max(300), support_text: z.string().max(500),
      accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), logo_url: z.string().url().nullable().or(z.literal("")), login_image_url: z.string().url().nullable().or(z.literal("")),
      default_language: z.enum(["az", "en", "ru", "tr"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { default_language, ...branding } = data;
    const { adminClient, audit } = await import("./security.server");
    await context.supabase.from("system_settings").update({ value: { ...branding, logo_url: branding.logo_url || null, login_image_url: branding.login_image_url || null } }).eq("key", "branding");
    await context.supabase.from("system_settings").update({ value: { default_language } }).eq("key", "interface");
    await audit(await adminClient(), { actor_type: "teacher", actor_id: context.userId, action: "settings_changed", summary: "Branding settings updated" });
    return { ok: true };
  });

export const changeCredentials = t()
  .inputValidator((d) => z.object({ currentPassword: z.string().min(1), newUsername: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/), newPassword: z.string().min(8).max(200).or(z.literal("")) }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, publicClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: u } = await admin.auth.admin.getUserById(context.userId);
    const { error } = await publicClient().auth.signInWithPassword({ email: u.user!.email!, password: data.currentPassword });
    if (error) throw new Error("Current password is wrong.");
    const username = data.newUsername.toLowerCase();
    const { error: e2 } = await admin.from("admin_users").update({ username }).eq("auth_user_id", context.userId);
    if (e2) throw new Error("This username cannot be used.");
    if (data.newPassword) await admin.auth.admin.updateUserById(context.userId, { password: data.newPassword });
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "credentials_changed", summary: "Teacher sign-in details changed" });
    return { ok: true };
  });

export const generateRecoveryCodes = t().handler(async ({ context }) => {
  const { adminClient, randomToken, sha256, audit } = await import("./security.server");
  const admin = await adminClient();
  const { data: adm } = await admin.from("admin_users").select("id").eq("auth_user_id", context.userId).single();
  await admin.from("admin_recovery_codes").update({ invalidated_at: new Date().toISOString() }).eq("admin_id", adm!.id).is("invalidated_at", null).is("used_at", null);
  const setId = crypto.randomUUID();
  const codes = Array.from({ length: 5 }, () => randomToken(16).toUpperCase());
  await admin.from("admin_recovery_codes").insert(codes.map((c) => ({ admin_id: adm!.id, set_id: setId, code_hash: sha256(c) })));
  await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "recovery_codes_generated", summary: "New recovery codes created" });
  return { codes: codes.map((c) => c.match(/.{4}/g)!.join("-")) };
});

export const getRecoveryStatus = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { count } = await context.supabase.from("admin_recovery_codes").select("id", { count: "exact", head: true }).is("used_at", null).is("invalidated_at", null);
    return { remaining: count ?? 0 };
  });
