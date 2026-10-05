import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LayoutDashboard, Users, UsersRound, FolderOpen, ClipboardList, Settings, LogOut } from "lucide-react";
import { getWhoAmI } from "@/lib/teacher.functions";
import { supabase } from "@/integrations/supabase/client";
import { brandingQuery } from "@/routes/__root";
import { LanguageSelect } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role !== "teacher") throw redirect({ to: me.role === "student" ? "/student" : "/" });
    return { me };
  },
  head: () => ({ meta: [{ title: "Teacher panel" }, { name: "robots", content: "noindex" }] }),
  component: TeacherLayout,
});

const NAV = [
  { to: "/teacher", key: "dashboard", icon: LayoutDashboard, exact: true },
  { to: "/teacher/students", key: "students", icon: Users },
  { to: "/teacher/groups", key: "groups", icon: UsersRound },
  { to: "/teacher/catalogs", key: "catalogs", icon: FolderOpen },
  { to: "/teacher/exams", key: "exams", icon: ClipboardList },
  { to: "/teacher/settings", key: "settings", icon: Settings },
] as const;

function TeacherLayout() {
  const { t } = useI18n();
  const { data: b } = useSuspenseQuery(brandingQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/teacher-login", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-sidebar md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="truncate font-bold">{b.short_name || b.system_name}</span>
          <button onClick={signOut} className="text-muted-foreground md:hidden" aria-label={t("sign_out")}><LogOut className="h-5 w-5" /></button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent font-semibold text-primary" }}
            >
              <n.icon className="h-4 w-4" />{t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="hidden space-y-2 px-4 py-4 md:absolute md:bottom-0 md:block md:w-56">
          <LanguageSelect />
          <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" />{t("sign_out")}</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8"><Outlet /></main>
    </div>
  );
}
