import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requirePlatformAdmin = createMiddleware({type:"function"})
  .middleware([requireSupabaseAuth])
  .server(async ({context,next})=>{
    const {adminClient}=await import("./security.server");
    const client=await adminClient();
    const {data, error}=await client.from("platform_admin_users")
      .select("auth_user_id,disabled_at")
      .eq("auth_user_id",context.userId).maybeSingle();
    if(error||!data||data.disabled_at)throw new Error("Forbidden");
    // An administrator must never implicitly inherit teacher content access.
    const {data:teacher}=await client.from("admin_users").select("id")
      .eq("auth_user_id",context.userId).maybeSingle();
    if(teacher)throw new Error("Platform administrators must have distinct identities.");
    return next();
  });
