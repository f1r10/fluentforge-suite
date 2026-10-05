import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

function clientIp() {
  const h = getRequest()?.headers;
  return h?.get("cf-connecting-ip") ?? h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
function userAgent() {
  return getRequest()?.headers.get("user-agent") ?? null;
}

type Tokens = { access_token: string; refresh_token: string };

/** Public: is first-run setup still needed? */
export const getSetupState = createServerFn({ method: "GET" }).handler(async () => {
  const { adminClient } = await import("./security.server");
  const admin = await adminClient();
  const { count } = await admin.from("admin_users").select("id", { count: "exact", head: true });
  return { needsSetup: (count ?? 0) === 0 };
});

const usernameSchema = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/);
const passwordSchema = z.string().min(8).max(200);

/** Public, one-time: creates the single teacher account. */
export const setupTeacher = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ username: usernameSchema, password: passwordSchema }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient, randomToken, audit } = await import("./security.server");
    const admin = await adminClient();
    const { count } = await admin.from("admin_users").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) throw new Error("Setup is already complete.");
    const email = `teacher-${randomToken(12).toLowerCase()}@accounts.local`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: data.password, email_confirm: true });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create account");
    await admin.from("user_roles").insert({ user_id: created.user.id, role: "teacher" });
    await admin.from("admin_users").insert({ auth_user_id: created.user.id, username: data.username.toLowerCase() });
    await audit(admin, { actor_type: "teacher", actor_id: created.user.id, action: "setup", summary: "Teacher account created" });
    return { ok: true };
  });

export const teacherLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }): Promise<Tokens> => {
    const { adminClient, publicClient, checkRateLimit, recordAttempt, audit } = await import("./security.server");
    const admin = await adminClient();
    const ip = clientIp();
    const username = data.username.toLowerCase();
    await checkRateLimit(admin, "teacher", username, ip);
    const { data: row } = await admin.from("admin_users").select("auth_user_id").eq("username", username).maybeSingle();
    const fail = async () => {
      await recordAttempt(admin, "teacher", username, ip, false);
      await audit(admin, { actor_type: "system", action: "login_failed", summary: `Failed teacher sign-in for "${username}"`, ip });
      throw new Error("Wrong username or password.");
    };
    if (!row) return fail();
    const { data: u } = await admin.auth.admin.getUserById(row.auth_user_id);
    if (!u.user?.email) return fail();
    const { data: s, error } = await publicClient().auth.signInWithPassword({ email: u.user.email, password: data.password });
    if (error || !s.session) return fail();
    await recordAttempt(admin, "teacher", username, ip, true);
    await audit(admin, { actor_type: "teacher", actor_id: row.auth_user_id, action: "login", summary: "Teacher signed in", ip });
    return { access_token: s.session.access_token, refresh_token: s.session.refresh_token };
  });

export const studentLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ key: z.string().trim().min(10).max(200) }).parse(d))
  .handler(async ({ data }): Promise<Tokens> => {
    const { adminClient, sha256, checkRateLimit, recordAttempt, mintSession, decodeJwt } = await import("./security.server");
    const admin = await adminClient();
    const ip = clientIp();
    const username = (data.key.split("@")[0] ?? "").toLowerCase();
    await checkRateLimit(admin, "student", username || "unknown", ip);
    const { data: keyRow } = await admin
      .from("student_access_keys")
      .select("student_id, students!inner(id, auth_user_id, status, deleted_at, username)")
      .eq("key_hash", sha256(data.key))
      .is("revoked_at", null)
      .maybeSingle();
    const st = keyRow?.students as unknown as { id: string; auth_user_id: string | null; status: string; deleted_at: string | null } | undefined;
    if (!st || !st.auth_user_id || st.status !== "active" || st.deleted_at) {
      await recordAttempt(admin, "student", username || "unknown", ip, false);
      throw new Error("This access key is not valid. Ask your teacher for a new one.");
    }
    const session = await mintSession(admin, st.auth_user_id);
    const claims = decodeJwt(session.access_token);
    await admin.from("student_sessions").insert({
      student_id: st.id,
      auth_session_id: String(claims["session_id"]),
      user_agent: userAgent(),
      ip,
    });
    await admin.from("students").update({ last_active_at: new Date().toISOString() }).eq("id", st.id);
    await admin.from("activity_events").insert({ student_id: st.id, event_type: "login", details: { user_agent: userAgent() } as never });
    await recordAttempt(admin, "student", username, ip, true);
    return { access_token: session.access_token, refresh_token: session.refresh_token };
  });

export const recoverTeacher = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ username: z.string().trim().min(1).max(60), code: z.string().trim().min(6).max(60), newPassword: passwordSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const { adminClient, sha256, checkRateLimit, recordAttempt, audit } = await import("./security.server");
    const admin = await adminClient();
    const ip = clientIp();
    const username = data.username.toLowerCase();
    await checkRateLimit(admin, "recovery", username, ip);
    const { data: adm } = await admin.from("admin_users").select("id, auth_user_id").eq("username", username).maybeSingle();
    const code = data.code.replace(/\s|-/g, "").toUpperCase();
    const { data: codeRow } = adm
      ? await admin
          .from("admin_recovery_codes")
          .select("id")
          .eq("admin_id", adm.id)
          .eq("code_hash", sha256(code))
          .is("used_at", null)
          .is("invalidated_at", null)
          .maybeSingle()
      : { data: null };
    if (!adm || !codeRow) {
      await recordAttempt(admin, "recovery", username, ip, false);
      throw new Error("Username or recovery code is not valid.");
    }
    await admin.from("admin_recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", codeRow.id);
    await admin.auth.admin.updateUserById(adm.auth_user_id, { password: data.newPassword });
    await recordAttempt(admin, "recovery", username, ip, true);
    await audit(admin, { actor_type: "teacher", actor_id: adm.auth_user_id, action: "password_recovered", summary: "Password reset with a recovery code", ip });
    return { ok: true };
  });
