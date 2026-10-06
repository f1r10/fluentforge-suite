import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { BarChart3, BookOpen, ChevronRight, Dumbbell, LogOut, Target } from "lucide-react";
import { heartbeat, setMyLanguage } from "@/lib/student.functions";
import { listStudentCatalogs } from "@/lib/practice.functions";
import { getMyPracticeProgress } from "@/lib/self-practice.functions";
import { supabase } from "@/integrations/supabase/client";
import { LanguageSelect } from "@/components/app/common";
import { useI18n, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/")({
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
  const { data: progress } = useQuery({
    queryKey: ["practice-progress"],
    queryFn: () => getMyPracticeProgress(),
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

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-semibold">{t("self_practice")}</h2>
        </div>
        <Link
          to="/student/practice"
          className="flex items-center gap-3 rounded-md border border-border p-4 hover:bg-muted/40"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Dumbbell className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t("create_random_practice")}</div>
            <div className="text-xs text-muted-foreground">{t("self_practice_hint")}</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </section>

      <section>
        <h2 className="mb-3 border-b border-border pb-2 font-semibold">{t("your_progress")}</h2>
        {!progress || progress.stats.total_answers === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("progress_coming_from_activity")}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ProgressCard icon={<Target className="h-4 w-4" />} label={t("today")} value={progress.stats.today_answers} />
              <ProgressCard icon={<BarChart3 className="h-4 w-4" />} label={t("week")} value={progress.stats.week_answers} />
              <ProgressCard
                icon={<Target className="h-4 w-4" />}
                label={t("accuracy")}
                value={progress.stats.accuracy == null ? "—" : `${Math.round(progress.stats.accuracy * 100)}%`}
              />
              <ProgressCard
                icon={<Target className="h-4 w-4" />}
                label={t("current_mistakes")}
                value={progress.stats.current_mistakes}
              />
            </div>

            {progress.daily.some((day) => day.attempts > 0) && (
              <div className="rounded-md border border-border p-3">
                <div className="mb-3 text-sm font-medium">{t("last_14_days")}</div>
                <div className="flex h-24 items-end gap-1">
                  {progress.daily.map((day) => {
                    const max = Math.max(...progress.daily.map((row) => row.attempts), 1);
                    const height = Math.max(4, Math.round((day.attempts / max) * 88));
                    return (
                      <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${day.day}: ${day.attempts}`}>
                        <div className="w-full rounded-sm bg-primary/70" style={{ height }} />
                        <span className="hidden text-[9px] text-muted-foreground sm:block">
                          {new Date(day.day).getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {progress.topics.length > 0 && (
              <div className="rounded-md border border-border p-3">
                <div className="mb-2 text-sm font-medium">{t("topic_progress")}</div>
                <div className="space-y-2">
                  {progress.topics.slice(0, 6).map((topic) => (
                    <div key={topic.topic_id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                      <div className="min-w-0 truncate">{topic.topic_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {topic.accuracy == null ? "—" : `${Math.round(Number(topic.accuracy) * 100)}%`} · {topic.attempts}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}


function ProgressCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 text-muted-foreground">{icon}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
