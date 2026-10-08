import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, PlayCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listStudentExams, startOrResumeExam } from "@/lib/exam-attempt.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

export const Route = createFileRoute("/_authenticated/student/exams")({
  head: () => ({ meta: [{ title: "Exams" }, { name: "robots", content: "noindex" }] }),
  component: StudentExams,
});

function StudentExams() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["student-exams"],
    queryFn: () => listStudentExams(),
  });

  async function start(examId: string) {
    try {
      const result = await startOrResumeExam({ data: { examId } });
      navigate({ to: "/student/attempts/$attemptId", params: { attemptId: result.attemptId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await refetch();
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-5">
      <header className="mb-6">
        <Link to="/student" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold">{t("exams")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("student_exams_hint")}</p>
      </header>

      {isLoading ? (
        <p className="py-8 text-sm text-muted-foreground">…</p>
      ) : data.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          {t("no_assigned_exams")}
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((exam) => {
            const canStart =
              exam.availability === "available" &&
              (exam.active_attempt || exam.attempts_used < exam.max_attempts);
            const latest = exam.latest_attempt;

            return (
              <section key={exam.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{exam.title}</h2>
                      <span className="rounded bg-muted px-2 py-1 text-xs">{t(exam.availability)}</span>
                    </div>
                    {exam.description && <p className="mt-1 text-sm text-muted-foreground">{exam.description}</p>}
                  </div>

                  {canStart && (
                    <Button onClick={() => start(exam.id)}>
                      {exam.active_attempt ? <RotateCcw className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                      {exam.active_attempt ? t("resume_exam") : t("start_exam")}
                    </Button>
                  )}
                </div>

                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Info label={t("available_from")} value={formatDateTime(exam.available_from, lang)} />
                  <Info label={t("available_until")} value={formatDateTime(exam.available_until, lang)} />
                  <Info
                    label={t("duration_min")}
                    value={exam.duration_minutes == null ? "—" : `${exam.duration_minutes}`}
                    icon={<Clock3 className="h-3.5 w-3.5" />}
                  />
                  <Info label={t("attempts")} value={`${exam.attempts_used} / ${exam.max_attempts}`} />
                </div>

                {latest && latest.status !== "in_progress" && (
                  <div className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                    {t("latest_attempt")}: {t(latest.status)}
                    {latest.result_released && latest.max_score != null && (
                      <span> · {t("score")}: {latest.score ?? 0} / {latest.max_score}</span>
                    )}
                    {" · "}
                    <Link
                      to="/student/attempts/$attemptId"
                      params={{ attemptId: latest.id }}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {latest.result_released ? t("view_result") : t("view_status")}
                    </Link>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
