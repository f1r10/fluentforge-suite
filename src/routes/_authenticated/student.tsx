import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BookMarked,
  BookOpen,
  BookType,
  ClipboardList,
  Dumbbell,
  FileQuestion,
  FolderOpen,
  Headphones,
  Home,
  LogOut,
} from "lucide-react";
import { getWhoAmI } from "@/lib/teacher.functions";
import { setMyLanguage } from "@/lib/student.functions";
import { supabase } from "@/integrations/supabase/client";
import { LanguageSelect } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

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
  component: StudentShell,
});

const nav = [
  { to: "/student" as const, key: "dashboard", icon: Home },
  { to: "/student/questions" as const, key: "browse_questions", icon: FileQuestion },
  { to: "/student/vocabulary" as const, key: "vocabulary", icon: BookType },
  { to: "/student/readings" as const, key: "reading_library", icon: BookOpen },
  { to: "/student/listenings" as const, key: "listening_library", icon: Headphones },
  { to: "/student/catalogs" as const, key: "my_catalogs", icon: FolderOpen },
  { to: "/student/library" as const, key: "library", icon: BookMarked },
  { to: "/student/practice" as const, key: "self_practice", icon: Dumbbell },
  { to: "/student/exams" as const, key: "exams", icon: ClipboardList },
  { to: "/student/notifications" as const, key: "notifications", icon: Bell },
];

function StudentShell() {
  const { me } = Route.useRouteContext();
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/student" className="min-w-0 shrink-0">
            <div className="text-sm font-bold">FluentForge</div>
            <div className="max-w-40 truncate text-xs text-muted-foreground">
              {me.first_name} {me.last_name}
            </div>
          </Link>

          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/student" }}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{
                  className:
                    "flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-2 text-sm font-medium text-foreground",
                }}
              >
                <item.icon className="h-4 w-4" />
                <span>{t(item.key)}</span>
              </Link>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <LanguageSelect
              onChange={(language) =>
                setMyLanguage({ data: { language } }).catch(() => {})
              }
            />
            <button
              type="button"
              onClick={signOut}
              aria-label={t("sign_out")}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 md:hidden">
          <LanguageSelect
            onChange={(language) =>
              setMyLanguage({ data: { language } }).catch(() => {})
            }
          />
          <button
            type="button"
            onClick={signOut}
            aria-label={t("sign_out")}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
