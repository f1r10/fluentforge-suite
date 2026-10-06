import { createServerFn } from "@tanstack/react-start";
import { requireTeacher } from "./teacher-middleware";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const [{ data: activity }, { data: dashboardSetting }] = await Promise.all([
      sb
        .from("activity_events")
        .select("id, event_type, created_at, details, students(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(10),
      sb
        .from("system_settings")
        .select("value")
        .eq("key", "dashboard")
        .maybeSingle(),
    ]);
    const visibleWidgets =
      dashboardSetting?.value &&
      typeof dashboardSetting.value === "object" &&
      Array.isArray((dashboardSetting.value as Record<string, unknown>)["visible_widgets"])
        ? ((dashboardSetting.value as Record<string, unknown>)["visible_widgets"] as unknown[])
            .filter((value): value is string => typeof value === "string")
        : [
            "students",
            "active_today",
            "groups",
            "catalogs",
            "exams",
            "pending_reviews",
            "online_now",
            "recent_activity",
            "upcoming_exams",
            "recent_catalogs",
          ];
    return {
      counts: { students, activeToday: active, groups, catalogs, questions, vocab, exams, pendingReviews, unreadInbox },
      visibleWidgets,
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
      rows: ((rows ?? []) as unknown as Array<{ id: string; first_name: string; last_name: string; username: string; status: string; last_active_at: string | null; group_memberships: { groups: { id: string; name: string } }[] }>).map((r) => ({
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

export const createStudent = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        first_name: z.string().trim().min(1).max(80),
        last_name: z.string().trim().min(1).max(80),
        username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/),
        groupIds: z.array(z.string().uuid()).max(100).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, randomToken, randomPassword, audit } = await import("./security.server");
    const admin = await adminClient();
    const username = data.username.toLowerCase();
    const { data: exists } = await admin.from("students").select("id").ilike("username", username).maybeSingle();
    if (exists) throw new Error("This username is already taken.");

    const { data: u, error } = await admin.auth.admin.createUser({
      email: `student-${randomToken(14).toLowerCase()}@accounts.local`,
      password: randomPassword(),
      email_confirm: true,
    });
    if (error || !u.user) throw new Error(error?.message ?? "Could not create student");

    let studentId: string | null = null;
    try {
      const { error: roleError } = await admin.from("user_roles").insert({
        user_id: u.user.id,
        role: "student",
      });
      if (roleError) throw new Error(roleError.message);

      const { data: st, error: studentError } = await admin
        .from("students")
        .insert({
          first_name: data.first_name,
          last_name: data.last_name,
          username,
          auth_user_id: u.user.id,
        })
        .select("id")
        .single();
      if (studentError || !st) throw new Error(studentError?.message ?? "Could not create student profile");
      studentId = st.id;

      if (data.groupIds.length) {
        const { error: groupError } = await admin.from("group_memberships").insert(
          [...new Set(data.groupIds)].map((groupId) => ({
            group_id: groupId,
            student_id: st.id,
          })),
        );
        if (groupError) throw new Error(groupError.message);
      }

      const key = await issueKey(admin, st.id, username);
      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "student_created",
        entity_type: "student",
        entity_id: st.id,
        summary: `Created student ${data.first_name} ${data.last_name}`,
      });
      return { id: st.id, key };
    } catch (studentError) {
      // Supabase Auth is outside the public-schema transaction boundary.
      // Compensate so a failed multi-step create does not leave a half-created student.
      if (studentId) {
        await admin.from("students").delete().eq("id", studentId);
      }
      await admin.from("user_roles").delete().eq("user_id", u.user.id);
      await admin.auth.admin.deleteUser(u.user.id);
      throw studentError;
    }
  });

export const regenerateKey = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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

export const revokeStudentKey = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const now = new Date().toISOString();
    const { data: student } = await admin
      .from("students")
      .select("username")
      .eq("id", data.studentId)
      .maybeSingle();
    if (!student) throw new Error("Student not found.");

    await admin
      .from("student_access_keys")
      .update({ revoked_at: now })
      .eq("student_id", data.studentId)
      .is("revoked_at", null);
    await admin
      .from("student_sessions")
      .update({ revoked_at: now })
      .eq("student_id", data.studentId)
      .is("revoked_at", null);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "key_revoked",
      entity_type: "student",
      entity_id: data.studentId,
      summary: `Access key revoked for ${student.username}`,
    });
    return { ok: true };
  });

export const setStudentStatus = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ studentId: z.string().uuid(), status: z.enum(["active", "disabled", "archived"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    await admin.from("students").update({ status: data.status }).eq("id", data.studentId);
    if (data.status !== "active") await admin.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("student_id", data.studentId).is("revoked_at", null);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "student_status", entity_type: "student", entity_id: data.studentId, summary: `Student status set to ${data.status}` });
    return { ok: true };
  });

export const terminateSessions = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    await admin.from("student_sessions").update({ revoked_at: new Date().toISOString() }).eq("student_id", data.studentId).is("revoked_at", null);
    await audit(admin, { actor_type: "teacher", actor_id: context.userId, action: "sessions_terminated", entity_type: "student", entity_id: data.studentId, summary: "Ended all student sessions" });
    return { ok: true };
  });

export const updateStudent = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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

export const saveGroup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), description: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) await context.supabase.from("groups").update({ name: data.name, description: data.description ?? null }).eq("id", data.id);
    else await context.supabase.from("groups").insert({ name: data.name, description: data.description ?? null });
    return { ok: true };
  });

export const deleteGroup = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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

export const createCatalog = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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

export const createExam = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, string | number | boolean | null | string[]>>;
  });

export const saveBranding = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        system_name: z.string().trim().min(1).max(100),
        short_name: z.string().max(40),
        login_title: z.string().max(120),
        welcome_message: z.string().max(1000),
        login_instructions: z.string().max(1000),
        footer: z.string().max(300),
        support_text: z.string().max(500),
        accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        logo_url: z.string().url().nullable().or(z.literal("")),
        favicon_url: z.string().url().nullable().or(z.literal("")),
        login_image_url: z.string().url().nullable().or(z.literal("")),
        teacher_login_button: z.string().max(80).default(""),
        student_login_button: z.string().max(80).default(""),
        setup_button: z.string().max(80).default(""),
        default_language: z.enum(["az", "en", "ru", "tr"]),
        enabled_languages: z
          .array(z.enum(["az", "en", "ru", "tr"]))
          .min(1)
          .max(4),
      })
      .superRefine((value, ctx) => {
        if (!value.enabled_languages.includes(value.default_language)) {
          ctx.addIssue({
            code: "custom",
            path: ["default_language"],
            message: "Default language must be enabled.",
          });
        }
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { default_language, enabled_languages, ...branding } = data;
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: currentRow, error: currentError } = await context.supabase
      .from("system_settings")
      .select("value")
      .eq("key", "branding")
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);

    const current =
      currentRow?.value && typeof currentRow.value === "object"
        ? (currentRow.value as Record<string, unknown>)
        : {};

    const logoUrl = branding.logo_url || null;
    const faviconUrl = branding.favicon_url || null;
    const loginImageUrl = branding.login_image_url || null;
    const currentLogoUrl =
      typeof current["logo_url"] === "string" ? current["logo_url"] : null;
    const currentFaviconUrl =
      typeof current["favicon_url"] === "string"
        ? current["favicon_url"]
        : null;
    const currentLogoPath =
      typeof current["logo_storage_path"] === "string"
        ? current["logo_storage_path"]
        : null;
    const currentFaviconPath =
      typeof current["favicon_storage_path"] === "string"
        ? current["favicon_storage_path"]
        : null;

    const logoStoragePath =
      logoUrl && logoUrl === currentLogoUrl ? currentLogoPath : null;
    const faviconStoragePath =
      faviconUrl && faviconUrl === currentFaviconUrl
        ? currentFaviconPath
        : null;

    const { error: brandingError } = await context.supabase
      .from("system_settings")
      .update({
        value: {
          ...branding,
          logo_url: logoUrl,
          favicon_url: faviconUrl,
          login_image_url: loginImageUrl,
          logo_storage_path: logoStoragePath,
          favicon_storage_path: faviconStoragePath,
        } as never,
      })
      .eq("key", "branding");
    if (brandingError) throw new Error(brandingError.message);

    const { data: interfaceRow, error: interfaceReadError } =
      await context.supabase
        .from("system_settings")
        .select("value")
        .eq("key", "interface")
        .maybeSingle();
    if (interfaceReadError) throw new Error(interfaceReadError.message);

    const interfaceValue =
      interfaceRow?.value && typeof interfaceRow.value === "object"
        ? (interfaceRow.value as Record<string, unknown>)
        : {};

    const { error: interfaceError } = await context.supabase
      .from("system_settings")
      .update({
        value: {
          ...interfaceValue,
          default_language,
          enabled_languages: [...new Set(enabled_languages)],
        } as never,
      })
      .eq("key", "interface");
    if (interfaceError) throw new Error(interfaceError.message);

    const stalePaths = [
      currentLogoPath && currentLogoPath !== logoStoragePath
        ? currentLogoPath
        : null,
      currentFaviconPath && currentFaviconPath !== faviconStoragePath
        ? currentFaviconPath
        : null,
    ].filter((value): value is string => !!value);
    if (stalePaths.length) {
      await admin.storage.from("branding").remove(stalePaths);
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "settings_changed",
      summary: "Branding settings updated",
    });
    return { ok: true };
  });

export const saveDashboardSettings = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        visible_widgets: z
          .array(
            z.enum([
              "students",
              "active_today",
              "groups",
              "catalogs",
              "exams",
              "pending_reviews",
              "online_now",
              "recent_activity",
              "upcoming_exams",
              "recent_catalogs",
            ]),
          )
          .max(10),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const value = {
      visible_widgets: [...new Set(data.visible_widgets)],
    };
    const { error } = await context.supabase
      .from("system_settings")
      .upsert(
        {
          key: "dashboard",
          value: value as never,
          is_public: false,
        },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);

    const { adminClient, audit } = await import("./security.server");
    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "dashboard_settings_changed",
      entity_type: "system_setting",
      entity_id: "dashboard",
      summary: "Teacher dashboard widgets updated",
      details: value,
    });

    return { ok: true };
  });

export const changeCredentials = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
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

export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireTeacher]).handler(async ({ context }) => {
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
