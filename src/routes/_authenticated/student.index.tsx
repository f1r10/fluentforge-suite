import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { BarChart3, Bell, BookOpen, CheckCircle2, ChevronRight, ClipboardList, Clock3, Dumbbell, Flame, Heart, History, LogOut, Target, XCircle } from "lucide-react";
import { getMyDashboardSettings, heartbeat, listMyFavorites, setMyLanguage } from "@/lib/student.functions";
import { listStudentCatalogs } from "@/lib/practice.functions";
import { getMyPracticeProgress } from "@/lib/self-practice.functions";
import { listStudentExams } from "@/lib/exam-attempt.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, LanguageSelect } from "@/components/app/common";
import { useI18n, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/")({
  head: () => ({ meta: [{ title: "My learning" }, { name: "robots", content: "noindex" }] }),
  component: StudentHome,
});

function StudentHome() {
  const { me } = Route.useRouteContext();
  const { t, setLang, lang } = useI18n();
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
  const { data: exams = [] } = useQuery({
    queryKey: ["student-exams"],
    queryFn: () => listStudentExams(),
  });
  const { data: dashboardSettings } = useQuery({
    queryKey: ["student-dashboard-settings"],
    queryFn: () => getMyDashboardSettings(),
  });
  const { data: favorites = [] } = useQuery({
    queryKey: ["my-favorites"],
    queryFn: () => listMyFavorites(),
  });
  const visible = new Set(
    dashboardSettings?.widgets ?? [
      "catalogs",
      "exams",
      "practice",
      "today",
      "correctness",
      "accuracy",
      "study_time",
      "streak",
      "progress",
      "domain_progress",
      "weak_topics",
      "history",
      "favorites",
      "completed_exams",
    ],
  );
  const completedExams = exams.filter(
    (exam) => Number(exam.completed_attempts ?? 0) > 0,
  ).length;

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
          <Link
            to="/student/notifications"
            aria-label={t("notifications")}
            className="p-2 text-muted-foreground hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
          </Link>
          <button onClick={signOut} aria-label={t("sign_out")} className="p-2 text-muted-foreground">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {visible.has("catalogs") && (
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
      )}

      {visible.has("exams") && (
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-semibold">{t("exams")}</h2>
          <span className="text-xs text-muted-foreground">{exams.length}</span>
        </div>
        <Link
          to="/student/exams"
          className="flex items-center gap-3 rounded-md border border-border p-4 hover:bg-muted/40"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t("my_exams")}</div>
            <div className="text-xs text-muted-foreground">
              {exams.some((exam) => exam.availability === "available")
                ? t("exam_available_now")
                : t("student_exams_hint")}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </section>
      )}

      {visible.has("practice") && (
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
      )}

      {(visible.has("today") ||
        visible.has("correctness") ||
        visible.has("accuracy") ||
        visible.has("study_time") ||
        visible.has("streak") ||
        visible.has("progress") ||
        visible.has("domain_progress") ||
        visible.has("weak_topics") ||
        visible.has("history") ||
        visible.has("completed_exams")) && (
      <section>
        <h2 className="mb-3 border-b border-border pb-2 font-semibold">{t("your_progress")}</h2>
        {!progress ||
        (progress.stats.total_answers === 0 &&
          progress.stats.current_streak === 0 &&
          completedExams === 0) ? (
          <p className="py-6 text-sm text-muted-foreground">{t("progress_coming_from_activity")}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {visible.has("today") && (
                <ProgressCard
                  icon={<Target className="h-4 w-4" />}
                  label={t("today")}
                  value={progress.stats.today_answers}
                />
              )}
              {visible.has("correctness") && (
                <>
                  <ProgressCard
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    label={t("correct")}
                    value={progress.stats.correct_answers}
                  />
                  <ProgressCard
                    icon={<XCircle className="h-4 w-4" />}
                    label={t("incorrect")}
                    value={progress.stats.wrong_answers}
                  />
                </>
              )}
              {visible.has("completed_exams") && (
                <ProgressCard
                  icon={<ClipboardList className="h-4 w-4" />}
                  label={t("completed_exams")}
                  value={completedExams}
                />
              )}
              {visible.has("progress") && (
                <>
                  <ProgressCard
                    icon={<BarChart3 className="h-4 w-4" />}
                    label={t("week")}
                    value={progress.stats.week_answers}
                  />
                  <ProgressCard
                    icon={<BarChart3 className="h-4 w-4" />}
                    label={t("month")}
                    value={progress.stats.month_answers}
                  />
                </>
              )}
              {visible.has("accuracy") && (
                <ProgressCard
                  icon={<Target className="h-4 w-4" />}
                  label={t("accuracy")}
                  value={
                    progress.stats.accuracy == null
                      ? "—"
                      : `${Math.round(progress.stats.accuracy * 100)}%`
                  }
                />
              )}
              {visible.has("study_time") && (
                <ProgressCard
                  icon={<Clock3 className="h-4 w-4" />}
                  label={t("study_time")}
                  value={formatStudyTime(Number(progress.stats.total_time_ms))}
                />
              )}
              {visible.has("streak") && (
                <ProgressCard
                  icon={<Flame className="h-4 w-4" />}
                  label={`${t("streak")} · ${t("best")}: ${progress.stats.longest_streak}`}
                  value={progress.stats.current_streak}
                />
              )}
            </div>

            {visible.has("progress") &&
              progress.daily.some((day) => day.attempts > 0) && (
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

            {visible.has("domain_progress") &&
              progress.domains.some((row) => row.attempts > 0) && (
              <div className="rounded-md border border-border p-3">
                <div className="mb-3 text-sm font-medium">
                  {t("domain_progress")}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {progress.domains.map((row) => (
                    <div
                      key={row.domain}
                      className="rounded-md bg-muted/40 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">
                          {t(row.domain)}
                        </span>
                        <span className="text-sm font-semibold">
                          {row.accuracy == null
                            ? "—"
                            : `${Math.round(row.accuracy * 100)}%`}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.attempts} {t("attempts").toLocaleLowerCase()} ·{" "}
                        {row.correct} {t("correct").toLocaleLowerCase()} ·{" "}
                        {row.incorrect} {t("incorrect").toLocaleLowerCase()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {visible.has("weak_topics") && progress.topics.length > 0 && (
              <div className="rounded-md border border-border p-3">
                <div className="mb-2 text-sm font-medium">{t("weak_topics")}</div>
                <div className="space-y-2">
                  {[...progress.topics]
                    .sort((a, b) =>
                      Number(a.accuracy ?? 1) - Number(b.accuracy ?? 1),
                    )
                    .slice(0, 6)
                    .map((topic) => (
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

            {visible.has("history") && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" />
                {t("practice_history")}
              </div>
              {progress.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("no_practice_history")}</p>
              ) : (
                <div className="divide-y divide-border">
                  {progress.history.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {item.kind === "self" ? t("self_practice") : item.title || t("catalog_practice")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(item.at, lang)} · {item.answered} {t("answered").toLocaleLowerCase()}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        {item.accuracy == null ? "—" : `${Math.round(item.accuracy * 100)}%`}
                        {item.score != null && item.max_score != null && (
                          <div>{item.score} / {item.max_score}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </section>
      )}

      {visible.has("favorites") && (
        <section className="mt-8">
          <h2 className="mb-3 border-b border-border pb-2 font-semibold">
            {t("favorites")}
          </h2>
          {favorites.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("no_favorites")}
            </p>
          ) : (
            <div className="space-y-2">
              {favorites.slice(0, 8).map((item) => (
                <div
                  key={`${item.entity_type}:${item.entity_id}`}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <Heart className="mt-0.5 h-4 w-4 shrink-0 fill-current text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {item.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(item.entity_type)}{item.subtitle ? ` · ${item.subtitle}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}


function formatStudyTime(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
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
