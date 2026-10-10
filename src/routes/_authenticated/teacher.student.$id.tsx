import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  LogIn,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTeacherStudentActivity } from "@/lib/student-insights.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/student/$id")({
  component: StudentActivityPage,
});

type Detail = Awaited<ReturnType<typeof getTeacherStudentActivity>>;
type AnswerRow = Detail["answers"][number];

function StudentActivityPage() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const [answerFilter, setAnswerFilter] = useState<
    "all" | "wrong" | "correct"
  >("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["teacher-student-activity", id],
    queryFn: () => getTeacherStudentActivity({ data: { studentId: id } }),
  });

  const answers = useMemo(() => {
    if (!data) return [];
    if (answerFilter === "wrong") {
      return data.answers.filter((row) => row.isCorrect === false);
    }
    if (answerFilter === "correct") {
      return data.answers.filter((row) => row.isCorrect === true);
    }
    return data.answers;
  }, [data, answerFilter]);

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-8 text-sm text-destructive">
        {error instanceof Error ? error.message : t("no_results")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link
          to="/teacher/students"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("students")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {data.student.firstName} {data.student.lastName}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              @{data.student.username}
              {data.student.groups.length
                ? ` · ${data.student.groups.map((group) => group.name).join(", ")}`
                : ""}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {t("last_active")}:{" "}
            {data.student.lastActiveAt
              ? formatDateTime(data.student.lastActiveAt, lang)
              : t("never")}
          </div>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-5">
        <Metric label={t("answers")} value={data.summary.answers} />
        <Metric label={t("correct")} value={data.summary.correct} />
        <Metric label={t("wrong_answers")} value={data.summary.wrong} />
        <Metric
          label={t("accuracy")}
          value={
            data.summary.accuracy == null
              ? "—"
              : `${Math.round(data.summary.accuracy * 100)}%`
          }
        />
        <Metric label={t("exams")} value={data.summary.exams} />
      </section>

      <section className="rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-semibold">{t("answer_history")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("student_activity_answers_hint")}
            </p>
          </div>
          <div className="flex gap-2">
            {(["all", "wrong", "correct"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={answerFilter === value ? "default" : "outline"}
                onClick={() => setAnswerFilter(value)}
              >
                {value === "wrong"
                  ? t("wrong_answers")
                  : value === "correct"
                    ? t("correct")
                    : t("all")}
              </Button>
            ))}
          </div>
        </div>
        {answers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("no_results")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {answers.map((row) => (
              <AnswerCard key={`${row.kind}:${row.id}`} row={row} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-md border border-border">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">{t("exam_attempts")}</h2>
          </div>
          {data.attempts.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("no_results")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.attempts.map((attempt) => (
                <div key={attempt.id} className="p-4">
                  <div className="font-medium">{attempt.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    #{attempt.attemptNumber} · {formatDateTime(attempt.startedAt, lang)}
                  </div>
                  <div className="mt-2 text-sm">
                    {attempt.score != null && attempt.maxScore != null
                      ? `${t("score")}: ${round(attempt.score)} / ${round(
                          attempt.maxScore,
                        )}`
                      : t(attempt.status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">{t("login_activity")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("login_activity_hint")}
            </p>
          </div>
          {data.sessions.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("no_results")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.sessions.map((session) => (
                <div key={session.id} className="flex gap-3 p-4">
                  <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {formatDateTime(session.startedAt, lang)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("last_seen")}: {formatDateTime(session.lastSeenAt, lang)}
                      {session.location
                        ? ` · ${friendlyLocation(session.location, t)}`
                        : ""}
                      {session.endedAt ? ` · ${t("session_ended")}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-md border border-border">
        <div className="border-b border-border p-4">
          <h2 className="font-semibold">{t("recent_activity")}</h2>
        </div>
        {data.activity.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t("no_results")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.activity.slice(0, 100).map((event) => (
              <div key={event.id} className="flex items-start gap-3 p-3 text-sm">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div>{friendlyEvent(event.type, t)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(event.at, lang)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AnswerCard({ row }: { row: AnswerRow }) {
  const { t, lang } = useI18n();
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};
  return (
    <article className="p-4">
      <div className="flex items-start gap-3">
        {row.isCorrect === true ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        ) : row.isCorrect === false ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        ) : (
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{row.prompt}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {sourceLabel(row.source, t)} · {formatDateTime(row.at, lang)}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <AnswerBox
              label={t("student_answer")}
              value={formatResponse(row.studentResponse, payload)}
            />
            <AnswerBox
              label={t("correct_answer")}
              value={formatCorrectAnswer(row.correctAnswer, payload)}
            />
          </div>
          {row.explanation && (
            <div className="mt-3 text-sm text-muted-foreground">
              {row.explanation}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function AnswerBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm">{value || "—"}</div>
    </div>
  );
}

function optionText(id: string, payload: Record<string, unknown>) {
  const options = Array.isArray(payload["options"])
    ? (payload["options"] as Array<Record<string, unknown>>)
    : [];
  const option = options.find((row) => String(row["id"]) === id);
  return option ? String(option["text"] ?? id) : id;
}

function formatResponse(value: unknown, payload: Record<string, unknown>) {
  const row = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  if (Array.isArray(row["selected"])) {
    return (row["selected"] as unknown[])
      .map((id) => optionText(String(id), payload))
      .join(", ");
  }
  if (Array.isArray(row["answers"])) {
    return (row["answers"] as unknown[]).map(String).join(" · ");
  }
  if (typeof row["text"] === "string") return row["text"];
  if (typeof row["value"] === "string") return row["value"];
  if (Array.isArray(row["order"])) return (row["order"] as unknown[]).map(String).join(" → ");
  if (Array.isArray(row["pairs"])) {
    return (row["pairs"] as Array<Record<string, unknown>>)
      .map((pair) => `${String(pair["left"] ?? "")} → ${String(pair["right"] ?? "")}`)
      .join("\n");
  }
  return "";
}

function formatCorrectAnswer(value: unknown, payload: Record<string, unknown>) {
  const row = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  if (Array.isArray(row["correct"])) {
    return (row["correct"] as unknown[])
      .map((id) => optionText(String(id), payload))
      .join(", ");
  }
  if (Array.isArray(row["blanks"])) {
    return (row["blanks"] as unknown[])
      .map((answers) =>
        Array.isArray(answers) ? answers.map(String).join(" / ") : String(answers),
      )
      .join(" · ");
  }
  if (Array.isArray(row["order"])) return (row["order"] as unknown[]).map(String).join(" → ");
  if (Array.isArray(row["pairs"])) {
    return (row["pairs"] as Array<Record<string, unknown>>)
      .map((pair) => `${String(pair["left"] ?? "")} → ${String(pair["right"] ?? "")}`)
      .join("\n");
  }
  if (Array.isArray(row["expected"])) {
    return (row["expected"] as unknown[]).map(String).join(" / ");
  }
  return "";
}

function sourceLabel(source: string, t: (key: string) => string) {
  if (source.startsWith("exam: ")) return source.slice(6);
  if (source === "reading") return t("reading");
  if (source === "listening") return t("listening");
  if (source === "question_bank") return t("browse_questions");
  if (source === "vocabulary") return t("vocabulary");
  return t("self_practice");
}

function friendlyLocation(location: string, t: (key: string) => string) {
  if (location.includes("/questions")) return t("browse_questions");
  if (location.includes("/vocabulary")) return t("vocabulary");
  if (location.includes("/readings")) return t("readings");
  if (location.includes("/listenings")) return t("listenings");
  if (location.includes("/exams")) return t("exams");
  if (location.includes("/practice")) return t("self_practice");
  if (location.includes("/library")) return t("library");
  if (location.includes("/catalog")) return t("catalogs");
  return t("dashboard");
}

function friendlyEvent(type: string, t: (key: string) => string) {
  const map: Record<string, string> = {
    login: "student_signed_in",
    logout: "student_signed_out",
    practice_finished: "practice_finished",
    practice_question_skipped: "question_skipped",
    practice_vocabulary_skipped: "vocabulary_skipped",
    exam_started: "exam_started",
    exam_submitted: "exam_submitted",
    exam_auto_submitted: "exam_submitted",
    listening_play_started: "listening_started",
    listening_play_completed: "listening_completed",
    exam_violation: "exam_attention_event",
  };
  const key = map[type];
  return key ? t(key) : t("learning_activity");
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background p-4">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
