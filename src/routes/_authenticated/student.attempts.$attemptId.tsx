import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  Headphones,
  Save,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PracticeQuestionCard,
  defaultPracticeResponse,
  hasPracticeResponse,
  type PracticeQuestion,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import {
  autoSubmitExamAttempt,
  getExamAttempt,
  getExamResult,
  recordExamViolation,
  saveExamAnswer,
  submitExamAttempt,
} from "@/lib/exam-attempt.functions";
import { useI18n } from "@/lib/i18n";

const attemptQuery = (attemptId: string) =>
  queryOptions({
    queryKey: ["exam-attempt", attemptId],
    queryFn: () => getExamAttempt({ data: { attemptId } }),
  });

export const Route = createFileRoute("/_authenticated/student/attempts/$attemptId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(attemptQuery(params.attemptId)),
  head: () => ({ meta: [{ title: "Exam" }, { name: "robots", content: "noindex" }] }),
  component: AttemptPage,
});

type AttemptData = Awaited<ReturnType<typeof getExamAttempt>>;
type ClientQuestion = PracticeQuestion & {
  item_key: string;
  question_id: string;
  version: number;
  metadata?: Record<string, unknown>;
};

type ReadingContext = {
  kind: "reading";
  title: string;
  body: string;
  display_layout: string;
  setTitle: string | null;
  setInstructions: string | null;
};

type ListeningContext = {
  kind: "listening";
  listeningId: string;
  title: string;
  media: {
    kind?: string;
    external_url?: string | null;
    mime_type?: string | null;
  } | null;
  playback_rules: {
    max_plays?: number | null;
    allow_pause?: boolean;
    allow_seek?: boolean;
    allow_rewind?: boolean;
    show_transcript?: boolean;
  };
  transcript: string | null;
  setTitle: string | null;
  setInstructions: string | null;
};

type QuestionView = {
  question: ClientQuestion;
  sectionId: string;
  sectionTitle: string | null;
  context: ReadingContext | ListeningContext | null;
};

type LocalBackup = {
  responses: Record<string, PracticeResponse>;
  flags: Record<string, boolean>;
  times: Record<string, number>;
  savedAt: string;
};

function AttemptPage() {
  const { attemptId } = Route.useParams();
  const { data } = useSuspenseQuery(attemptQuery(attemptId));

  if (data.attempt.status !== "in_progress") {
    return <ResultView attemptId={attemptId} data={data} />;
  }

  return <ActiveAttempt attemptId={attemptId} data={data} />;
}

function ActiveAttempt({
  attemptId,
  data,
}: {
  attemptId: string;
  data: AttemptData;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { refetch } = useSuspenseQuery(attemptQuery(attemptId));

  const views = flattenAttempt(data);
  const initialAnswers = Object.fromEntries(
    data.answers
      .filter((answer) => answer.response && typeof answer.response === "object")
      .map((answer) => [answer.item_key, answer.response as PracticeResponse]),
  );
  const initialFlags = Object.fromEntries(data.answers.map((answer) => [answer.item_key, answer.flagged]));
  const initialTimes = Object.fromEntries(data.answers.map((answer) => [answer.item_key, answer.time_spent_ms]));

  const [responses, setResponses] = useState<Record<string, PracticeResponse>>(initialAnswers);
  const [flags, setFlags] = useState<Record<string, boolean>>(initialFlags);
  const [times, setTimes] = useState<Record<string, number>>(initialTimes);
  const [currentIndex, setCurrentIndex] = useState(() => {
    const firstUnanswered = views.findIndex((view) => !initialAnswers[view.question.item_key]);
    return firstUnanswered >= 0 ? firstUnanswered : 0;
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [tabSwitches, setTabSwitches] = useState(() =>
    Array.isArray(data.attempt.violations)
      ? data.attempt.violations.filter(
          (value) =>
            !!value &&
            typeof value === "object" &&
            (value as Record<string, unknown>)["type"] === "tab_hidden",
        ).length
      : 0,
  );
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoSubmitting = useRef(false);
  const responseRef = useRef(responses);
  const flagRef = useRef(flags);
  const timeRef = useRef(times);

  const snapshot = data.snapshot as unknown as {
    exam: {
      title: string;
      description: string | null;
      settings: {
        allow_back_navigation: boolean;
        copy_paste_restricted: boolean;
        monitor_tab_switches: boolean;
        max_tab_switches: number | null;
      };
    };
  };

  const current = views[currentIndex] ?? null;
  const storageKey = `fluentforge:exam:${attemptId}`;

  useEffect(() => {
    responseRef.current = responses;
  }, [responses]);
  useEffect(() => {
    flagRef.current = flags;
  }, [flags]);
  useEffect(() => {
    timeRef.current = times;
  }, [times]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const backup = JSON.parse(raw) as LocalBackup;
      setResponses((server) => ({ ...server, ...(backup.responses ?? {}) }));
      setFlags((server) => ({ ...server, ...(backup.flags ?? {}) }));
      setTimes((server) => ({ ...server, ...(backup.times ?? {}) }));
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    const payload: LocalBackup = {
      responses,
      flags,
      times,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [responses, flags, times, storageKey]);

  useEffect(() => {
    if (!current) return;
    const key = current.question.item_key;
    const interval = setInterval(() => {
      setTimes((previous) => ({
        ...previous,
        [key]: (previous[key] ?? 0) + 1_000,
      }));
    }, 1_000);
    return () => clearInterval(interval);
  }, [current?.question.item_key]);

  useEffect(() => {
    if (!data.attempt.deadline_at) {
      setRemainingMs(null);
      return;
    }

    const serverOffset = new Date(data.server_time).getTime() - Date.now();
    const deadline = new Date(data.attempt.deadline_at).getTime();

    const tick = async () => {
      const remaining = Math.max(0, deadline - (Date.now() + serverOffset));
      setRemainingMs(remaining);

      if (remaining <= 5_000 && remaining > 0) {
        await flushAll(views, attemptId, responseRef.current, flagRef.current, timeRef.current).catch(() => {});
      }

      if (remaining === 0 && !autoSubmitting.current) {
        autoSubmitting.current = true;
        try {
          await autoSubmitExamAttempt({ data: { attemptId } });
          localStorage.removeItem(storageKey);
          await qc.invalidateQueries({ queryKey: ["exam-attempt", attemptId] });
          await refetch();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          autoSubmitting.current = false;
        }
      }
    };

    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, data.attempt.deadline_at, data.server_time]);

  useEffect(() => {
    const settings = snapshot.exam.settings;

    const record = (type: "tab_hidden" | "copy" | "paste" | "cut") => {
      recordExamViolation({ data: { attemptId, type, details: {} } }).catch(() => {});
    };

    const visibility = async () => {
      if (!settings.monitor_tab_switches || document.visibilityState !== "hidden") return;
      const next = tabSwitches + 1;
      setTabSwitches(next);
      record("tab_hidden");

      if (
        settings.max_tab_switches != null &&
        next > settings.max_tab_switches &&
        !autoSubmitting.current
      ) {
        autoSubmitting.current = true;
        try {
          await flushAll(views, attemptId, responseRef.current, flagRef.current, timeRef.current).catch(() => {});
          await autoSubmitExamAttempt({ data: { attemptId } });
          localStorage.removeItem(storageKey);
          await qc.invalidateQueries({ queryKey: ["exam-attempt", attemptId] });
          await refetch();
        } finally {
          autoSubmitting.current = false;
        }
      }
    };

    const copyHandler = (event: ClipboardEvent) => {
      if (!settings.copy_paste_restricted) return;
      event.preventDefault();
      record(event.type as "copy" | "paste" | "cut");
    };

    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("copy", copyHandler);
    document.addEventListener("paste", copyHandler);
    document.addEventListener("cut", copyHandler);

    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("copy", copyHandler);
      document.removeEventListener("paste", copyHandler);
      document.removeEventListener("cut", copyHandler);
    };
  }, [
    attemptId,
    snapshot.exam.settings,
    tabSwitches,
    qc,
    refetch,
    storageKey,
    views,
  ]);

  useEffect(() => {
    const online = () => {
      flushAll(views, attemptId, responseRef.current, flagRef.current, timeRef.current)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [attemptId, views]);

  function scheduleSave(question: ClientQuestion) {
    const key = question.item_key;
    if (timers.current[key]) clearTimeout(timers.current[key]);

    setSaveState("saving");
    timers.current[key] = setTimeout(async () => {
      try {
        await saveExamAnswer({
          data: {
            attemptId,
            itemKey: key,
            response: responseRef.current[key] ?? null,
            flagged: flagRef.current[key] ?? false,
            timeSpentMs: timeRef.current[key] ?? 0,
          },
        });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 500);
  }

  function changeResponse(question: ClientQuestion, response: PracticeResponse) {
    setResponses((previous) => {
      const next = { ...previous, [question.item_key]: response };
      responseRef.current = next;
      return next;
    });
    scheduleSave(question);
  }

  function toggleFlag(question: ClientQuestion) {
    setFlags((previous) => {
      const next = { ...previous, [question.item_key]: !previous[question.item_key] };
      flagRef.current = next;
      return next;
    });
    scheduleSave(question);
  }

  async function submit() {
    const answered = views.filter((view) =>
      hasPracticeResponse(
        view.question,
        responses[view.question.item_key] ?? defaultPracticeResponse(view.question),
      ),
    ).length;
    const unanswered = views.length - answered;

    if (unanswered > 0 && !confirm(`${unanswered} ${t("unanswered_questions_confirm")}`)) return;
    if (!confirm(t("submit_exam_confirm"))) return;

    setSubmitting(true);
    try {
      await flushAll(views, attemptId, responses, flags, times);
      await submitExamAttempt({ data: { attemptId } });
      localStorage.removeItem(storageKey);
      await qc.invalidateQueries({ queryKey: ["exam-attempt", attemptId] });
      await qc.invalidateQueries({ queryKey: ["student-exams"] });
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-muted-foreground">{t("no_questions")}</p>
      </div>
    );
  }

  const response =
    responses[current.question.item_key] ?? defaultPracticeResponse(current.question);
  const answeredCount = views.filter((view) =>
    hasPracticeResponse(
      view.question,
      responses[view.question.item_key] ?? defaultPracticeResponse(view.question),
    ),
  ).length;

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-4">
      <header className="sticky top-0 z-20 mb-4 border-b border-border bg-background/95 pb-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t("exam")}</div>
            <h1 className="truncate text-lg font-bold">{snapshot.exam.title}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex items-center gap-1 rounded-md border border-border px-3 py-2">
              <Timer className="h-4 w-4" />
              <span className={remainingMs != null && remainingMs < 60_000 ? "font-bold text-destructive" : "font-medium"}>
                {remainingMs == null ? "—" : formatRemaining(remainingMs)}
              </span>
            </div>
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              {answeredCount}/{views.length}
            </div>
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              <Save className="mr-1 inline h-3.5 w-3.5" />
              {t(saveState === "saving" ? "saving" : saveState === "error" ? "save_failed" : "saved")}
            </div>
            <Button onClick={submit} disabled={submitting}>
              <CheckCircle2 className="h-4 w-4" />
              {t("submit_exam")}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-medium">{t("questions")}</div>
            <div className="grid grid-cols-5 gap-1 lg:grid-cols-4">
              {views.map((view, index) => {
                const key = view.question.item_key;
                const isAnswered = hasPracticeResponse(
                  view.question,
                  responses[key] ?? defaultPracticeResponse(view.question),
                );
                const flagged = flags[key];

                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!snapshot.exam.settings.allow_back_navigation && index < currentIndex}
                    onClick={() => setCurrentIndex(index)}
                    className={[
                      "relative h-9 rounded-md border text-xs font-medium",
                      index === currentIndex
                        ? "border-primary bg-primary text-primary-foreground"
                        : isAnswered
                          ? "border-border bg-muted"
                          : "border-border bg-background",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    ].join(" ")}
                  >
                    {index + 1}
                    {flagged && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>{t("answered")}: {answeredCount}</div>
              <div>{t("unanswered")}: {views.length - answeredCount}</div>
              <div>{t("flagged")}: {Object.values(flags).filter(Boolean).length}</div>
              {snapshot.exam.settings.monitor_tab_switches && (
                <div>{t("tab_switches")}: {tabSwitches}</div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-muted-foreground">
              {current.sectionTitle || t("section")} · {currentIndex + 1}/{views.length}
            </div>
            <Button
              variant={flags[current.question.item_key] ? "default" : "outline"}
              size="sm"
              onClick={() => toggleFlag(current.question)}
            >
              <Flag className="h-4 w-4" />
              {t("flag_question")}
            </Button>
          </div>

          {current.context?.kind === "reading" && (
            <ReadingContextCard context={current.context} />
          )}

          {current.context?.kind === "listening" && (
            <ListeningContextCard
              context={current.context}
              count={playCounts[current.context.listeningId] ?? 0}
              onPlay={() =>
                setPlayCounts((previous) => ({
                  ...previous,
                  [current.context!.kind === "listening" ? current.context!.listeningId : ""]: (previous[current.context!.kind === "listening" ? current.context!.listeningId : ""] ?? 0) + 1,
                }))
              }
            />
          )}

          <PracticeQuestionCard
            question={current.question}
            response={response}
            revealed={false}
            busy={false}
            showCheck={false}
            onChange={(next) => changeResponse(current.question, next)}
            onCheck={() => {}}
            onReveal={() => {}}
          />

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              disabled={
                currentIndex === 0 ||
                !snapshot.exam.settings.allow_back_navigation
              }
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            >
              ← {t("previous")}
            </Button>
            <Button
              variant="outline"
              disabled={currentIndex >= views.length - 1}
              onClick={() => setCurrentIndex((index) => Math.min(views.length - 1, index + 1))}
            >
              {t("next")} →
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}

function ResultView({ attemptId, data }: { attemptId: string; data: AttemptData }) {
  const { t } = useI18n();
  const { data: result, isLoading } = useQuery({
    queryKey: ["exam-result", attemptId],
    queryFn: () => getExamResult({ data: { attemptId } }),
  });

  const views = flattenAttempt(data);
  const byKey = new Map(views.map((view) => [view.question.item_key, view]));

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-6">
      <Link to="/student/exams" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t("exams")}
      </Link>

      <h1 className="text-2xl font-bold">{(data.snapshot as unknown as { exam: { title: string } }).exam.title}</h1>

      {isLoading || !result ? (
        <p className="py-8 text-sm text-muted-foreground">…</p>
      ) : !result.ready ? (
        <div className="mt-5 rounded-md border border-border p-5">
          <h2 className="font-semibold">{t("result_not_released")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.pending_review ? t("pending_teacher_review") : t("result_release_wait")}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
            <ResultCell label={t("score")} value={`${result.score ?? 0} / ${result.max_score ?? 0}`} />
            <ResultCell
              label={t("accuracy")}
              value={
                result.max_score && Number(result.max_score) > 0
                  ? `${Math.round((Number(result.score ?? 0) / Number(result.max_score)) * 100)}%`
                  : "—"
              }
            />
            <ResultCell
              label={t("result")}
              value={result.passed == null ? "—" : result.passed ? t("passed") : t("failed")}
            />
          </div>

          {result.answers.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-semibold">{t("answers")}</h2>
              {result.answers.map((answer, index) => {
                const view = byKey.get(answer.item_key);
                return (
                  <div key={answer.item_key} className="rounded-md border border-border p-4">
                    <div className="text-xs text-muted-foreground">{index + 1}</div>
                    <div className="mt-1 font-medium">{view?.question.prompt ?? t("question")}</div>
                    <div className="mt-2 text-sm">
                      {answer.is_correct == null
                        ? t("needs_review")
                        : answer.is_correct
                          ? t("correct")
                          : t("incorrect")}
                      {answer.score != null && <span> · {t("score")}: {answer.score}</span>}
                    </div>
                    {answer.answer_key && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        {t("correct_answer")}: {formatResultAnswer(answer.answer_key)}
                      </div>
                    )}
                    {answer.explanation && (
                      <div className="mt-2 rounded bg-muted p-3 text-sm">{answer.explanation}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReadingContextCard({ context }: { context: ReadingContext }) {
  const { t } = useI18n();
  return (
    <section className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("reading")}</div>
      <h2 className="mt-1 font-semibold">{context.title}</h2>
      {context.setTitle && <h3 className="mt-3 text-sm font-medium">{context.setTitle}</h3>}
      {context.setInstructions && <p className="mt-1 text-xs text-muted-foreground">{context.setInstructions}</p>}
      <div className="mt-4 max-h-[45vh] overflow-y-auto whitespace-pre-wrap text-sm leading-7">
        {context.body}
      </div>
    </section>
  );
}

function ListeningContextCard({
  context,
  count,
  onPlay,
}: {
  context: ListeningContext;
  count: number;
  onPlay: () => void;
}) {
  const { t } = useI18n();
  const maxPlays = context.playback_rules.max_plays ?? null;
  const blocked = maxPlays != null && count >= maxPlays;
  const url = context.media?.external_url ?? null;

  return (
    <section className="rounded-md border border-border p-4">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        <Headphones className="h-3.5 w-3.5" />
        {t("listening")}
      </div>
      <h2 className="mt-1 font-semibold">{context.title}</h2>
      {context.setTitle && <h3 className="mt-3 text-sm font-medium">{context.setTitle}</h3>}
      {context.setInstructions && <p className="mt-1 text-xs text-muted-foreground">{context.setInstructions}</p>}

      <div className="mt-4">
        {url ? (
          context.media?.kind === "video" ? (
            <video
              src={url}
              className="w-full rounded-md bg-black"
              controls={!blocked}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                onPlay();
              }}
            />
          ) : (
            <audio
              src={url}
              className="w-full"
              controls={!blocked}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                onPlay();
              }}
            />
          )
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("media_not_available")}
          </div>
        )}
        {maxPlays != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t("plays_used")}: {Math.min(count, maxPlays)} / {maxPlays}
          </div>
        )}
      </div>

      {context.transcript && (
        <details className="mt-4 rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("transcript")}</summary>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{context.transcript}</div>
        </details>
      )}
    </section>
  );
}

function flattenAttempt(data: AttemptData): QuestionView[] {
  const snapshot = data.snapshot as unknown as {
    sections: Array<{
      id: string;
      title: string | null;
      blocks: Array<
        | {
            kind: "question";
            question: ClientQuestion;
          }
        | {
            kind: "reading";
            reading: {
              id: string;
              title: string;
              body?: string;
              display_layout?: string;
            };
            question_sets: Array<{
              title: string | null;
              instructions: string | null;
              questions: ClientQuestion[];
            }>;
          }
        | {
            kind: "listening";
            listening: {
              id: string;
              title: string;
              media?: {
                kind?: string;
                external_url?: string | null;
                mime_type?: string | null;
              } | null;
              playback_rules?: {
                max_plays?: number | null;
                allow_pause?: boolean;
                allow_seek?: boolean;
                allow_rewind?: boolean;
                show_transcript?: boolean;
              };
              transcript?: string | null;
            };
            question_sets: Array<{
              title: string | null;
              instructions: string | null;
              questions: ClientQuestion[];
            }>;
          }
      >;
    }>;
  };

  const result: QuestionView[] = [];

  for (const section of snapshot.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block.kind === "question") {
        result.push({
          question: block.question,
          sectionId: section.id,
          sectionTitle: section.title,
          context: null,
        });
        continue;
      }

      if (block.kind === "reading") {
        for (const set of block.question_sets ?? []) {
          for (const question of set.questions ?? []) {
            result.push({
              question,
              sectionId: section.id,
              sectionTitle: section.title,
              context: {
                kind: "reading",
                title: block.reading.title,
                body: block.reading.body ?? "",
                display_layout: block.reading.display_layout ?? "stacked",
                setTitle: set.title,
                setInstructions: set.instructions,
              },
            });
          }
        }
        continue;
      }

      for (const set of block.question_sets ?? []) {
        for (const question of set.questions ?? []) {
          result.push({
            question,
            sectionId: section.id,
            sectionTitle: section.title,
            context: {
              kind: "listening",
              listeningId: block.listening.id,
              title: block.listening.title,
              media: block.listening.media ?? null,
              playback_rules: block.listening.playback_rules ?? {},
              transcript: block.listening.transcript ?? null,
              setTitle: set.title,
              setInstructions: set.instructions,
            },
          });
        }
      }
    }
  }

  return result;
}

async function flushAll(
  views: QuestionView[],
  attemptId: string,
  responses: Record<string, PracticeResponse>,
  flags: Record<string, boolean>,
  times: Record<string, number>,
) {
  await Promise.all(
    views.map(async (view) => {
      const key = view.question.item_key;
      const response = responses[key];
      if (!response && !flags[key] && !times[key]) return;
      await saveExamAnswer({
        data: {
          attemptId,
          itemKey: key,
          response: response ?? null,
          flagged: flags[key] ?? false,
          timeSpentMs: times[key] ?? 0,
        },
      });
    }),
  );
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ResultCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background p-4">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function formatResultAnswer(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  const answer = value as Record<string, unknown>;
  if (Array.isArray(answer["correct"])) return (answer["correct"] as string[]).join(", ");
  if (Array.isArray(answer["blanks"])) {
    return (answer["blanks"] as string[][]).map((values) => values.join(" / ")).join(" · ");
  }
  if (Array.isArray(answer["pairs"])) {
    return (answer["pairs"] as Array<{ left: string; right: string }>)
      .map((pair) => `${pair.left} → ${pair.right}`)
      .join(" · ");
  }
  if (Array.isArray(answer["order"])) return (answer["order"] as string[]).join(" → ");
  return typeof answer["model_answer"] === "string" ? answer["model_answer"] : "—";
}
