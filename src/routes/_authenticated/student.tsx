import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getWhoAmI } from "@/lib/teacher.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/student")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
    return { me };
  },
  component: () => <Outlet />,
});
