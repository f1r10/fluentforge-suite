import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ language: z.enum(["az", "en", "ru", "tr"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) throw new Error("Forbidden");
    const { adminClient } = await import("./security.server");
    await (await adminClient()).from("students").update({ interface_language: data.language }).eq("id", sid);
    return { ok: true };
  });

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ location: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) return { ok: false };
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const now = new Date().toISOString();
    const claims = (context.claims ?? {}) as Record<string, unknown>;
    if (claims["session_id"]) await admin.from("student_sessions").update({ last_seen_at: now, current_location: data.location }).eq("auth_session_id", String(claims["session_id"]));
    await admin.from("students").update({ last_active_at: now }).eq("id", sid);
    return { ok: true };
  });
