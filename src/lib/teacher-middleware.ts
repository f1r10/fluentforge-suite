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

    return next();
  });
