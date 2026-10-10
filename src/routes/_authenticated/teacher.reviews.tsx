import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Eye, MessageSquareWarning, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  generateAiReviewSuggestion,
  getAiReviewStatus,
  listManualReviews,
  listQuestionReports,
  listReleaseQueue,
  listReviewExams,
  releaseAttemptResult,
  resolveQuestionReport,
  reviewManualAnswer,
} from "@/lib/review.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/reviews")({
  component: ReviewsPage,
});

type ReviewRow = Awaited<ReturnType<typeof listManualReviews>>["rows"][number];

function ReviewsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "reviewed" | "all">("pending");
  const [search, setSearch] = useState("");
  const [examId, setExamId] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [reportStatus, setReportStatus] = useState<
    "open" | "resolved" | "all"
  >("open");

  const { data, isFetching } = useQuery({
    queryKey: ["manual-reviews", status, search, examId, page],
    queryFn: () =>
      listManualReviews({
        data: {
          status,
          search,
          examId: examId || null,
          page,
        },
      }),
  });

  const { data: exams = [] } = useQuery({
    queryKey: ["review-exams"],
    queryFn: () => listReviewExams(),
  });

  const { data: releaseQueue = [] } = useQuery({
    queryKey: ["release-queue"],
    queryFn: () => listReleaseQueue(),
  });

  const { data: reportData } = useQuery({
    queryKey: ["question-reports", reportStatus],
    queryFn: () =>
      listQuestionReports({
        data: { status: reportStatus, page: 0 },
      }),
  });
  const questionReports = reportData?.rows ?? [];

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["manual-reviews"] }),
      qc.invalidateQueries({ queryKey: ["release-queue"] }),
      qc.invalidateQueries({ queryKey: ["question-reports"] }),
      qc.invalidateQueries({ queryKey: ["teacher-notifications"] }),
      qc.invalidateQueries({ queryKey: ["exams-detailed"] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("student_questions_box")}</h1>
        <p className="text-sm text-muted-foreground">{t("review_box_hint")}</p>
      </div>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageSquareWarning className="h-4 w-4" />
              {t("reported_questions")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("reported_questions_hint")}
            </p>
          </div>
          <select
            value={reportStatus}
            onChange={(event) =>
              setReportStatus(event.target.value as typeof reportStatus)
            }
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="open">{t("pending")}</option>
            <option value="resolved">{t("resolved")}</option>
            <option value="all">{t("all")}</option>
          </select>
        </div>

        {questionReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("no_question_reports")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("student")}</th>
                  <th className="px-3 py-2 font-medium">{t("question")}</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">
                    {t("report_comment")}
                  </th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">
                    {t("reported_at")}
                  </th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {questionReports.map((report) => (
                  <tr key={report.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{report.student.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {report.student.username}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-lg truncate">
                        {report.question.prompt}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {report.question.question_type}
                      </div>
                    </td>
                    <td className="hidden max-w-md px-3 py-2 text-muted-foreground md:table-cell">
                      {report.comment || "—"}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">
                      {formatDateTime(report.created_at, lang)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        variant={report.resolved_at ? "outline" : "default"}
                        onClick={async () => {
                          try {
                            await resolveQuestionReport({
                              data: {
                                id: report.id,
                                resolved: !report.resolved_at,
                              },
                            });
                            toast.success(
                              report.resolved_at
                                ? t("question_report_reopened")
                                : t("question_report_resolved"),
                            );
                            await refresh();
                          } catch (error) {
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            );
                          }
                        }}
                      >
                        {report.resolved_at ? t("reopen") : t("resolve")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div>
          <h2 className="font-semibold">{t("results_waiting_approval")}</h2>
          <p className="text-sm text-muted-foreground">{t("approval_queue_hint")}</p>
        </div>
        {releaseQueue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_results_waiting_approval")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("student")}</th>
                  <th className="px-3 py-2 font-medium">{t("exam")}</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("submitted_at")}</th>
                  <th className="px-3 py-2 font-medium">{t("score")}</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">{t("pending_reviews")}</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {releaseQueue.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{attempt.student.name}</div>
                      <div className="text-xs text-muted-foreground">{attempt.student.username}</div>
                    </td>
                    <td className="px-3 py-2">{attempt.exam.title}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                      {formatDateTime(attempt.submitted_at, lang)}
                    </td>
                    <td className="px-3 py-2">
                      {attempt.score ?? 0} / {attempt.max_score ?? 0}
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">{attempt.pending_reviews}</td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        disabled={attempt.pending_reviews > 0}
                        onClick={async () => {
                          try {
                            await releaseAttemptResult({ data: { attemptId: attempt.id } });
                            toast.success(t("result_released"));
                            await refresh();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {t("release_result")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-2 md:grid-cols-[1fr_180px_240px]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("search")}
          />
        </div>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
        >
          <option value="pending">{t("pending")}</option>
          <option value="reviewed">{t("reviewed")}</option>
          <option value="all">{t("all")}</option>
        </select>

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
            <option key={exam.id} value={exam.id}>{exam.title}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("student")}</th>
              <th className="px-3 py-2 font-medium">{t("exam")}</th>
              <th className="px-3 py-2 font-medium">{t("question")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("response")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("status")}</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
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
                  <div className="max-w-md truncate">{row.question.prompt}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.question.type} · v{row.question.version ?? "?"} · {row.question.max_score} {t("points").toLocaleLowerCase()}
                  </div>
                </td>
                <td className="hidden max-w-sm truncate px-3 py-2 md:table-cell">{row.answer.response_text}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{t(row.status)}</td>
                <td className="px-2 py-1">
                  <Button variant="ghost" size="icon" onClick={() => setSelected(row)} aria-label={t("review")}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page + 1} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>→</Button>
        </div>
      </div>

      {selected && (
        <ReviewDialog
          review={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            setSelected(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

type AiSuggestionView = {
  score: number;
  max_score: number;
  confidence: number;
  reason: string;
  feedback: string;
  provider: "local" | "gemini";
  model: string;
  generated_at: string;
};

function parseAiSuggestion(value: unknown): AiSuggestionView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row["score"] !== "number" ||
    typeof row["max_score"] !== "number" ||
    typeof row["confidence"] !== "number" ||
    typeof row["reason"] !== "string" ||
    (row["provider"] !== "local" && row["provider"] !== "gemini") ||
    typeof row["model"] !== "string"
  ) {
    return null;
  }

  return {
    score: row["score"],
    max_score: row["max_score"],
    confidence: row["confidence"],
    reason: row["reason"],
    feedback: typeof row["feedback"] === "string" ? row["feedback"] : "",
    provider: row["provider"],
    model: row["model"],
    generated_at:
      typeof row["generated_at"] === "string" ? row["generated_at"] : "",
  };
}

function ReviewDialog({
  review,
  onClose,
  onChanged,
}: {
  review: ReviewRow;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [score, setScore] = useState(review.final_score == null ? "" : String(review.final_score));
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(() =>
    parseAiSuggestion(review.ai_suggestion),
  );

  const { data: aiStatus } = useQuery({
    queryKey: ["ai-review-status"],
    queryFn: () => getAiReviewStatus(),
    staleTime: 60_000,
  });

  async function generateSuggestion() {
    setAiBusy(true);
    try {
      const suggestion = await generateAiReviewSuggestion({
        data: { reviewId: review.id },
      });
      setAiSuggestion(suggestion);
      toast.success(t("ai_suggestion_ready"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  function useSuggestion() {
    if (!aiSuggestion) return;
    setScore(String(aiSuggestion.score));
    if (aiSuggestion.feedback && !feedback.trim()) {
      setFeedback(aiSuggestion.feedback);
    }
  }

  async function save() {
    const numeric = Number(score);
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error(t("invalid_score"));
      return;
    }

    setBusy(true);
    try {
      const result = await reviewManualAnswer({
        data: {
          reviewId: review.id,
          score: numeric,
          feedback,
        },
      });
      toast.success(t("review_saved"));

      if (result.attempt.pending === 0 && !result.attempt.result_released) {
        const release = confirm(t("release_result_now_confirm"));
        if (release) {
          await releaseAttemptResult({ data: { attemptId: review.attempt.id } });
          toast.success(t("result_released"));
        }
      }

      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setReleasing(true);
    try {
      await releaseAttemptResult({ data: { attemptId: review.attempt.id } });
      toast.success(t("result_released"));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("review_answer")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">{t("student")}:</span> {review.student.name}</div>
            <div><span className="text-muted-foreground">{t("exam")}:</span> {review.exam.title}</div>
          </div>

          <section>
            <div className="text-xs text-muted-foreground">{review.question.type} · v{review.question.version ?? "?"}</div>
            <h3 className="mt-1 font-semibold">{review.question.prompt}</h3>
            {review.question.instructions && <p className="mt-1 text-sm text-muted-foreground">{review.question.instructions}</p>}
          </section>

          <section className="rounded-md border border-border p-4">
            <Label>{t("student_response")}</Label>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6">{review.answer.response_text}</div>
          </section>

          {review.question.answer_key_text !== "—" && (
            <section className="rounded-md border border-border p-4">
              <Label>{t("reference_answer")}</Label>
              <div className="mt-2 whitespace-pre-wrap text-sm">{review.question.answer_key_text}</div>
            </section>
          )}

          {review.question.explanation && (
            <section className="rounded-md bg-muted/40 p-4 text-sm">
              <strong>{t("explanation")}:</strong> {review.question.explanation}
            </section>
          )}

          <section className="space-y-3 rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <Sparkles className="h-4 w-4" />
                  {t("ai_grading_suggestion")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("ai_suggestion_human_decision")}
                </p>
              </div>
              {review.status === "pending" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!aiStatus?.available || aiBusy}
                  onClick={generateSuggestion}
                >
                  <Sparkles className="h-4 w-4" />
                  {aiBusy
                    ? t("ai_generating")
                    : aiSuggestion
                      ? t("regenerate_ai_suggestion")
                      : t("generate_ai_suggestion")}
                </Button>
              )}
            </div>

            {aiStatus && !aiStatus.available && (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {t("ai_provider_unavailable")}
                {aiStatus.message ? ` — ${aiStatus.message}` : ""}
              </div>
            )}

            {aiStatus?.available && (
              <div className="text-xs text-muted-foreground">
                {t("ai_provider")}: {aiStatus.provider} · {aiStatus.model ?? "—"}
                {aiStatus.isExternal && (
                  <span> · {t("external_ai_privacy_note")}</span>
                )}
              </div>
            )}

            {aiSuggestion && (
              <div className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("suggested_score")}</div>
                    <div className="font-semibold">
                      {aiSuggestion.score} / {aiSuggestion.max_score}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("confidence")}</div>
                    <div className="font-semibold">
                      {Math.round(aiSuggestion.confidence * 100)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("ai_provider")}</div>
                    <div className="truncate font-semibold">
                      {aiSuggestion.provider} · {aiSuggestion.model}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground">{t("reason")}</div>
                  <div className="mt-1 whitespace-pre-wrap">{aiSuggestion.reason}</div>
                </div>

                {aiSuggestion.feedback && (
                  <div>
                    <div className="text-xs text-muted-foreground">{t("suggested_feedback")}</div>
                    <div className="mt-1 whitespace-pre-wrap">{aiSuggestion.feedback}</div>
                  </div>
                )}

                {review.status === "pending" && (
                  <Button type="button" size="sm" onClick={useSuggestion}>
                    {t("use_suggested_score")}
                  </Button>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("score")} / {review.question.max_score}</Label>
              <Input
                type="number"
                min={0}
                max={review.question.max_score}
                step="0.01"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                disabled={review.status === "reviewed"}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("teacher_feedback")}</Label>
              <Textarea
                rows={4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={review.status === "reviewed"}
              />
            </div>
          </div>

          <div className="rounded-md border border-border p-3 text-sm">
            <div>{t("attempt_score")}: {review.attempt.score ?? "—"} / {review.attempt.max_score ?? "—"}</div>
            <div>{t("result_released")}: {review.attempt.result_released ? t("yes") : t("no")}</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("close")}</Button>
          {review.status === "pending" ? (
            <Button onClick={save} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" />
              {t("save_review")}
            </Button>
          ) : !review.attempt.result_released ? (
            <Button onClick={release} disabled={releasing}>{t("release_result")}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
