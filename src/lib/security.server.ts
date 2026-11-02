import { createHash, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createRuntimeAdminClient, createRuntimePublicClient } from "@/runtime/server-client";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function randomToken(length: number) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function randomPassword() {
  return randomBytes(32).toString("base64url");
}

export function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

type SupabaseCompatibleClient = ReturnType<typeof createClient<Database>>;

function postgresRuntime() {
  return process.env["RUNTIME_BACKEND"] === "postgres";
}

export function publicClient(): SupabaseCompatibleClient {
  if (postgresRuntime()) {
    return createRuntimePublicClient() as unknown as SupabaseCompatibleClient;
  }

  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/** Platform-only privileged client. Do not use in teacher/student CRUD. */
export async function privilegedAdminClient(): Promise<SupabaseCompatibleClient> {
  if (postgresRuntime()) {
    return createRuntimeAdminClient() as unknown as SupabaseCompatibleClient;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Authenticated teacher/student data MUST run under user RLS. The separate
 * service-role auth/storage helpers are retained for controlled operations.
 * No request token means this is a public/system action and callers must
 * separately authorize it; public actions are audited by route.
 */
export async function adminClient(): Promise<SupabaseCompatibleClient> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const auth = getRequest()?.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token && postgresRuntime()) {
    const { verifyRuntimeJwt } = await import("@/runtime/jwt.server");
    const claims = verifyRuntimeJwt(token);
    if (claims.role === "authenticated") {
      const { createRuntimeScopedAdminClient } = await import("@/runtime/server-client");
      return createRuntimeScopedAdminClient(token) as unknown as SupabaseCompatibleClient;
    }
  }
  // Supabase Cloud still uses V1 unscoped semantics and is explicitly
  // ineligible for multi-teacher enablement until parity is established.
  return privilegedAdminClient();
}

type Admin = Awaited<ReturnType<typeof adminClient>>;

const WINDOW_MIN = 15;
const MAX_FAILS = 8;

export async function checkRateLimit(admin: Admin, kind: string, identifier: string, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await admin
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("success", false)
    .gte("created_at", since)
    .or(`identifier.eq.${identifier.replace(/[,()]/g, "")}${ip ? `,ip.eq.${ip}` : ""}`);
  if ((count ?? 0) >= MAX_FAILS) {
    throw new Error("Too many attempts. Please wait 15 minutes and try again.");
  }
}

export async function recordAttempt(admin: Admin, kind: string, identifier: string, ip: string | null, success: boolean) {
  await admin.from("login_attempts").insert({ kind, identifier, ip, success });
}

export async function audit(
  admin: Admin,
  entry: { actor_type: string; actor_id?: string | null; action: string; entity_type?: string; entity_id?: string; summary?: string; details?: Record<string, unknown>; ip?: string | null },
) {
  await admin.from("audit_logs").insert({ ...entry, details: (entry.details ?? {}) as never });
}

/** Signs a user in with a freshly-rotated password and returns session tokens. */
export async function mintSession(admin: Admin, authUserId: string) {
  const password = randomPassword();
  const { data: u, error: e1 } = await admin.auth.admin.updateUserById(authUserId, { password });
  if (e1 || !u.user?.email) throw new Error("Sign-in failed");
  const { data, error } = await publicClient().auth.signInWithPassword({ email: u.user.email, password });
  if (error || !data.session) throw new Error("Sign-in failed");
  return data.session;
}
