import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BarChart3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getTeacherAnalytics } from "@/lib/analytics.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["teacher-analytics"],
    queryFn: () =>
      getTeacherAnalytics({
        data: {
          questionLimit: 300,
          catalogLimit: 300,
          studentLimit: 1000,
        },
      }),
  });

  const needle = search.trim().toLocaleLowerCase();
  const questions = useMemo(
    () =>
      (data?.questions ?? []).filter(
        (row) =>
          !needle ||
          row.prompt.toLocaleLowerCase().includes(needle) ||
          row.question_type.toLocaleLowerCase().includes(needle),
      ),
    [data?.questions, needle],
  );
  const catalogs = useMemo(
    () =>
      (data?.catalogs ?? []).filter(
        (row) =>
          !needle ||
          row.catalog_name.toLocaleLowerCase().includes(needle),
      ),
    [data?.catalogs, needle],
  );
  const students = useMemo(
    () =>
      (data?.students ?? []).filter(
        (row) =>
          !needle ||
          row.student_name.toLocaleLowerCase().includes(needle) ||
          row.username.toLocaleLowerCase().includes(needle),
      ),
    [data?.students, needle],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BarChart3 className="h-5 w-5" />
          {t("analytics")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("analytics_hint")}
        </p>
      </div>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("search")}
        />
      </div>

      {isLoading || !data ? (
        <div className="py-10 text-sm text-muted-foreground">…</div>
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">
                {t("question_analytics")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("question_analytics_hint")}
              </p>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("question")}</th>
                    <th className="px-3 py-2 font-medium">{t("attempts")}</th>
                    <th className="px-3 py-2 font-medium">{t("accuracy")}</th>
                    <th className="px-3 py-2 font-medium">{t("skip_rate")}</th>
                    <th className="px-3 py-2 font-medium">{t("avg_time")}</th>
                    <th className="px-3 py-2 font-medium">{t("suggestion")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {questions.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        {t("no_results")}
                      </td>
                    </tr>
                  )}
                  {questions.map((row) => (
                    <tr key={row.question_id}>
                      <td className="max-w-xl px-3 py-2">
                        <div className="truncate font-medium">{row.prompt}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.question_type} · {row.correct} {t("correct").toLocaleLowerCase()} ·{" "}
                          {row.incorrect} {t("incorrect").toLocaleLowerCase()} ·{" "}
                          {row.manual} {t("needs_review").toLocaleLowerCase()}
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.attempts}</td>
                      <td className="px-3 py-2">
                        {percent(row.accuracy)}
                      </td>
                      <td className="px-3 py-2">
                        {percent(row.skip_rate)}
                        {row.skips > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {row.skips} {t("skipped").toLocaleLowerCase()}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.avg_time_ms == null
                          ? "—"
                          : formatDuration(row.avg_time_ms)}
                      </td>
                      <td className="px-3 py-2">
                        {row.difficulty_suggestion
                          ? t(row.difficulty_suggestion)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">
                {t("catalog_analytics")}
              </h2>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("catalog")}</th>
                    <th className="px-3 py-2 font-medium">{t("sessions")}</th>
                    <th className="px-3 py-2 font-medium">{t("answered")}</th>
                    <th className="px-3 py-2 font-medium">{t("accuracy")}</th>
                    <th className="px-3 py-2 font-medium">{t("last_activity")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {catalogs.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        {t("no_results")}
                      </td>
                    </tr>
                  )}
                  {catalogs.map((row) => (
                    <tr key={row.catalog_id}>
                      <td className="px-3 py-2 font-medium">
                        {row.catalog_name}
                      </td>
                      <td className="px-3 py-2">{row.sessions}</td>
                      <td className="px-3 py-2">{row.total_answered}</td>
                      <td className="px-3 py-2">
                        {percent(row.avg_accuracy)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(row.last_activity, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">
                {t("student_analytics")}
              </h2>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("student")}</th>
                    <th className="px-3 py-2 font-medium">
                      {t("practice_answers")}
                    </th>
                    <th className="px-3 py-2 font-medium">{t("accuracy")}</th>
                    <th className="px-3 py-2 font-medium">{t("study_time")}</th>
                    <th className="px-3 py-2 font-medium">{t("exam_attempts")}</th>
                    <th className="px-3 py-2 font-medium">
                      {t("exam_accuracy")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("last_activity")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {students.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        {t("no_results")}
                      </td>
                    </tr>
                  )}
                  {students.map((row) => (
                    <tr key={row.student_id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.student_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.username} · {t(row.status)}
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.practice_answers}</td>
                      <td className="px-3 py-2">
                        {percent(row.practice_accuracy)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDuration(row.study_time_ms)}
                      </td>
                      <td className="px-3 py-2">{row.exam_attempts}</td>
                      <td className="px-3 py-2">
                        {row.exam_accuracy_percent == null
                          ? "—"
                          : `${Math.round(row.exam_accuracy_percent)}%`}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(row.last_activity, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function percent(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
