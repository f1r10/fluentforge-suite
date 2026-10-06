import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { BookOpen, ChevronRight, LogOut } from "lucide-react";
import { getWhoAmI } from "@/lib/teacher.functions";
import { heartbeat, setMyLanguage } from "@/lib/student.functions";
import { listStudentCatalogs } from "@/lib/practice.functions";
import { supabase } from "@/integrations/supabase/client";
import { LanguageSelect } from "@/components/app/common";
import { useI18n, type Lang } from "@/lib/i18n";

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
  head: () => ({ meta: [{ title: "My learning" }, { name: "robots", content: "noindex" }] }),
  component: StudentHome,
});

function StudentHome() {
  const { me } = Route.useRouteContext();
  const { t, setLang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: catalogs = [], isLoading } = useQuery({
    queryKey: ["student-catalogs"],
    queryFn: () => listStudentCatalogs(),
  });

  useEffect(() => {
    if (me.interface_language) setLang(me.interface_language as Lang);
    const beat = () => heartbeat({ data: { location: "Home" } }).catch(() => {});
    beat();
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-5">
      <header className="mb-8 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{t("welcome")}</p>
          <h1 className="text-xl font-bold">
            {me.first_name} {me.last_name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect onChange={(l) => setMyLanguage({ data: { language: l } }).catch(() => {})} />
          <button onClick={signOut} aria-label={t("sign_out")} className="p-2 text-muted-foreground">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-semibold">{t("my_catalogs")}</h2>
          <span className="text-xs text-muted-foreground">{catalogs.length}</span>
        </div>

        {isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">…</p>
        ) : catalogs.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("nothing_yet")}</p>
        ) : (
          <div className="space-y-2">
            {catalogs.map((catalog) => (
              <Link
                key={catalog.id}
                to="/student/catalogs/$id"
                params={{ id: catalog.id }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{catalog.name}</div>
                  {catalog.description && (
                    <div className="truncate text-xs text-muted-foreground">{catalog.description}</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {catalog.items} {t("items").toLocaleLowerCase()}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 border-b border-border pb-2 font-semibold">{t("your_progress")}</h2>
        <p className="py-6 text-sm text-muted-foreground">{t("progress_coming_from_activity")}</p>
      </section>
    </div>
  );
}
