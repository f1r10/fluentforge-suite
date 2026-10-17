import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Activity, AlertTriangle, Eye, Flag, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getReviewAttemptSummary,
  listExamAttemptsMonitoring,
  listReviewExams,
  resetExamAttempt,
} from "@/lib/review.functions";
import { formatDateTime } from "@/components/app/common";
import { listLiveStudentSessions } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/monitoring")({
  component: MonitoringPage,
});

type AttemptRow = Awaited<ReturnType<typeof listExamAttemptsMonitoring>>["rows"][number];
type AttemptSummary = Awaited<ReturnType<typeof getReviewAttemptSummary>>;

function MonitoringPage() {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const [examId, setExamId] = useState("");
  const [status, setStatus] = useState<
    "all" | "in_progress" | "submitted" | "auto_submitted" | "graded" | "abandoned"
  >("all");
  const [violationsOnly, setViolationsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AttemptRow | null>(null);

  const { data: exams = [] } = useQuery({
    queryKey: ["review-exams"],
    queryFn: () => listReviewExams(),
  });

  const { data: liveSessions, isFetching: liveFetching } = useQuery({
    queryKey: ["live-student-sessions", search],
    queryFn: () =>
      listLiveStudentSessions({
        data: {
          search,
          onlineMinutes: 5,
        },
      }),
    refetchInterval: 30_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["exam-monitoring", search, examId, status, violationsOnly, page],
    queryFn: () =>
      listExamAttemptsMonitoring({
        data: {
          search,
          examId: examId || null,
          status,
          violationsOnly,
          page,
        },
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("exam_monitoring")}</h1>
        <p className="text-sm text-muted-foreground">{t("exam_monitoring_hint")}</p>
      </div>

      <section className="space-y-3 rounded-md border border-border">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="font-semibold">
              {t("live_sessions")} ({liveSessions?.rows.length ?? 0})
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("live_sessions_hint")}
            </p>
          </div>
          {liveFetching && (
            <span className="text-xs text-muted-foreground">…</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("student")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("current_page")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("session_duration")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("last_seen")}
                </th>
                {liveSessions?.privacy.show_browser_device && (
                  <th className="px-3 py-2 font-medium">
                    {t("browser_device")}
                  </th>
                )}
                {liveSessions?.privacy.show_ip && (
                  <th className="px-3 py-2 font-medium">IP</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(liveSessions?.rows ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      4 +
                      (liveSessions?.privacy.show_browser_device ? 1 : 0) +
                      (liveSessions?.privacy.show_ip ? 1 : 0)
                    }
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    {liveFetching ? "…" : t("no_live_sessions")}
                  </td>
                </tr>
              ) : (
                liveSessions!.rows.map((session) => (
                  <tr key={session.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {session.student_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {session.username}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {session.current_location || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDuration(session.session_duration_ms)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(session.last_seen_at, lang)}
                    </td>
                    {liveSessions?.privacy.show_browser_device && (
                      <td className="px-3 py-2 text-muted-foreground">
                        {[
                          session.browser,
                          session.operating_system,
                          session.device,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                    )}
                    {liveSessions?.privacy.show_ip && (
                      <td className="px-3 py-2 font-mono text-xs">
                        {session.ip || "—"}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-2 md:grid-cols-[1fr_220px_180px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("search_student")}
          />
        </div>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("exams")}</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.title}
            </option>
          ))}
        </select>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
        >
          <option value="all">{t("all")} — {t("status")}</option>
          <option value="in_progress">{t("in_progress")}</option>
          <option value="submitted">{t("submitted")}</option>
          <option value="auto_submitted">{t("auto_submitted")}</option>
          <option value="graded">{t("graded")}</option>
          <option value="abandoned">{t("abandoned")}</option>
        </select>

        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <Checkbox
            checked={violationsOnly}
            onCheckedChange={(checked) => {
              setViolationsOnly(!!checked);
              setPage(0);
            }}
          />
          {t("violations_only")}
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("student")}</th>
              <th className="px-3 py-2 font-medium">{t("exam")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("attempt")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("started_at")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("deadline")}</th>
              <th className="px-3 py-2 font-medium">{t("score")}</th>
              <th className="px-3 py-2 font-medium">{t("violations")}</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  {isFetching ? "…" : t("no_results")}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="font-medium">{row.student.name}</div>
                  <div className="text-xs text-muted-foreground">{row.student.username}</div>
                </td>
                <td className="px-3 py-2">{row.exam.title}</td>
                <td className="px-3 py-2">
                  {row.reset_at ? t("attempt_reset") : t(row.status)}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">#{row.attempt_number}</td>
                <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                  {formatDateTime(row.started_at, lang)}
                </td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                  {formatDateTime(row.deadline_at, lang)}
                </td>
                <td className="px-3 py-2">
                  {row.score == null || row.max_score == null ? "—" : `${row.score} / ${row.max_score}`}
                </td>
                <td className="px-3 py-2">
                  {row.violation_count > 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {row.violation_count}
                    </span>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="px-2 py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelected(row)}
                    aria-label={t("view_attempt")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {page + 1} / {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            →
          </Button>
        </div>
      </div>

      {selected && (
        <AttemptDialog
          attempt={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function AttemptDialog({
  attempt,
  onClose,
}: {
  attempt: AttemptRow;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["exam-attempt-monitoring-detail", attempt.id],
    queryFn: () => getReviewAttemptSummary({ data: { attemptId: attempt.id } }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle>
              {attempt.student.name} — {attempt.exam.title}
            </DialogTitle>
            {attempt.reset_at ? (
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {t("attempt_reset")} · {formatDateTime(attempt.reset_at, lang)}
              </span>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={resetting}
                onClick={async () => {
                  if (!confirm(t("reset_attempt_confirm"))) return;
                  const reason =
                    window.prompt(t("reset_attempt_reason_prompt"), "") ?? "";
                  setResetting(true);
                  try {
                    await resetExamAttempt({
                      data: {
                        attemptId: attempt.id,
                        reason,
                      },
                    });
                    await Promise.all([
                      qc.invalidateQueries({ queryKey: ["exam-monitoring"] }),
                      qc.invalidateQueries({ queryKey: ["manual-reviews"] }),
                      qc.invalidateQueries({ queryKey: ["release-queue"] }),
                      qc.invalidateQueries({ queryKey: ["teacher-analytics"] }),
                    ]);
                    toast.success(t("attempt_reset_success"));
                    onClose();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : String(error),
                    );
                  } finally {
                    setResetting(false);
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" />
                {t("reset_attempt")}
              </Button>
            )}
          </div>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-8 text-sm text-muted-foreground">…</div>
        ) : (
          <AttemptDetail data={data} lang={lang} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttemptDetail({ data, lang }: { data: AttemptSummary; lang: string }) {
  const { t } = useI18n();
  const violations = Array.isArray(data.violations)
    ? (data.violations as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label={t("status")} value={t(data.status)} />
        <Metric
          label={t("score")}
          value={data.score == null || data.max_score == null ? "—" : `${data.score} / ${data.max_score}`}
        />
        <Metric label={t("answers_saved")} value={data.metrics.answers_saved} />
        <Metric label={t("correct")} value={data.metrics.correct} />
        <Metric label={t("flagged")} value={data.metrics.flagged} />
        <Metric label={t("answer_changes")} value={data.metrics.answer_changes} />
      </div>

      <div className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info label={t("started_at")} value={formatDateTime(data.started_at, lang)} />
        <Info label={t("deadline")} value={formatDateTime(data.deadline_at, lang)} />
        <Info label={t("submitted_at")} value={formatDateTime(data.submitted_at, lang)} />
        <Info
          label={t("time_spent")}
          value={formatDuration(data.metrics.time_spent_ms)}
        />
        <Info label={t("pending_reviews")} value={String(data.pending_reviews)} />
        <Info label={t("result_released")} value={data.result_released ? t("yes") : t("no")} />
        <Info
          label={t("passed")}
          value={data.passed == null ? "—" : data.passed ? t("yes") : t("no")}
        />
        <Info label={t("violations")} value={String(violations.length)} />
      </div>

      <section>
        <h3 className="mb-2 font-semibold">{t("listening_play_history")}</h3>
        {data.listening_plays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("no_listening_plays")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("listening")}</th>
                  <th className="px-3 py-2 font-medium">{t("play_session")}</th>
                  <th className="px-3 py-2 font-medium">{t("started_at")}</th>
                  <th className="px-3 py-2 font-medium">{t("completed_at")}</th>
                  <th className="px-3 py-2 font-medium">{t("lease_expires")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.listening_plays.map((play) => (
                  <tr key={play.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {play.listening_id}
                    </td>
                    <td className="px-3 py-2">#{play.play_number}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(play.started_at, lang)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(play.completed_at, lang)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(play.expires_at, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">{t("assessment_log")}</h3>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_activity")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("time")}</th>
                  <th className="px-3 py-2 font-medium">{t("event")}</th>
                  <th className="px-3 py-2 font-medium">{t("details")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.timeline.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(event.created_at, lang)}
                    </td>
                    <td className="px-3 py-2">{formatEvent(event.event_type, t)}</td>
                    <td className="max-w-xl px-3 py-2 text-xs text-muted-foreground">
                      {formatDetails(event.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">{t("violations")}</h3>
        {violations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_violations")}</p>
        ) : (
          <div className="space-y-2">
            {violations.map((violation, index) => (
              <div
                key={index}
                className="flex items-start gap-3 rounded-md border border-border p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <div className="font-medium">
                    {formatViolationType(String(violation["type"] ?? "unknown"), t)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {typeof violation["recorded_at"] === "string"
                      ? formatDateTime(violation["recorded_at"], lang)
                      : "—"}
                  </div>
                  {violation["details"] &&
                    typeof violation["details"] === "object" &&
                    Object.keys(violation["details"] as Record<string, unknown>).length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDetails(violation["details"])}
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">{t("answer_metrics")}</h3>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t("status")}</th>
                <th className="px-3 py-2 font-medium">{t("score")}</th>
                <th className="px-3 py-2 font-medium">{t("changes")}</th>
                <th className="px-3 py-2 font-medium">{t("time_spent")}</th>
                <th className="px-3 py-2 font-medium">{t("flagged")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.answers.map((answer, index) => (
                <tr key={answer.id}>
                  <td className="px-3 py-2">{index + 1}</td>
                  <td className="px-3 py-2">
                    {answer.is_correct == null
                      ? t("needs_review")
                      : answer.is_correct
                        ? t("correct")
                        : t("incorrect")}
                  </td>
                  <td className="px-3 py-2">{answer.score ?? "—"}</td>
                  <td className="px-3 py-2">{answer.change_count}</td>
                  <td className="px-3 py-2">{formatDuration(answer.time_spent_ms)}</td>
                  <td className="px-3 py-2">
                    {answer.flagged ? <Flag className="h-4 w-4 text-destructive" /> : "—"}
                  </td>
                </tr>
              ))}
              {data.answers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    {t("no_results")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
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

function formatDetails(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .slice(0, 8);
  if (!entries.length) return "—";
  return entries
    .map(([key, entry]) => `${key}: ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`)
    .join(" · ");
}

function formatEvent(type: string, t: (key: string) => string) {
  const keys: Record<string, string> = {
    exam_started: "exam_started",
    exam_submitted: "exam_submitted",
    exam_auto_submitted: "exam_auto_submitted",
    exam_violation: "exam_violation",
    listening_play_started: "listening_play_started",
    listening_play_completed: "listening_play_completed",
  };
  return t(keys[type] ?? type);
}

function formatViolationType(type: string, t: (key: string) => string) {
  const keys: Record<string, string> = {
    tab_hidden: "tab_hidden",
    copy: "copy_event",
    paste: "paste_event",
    cut: "cut_event",
    fullscreen_exit: "fullscreen_exit",
  };
  return t(keys[type] ?? type);
}
