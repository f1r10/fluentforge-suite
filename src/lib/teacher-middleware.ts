import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requireTeacher = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    // Authentication is already established by requireSupabaseAuth. Verify the
    // role through the trusted server client instead of a user-scoped RLS query.
    // This avoids false "Forbidden" responses when PostgREST/RLS role visibility
    // differs between GET loaders and POST server functions.
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data, error } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "teacher")
      .maybeSingle();

    if (error) {
      throw new Error(`Teacher authorization failed: ${error.message}`);
    }
    if (!data) throw new Error("Forbidden");

    const { data: member, error: memberError } = await admin
      .from("tenant_teacher_memberships")
      .select("workspace_id,tenant_workspaces!inner(status)")
      .eq("teacher_auth_user_id", context.userId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    const workspace = member?.tenant_workspaces as unknown as { status: string } | null;
    if (!member || workspace?.status !== "active") {
      throw new Error("Teacher workspace is not active.");
    }
    const { assertActiveWorkspaceSession } = await import("./session-workspace.server");
    await assertActiveWorkspaceSession(context.userId, String(context.claims?.session_id ?? ""));

    return next();
  });
