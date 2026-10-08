import {
  createFileRoute,
  Link,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  BookType,
  CheckCircle2,
  FileQuestion,
  Headphones,
  Play,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  PracticeQuestionCard,
  defaultPracticeResponse,
  hasPracticeResponse,
  type PracticeFeedback,
  type PracticeQuestion,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import {
  StudentListeningBlock,
  StudentReadingBlock,
  collectContextQuestions,
  type StudentListeningPractice,
  type StudentReadingPractice,
} from "@/components/app/StudentContextPractice";
import {
  finishSelfPractice,
  generateSelfPractice,
  getSelfPracticeOptions,
  submitSelfPracticeAnswer,
  submitSelfPracticeVocabularyAnswer,
  type SelfPracticeGenerator,
  type SelfPracticeVocabularyItem,
} from "@/lib/self-practice.functions";
import { getWhoAmI } from "@/lib/teacher.functions";
import { LEVELS } from "@/lib/question-types";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

const optionsQuery = queryOptions({
  queryKey: ["self-practice-options-v2"],
  queryFn: () => getSelfPracticeOptions(),
});

const STORAGE_KEY = "fluentforge:self-practice:v2";

type PracticeOptions = Awaited<ReturnType<typeof getSelfPracticeOptions>>;

type VocabularyFeedback = {
  entry_id: string;
  direction: "word_to_translation" | "translation_to_word";
  target_language: string;
  correct: boolean;
  expected: string[];
};

type StoredSession = {
  sessionId: string;
  startedAt: string;
  filters: SelfPracticeGenerator;
  questions: PracticeQuestion[];
  vocabulary: SelfPracticeVocabularyItem[];
  readings: StudentReadingPractice[];
  listenings: StudentListeningPractice[];
  responses: Record<string, PracticeResponse>;
  vocabularyResponses: Record<string, string>;
};

const emptyCommonPool = {
  source: "all" as const,
  catalogId: null,
  specificIds: [] as string[],
  language: null,
  level: null,
};

type PracticeFocus = "questions" | "vocabulary" | "readings" | "listenings";

function initialFilters(focus?: PracticeFocus): SelfPracticeGenerator {
  const counts = {
    questions: focus && focus !== "questions" ? 0 : 10,
    vocabulary: focus === "vocabulary" ? 10 : 0,
    readings: focus === "readings" ? 1 : 0,
    listenings: focus === "listenings" ? 1 : 0,
  };
  return {
    sessionMode: "practice",
    durationMinutes: 30,
    feedbackMode: "instant",
    questions: {
      ...emptyCommonPool,
      count: counts.questions,
      types: [],
      topicIds: [],
      sourceFileId: null,
      difficulty: null,
      historyMode: "all",
      excludeAnswered: false,
    },
    vocabulary: {
      ...emptyCommonPool,
      count: counts.vocabulary,
      direction: "word_to_translation",
      translationLanguage: "az",
      topicIds: [],
    },
    readings: {
      ...emptyCommonPool,
      count: counts.readings,
      topicIds: [],
    },
    listenings: {
      ...emptyCommonPool,
      count: counts.listenings,
      topicIds: [],
    },
  };
}

export const Route = createFileRoute("/_authenticated/student/practice")({
  validateSearch: (search) =>
    z
      .object({
        focus: z
          .enum(["questions", "vocabulary", "readings", "listenings"])
          .optional(),
      })
      .parse(search),
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(optionsQuery),
  head: () => ({
    meta: [
      { title: "Self practice" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SelfPracticePage,
});

function SelfPracticePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: options } = useSuspenseQuery(optionsQuery);
  const { focus } = Route.useSearch();

  const [filters, setFilters] = useState<SelfPracticeGenerator>(() =>
    initialFilters(focus),
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [vocabulary, setVocabulary] = useState<
    SelfPracticeVocabularyItem[]
  >([]);
  const [readings, setReadings] = useState<StudentReadingPractice[]>([]);
  const [listenings, setListenings] = useState<
    StudentListeningPractice[]
  >([]);
  const [responses, setResponses] = useState<
    Record<string, PracticeResponse>
  >({});
  const [vocabularyResponses, setVocabularyResponses] = useState<
    Record<string, string>
  >({});
  const [feedback, setFeedback] = useState<
    Record<string, PracticeFeedback>
  >({});
  const [vocabularyFeedback, setVocabularyFeedback] = useState<
    Record<string, VocabularyFeedback>
  >({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
  const [busyVocabulary, setBusyVocabulary] = useState<string | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<{
    answered: number;
    graded: number;
    score: number;
    max_score: number;
    accuracy: number | null;
  } | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const finishRef = useRef<(skipConfirmation?: boolean) => Promise<void>>(
    async () => {},
  );

  const allQuestions = useMemo(
    () => [
      ...questions,
      ...readings.flatMap(collectContextQuestions),
      ...listenings.flatMap(collectContextQuestions),
    ],
    [questions, readings, listenings],
  );
  const hasGeneratedContent =
    questions.length > 0 ||
    vocabulary.length > 0 ||
    readings.length > 0 ||
    listenings.length > 0;

  useEffect(() => {
    if (focus) {
      localStorage.removeItem(STORAGE_KEY);
      setResumeChecked(true);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed.sessionId) return;
      if (
        !parsed.questions?.length &&
        !parsed.vocabulary?.length &&
        !parsed.readings?.length &&
        !parsed.listenings?.length
      ) {
        return;
      }
      setSessionId(parsed.sessionId);
      setStartedAt(parsed.startedAt ?? new Date().toISOString());
      setFilters(parsed.filters);
      setQuestions(parsed.questions ?? []);
      setVocabulary(parsed.vocabulary ?? []);
      setReadings(parsed.readings ?? []);
      setListenings(parsed.listenings ?? []);
      setResponses(parsed.responses ?? {});
      setVocabularyResponses(parsed.vocabularyResponses ?? {});
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setResumeChecked(true);
    }
  }, [focus]);

  useEffect(() => {
    if (
      !resumeChecked ||
      !sessionId ||
      !hasGeneratedContent ||
      summary
    ) {
      return;
    }
    const payload: StoredSession = {
      sessionId,
      startedAt: startedAt ?? new Date().toISOString(),
      filters,
      questions,
      vocabulary,
      readings,
      listenings,
      responses,
      vocabularyResponses,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    resumeChecked,
    sessionId,
    startedAt,
    filters,
    questions,
    vocabulary,
    readings,
    listenings,
    responses,
    vocabularyResponses,
    summary,
    hasGeneratedContent,
  ]);

  function resetSession() {
    setSessionId(null);
    setStartedAt(null);
    setRemainingMs(null);
    setQuestions([]);
    setVocabulary([]);
    setReadings([]);
    setListenings([]);
    setResponses({});
    setVocabularyResponses({});
    setFeedback({});
    setVocabularyFeedback({});
    setRevealed({});
    setSummary(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setSummary(null);
    setFeedback({});
    setVocabularyFeedback({});
    setRevealed({});

    try {
      const effectiveFilters =
        filters.sessionMode === "mock_exam"
          ? { ...filters, feedbackMode: "end" as const }
          : filters;
      const result = await generateSelfPractice({
        data: effectiveFilters,
      });

      if (result.generated === 0) {
        toast.error(t("no_content_match"));
        return;
      }

      setFilters(effectiveFilters);
      setSessionId(crypto.randomUUID());
      setStartedAt(new Date().toISOString());
      setQuestions(result.questions as PracticeQuestion[]);
      setVocabulary(
        result.vocabulary as unknown as SelfPracticeVocabularyItem[],
      );
      setReadings(
        result.readings as unknown as StudentReadingPractice[],
      );
      setListenings(
        result.listenings as unknown as StudentListeningPractice[],
      );
      setResponses({});
      setVocabularyResponses({});

      if (result.generated < result.requested) {
        toast.message(
          `${t("generated")} ${result.generated} / ${result.requested}`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  function responseFor(question: PracticeQuestion) {
    return (
      responses[question.id] ?? defaultPracticeResponse(question)
    );
  }

  function updateResponse(
    question: PracticeQuestion,
    response: PracticeResponse,
  ) {
    setResponses((current) => ({
      ...current,
      [question.id]: response,
    }));
    setFeedback((current) => {
      if (!current[question.id]) return current;
      const next = { ...current };
      delete next[question.id];
      return next;
    });
    setRevealed((current) => ({
      ...current,
      [question.id]: false,
    }));
  }

  async function checkQuestion(question: PracticeQuestion) {
    if (
      !sessionId ||
      filters.sessionMode === "mock_exam" ||
      filters.feedbackMode !== "instant"
    ) {
      return;
    }
    const response = responseFor(question);
    if (!hasPracticeResponse(question, response)) {
      toast.error(t("answer_required"));
      return;
    }

    setBusyQuestion(question.id);
    try {
      const result = await submitSelfPracticeAnswer({
        data: {
          sessionId,
          answer: {
            questionId: question.id,
            response,
            duration_ms: 0,
          },
        },
      });
      if (result.result) {
        setFeedback((current) => ({
          ...current,
          [question.id]: result.result as PracticeFeedback,
        }));
      }
      await qc.invalidateQueries({ queryKey: ["practice-progress"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyQuestion(null);
    }
  }

  async function checkVocabulary(item: SelfPracticeVocabularyItem) {
    if (
      !sessionId ||
      filters.sessionMode === "mock_exam" ||
      filters.feedbackMode !== "instant"
    ) {
      return;
    }
    const response = vocabularyResponses[item.entryId]?.trim() ?? "";
    if (!response) {
      toast.error(t("answer_required"));
      return;
    }

    setBusyVocabulary(item.entryId);
    try {
      const result = await submitSelfPracticeVocabularyAnswer({
        data: {
          sessionId,
          answer: {
            entryId: item.entryId,
            direction: item.direction,
            targetLanguage: item.targetLanguage,
            response,
            duration_ms: 0,
          },
        },
      });
      setVocabularyFeedback((current) => ({
        ...current,
        [item.entryId]: result.result as VocabularyFeedback,
      }));
      await qc.invalidateQueries({ queryKey: ["practice-progress"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyVocabulary(null);
    }
  }

  async function finish(skipConfirmation = false) {
    if (!sessionId) return;

    const answeredQuestions = allQuestions.filter((question) =>
      hasPracticeResponse(question, responseFor(question)),
    );
    const answeredVocabulary = vocabulary.filter(
      (item) => !!vocabularyResponses[item.entryId]?.trim(),
    );
    const answeredCount =
      answeredQuestions.length + answeredVocabulary.length;
    const totalCount = allQuestions.length + vocabulary.length;

    if (!answeredCount && !skipConfirmation) {
      toast.error(t("answer_required"));
      return;
    }
    if (
      !skipConfirmation &&
      answeredCount < totalCount &&
      !confirm(t("finish_with_unanswered_confirm"))
    ) {
      return;
    }

    setFinishing(true);
    try {
      const result = await finishSelfPractice({
        data: {
          sessionId,
          filters,
          alreadyLoggedQuestionIds: Object.keys(feedback),
          alreadyLoggedVocabularyIds: Object.keys(vocabularyFeedback),
          presentedQuestionIds: allQuestions.map(
            (question) => question.id,
          ),
          presentedVocabularyIds: vocabulary.map(
            (item) => item.entryId,
          ),
          answers: answeredQuestions.map((question) => ({
            questionId: question.id,
            response: responseFor(question),
            duration_ms: 0,
          })),
          vocabularyAnswers: answeredVocabulary.map((item) => ({
            entryId: item.entryId,
            direction: item.direction,
            targetLanguage: item.targetLanguage,
            response: vocabularyResponses[item.entryId] ?? "",
            duration_ms: 0,
          })),
        },
      });

      setFeedback(
        Object.fromEntries(
          result.results.map((row) => [
            row.question_id,
            row as PracticeFeedback,
          ]),
        ),
      );
      setVocabularyFeedback(
        Object.fromEntries(
          result.vocabularyResults.map((row) => [
            row.entry_id,
            row as VocabularyFeedback,
          ]),
        ),
      );
      setSummary(result.summary);
      localStorage.removeItem(STORAGE_KEY);
      await qc.invalidateQueries({ queryKey: ["practice-progress"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setFinishing(false);
    }
  }

  finishRef.current = finish;

  useEffect(() => {
    if (
      !sessionId ||
      !startedAt ||
      filters.sessionMode !== "mock_exam" ||
      summary
    ) {
      setRemainingMs(null);
      return;
    }

    const deadline =
      new Date(startedAt).getTime() + filters.durationMinutes * 60_000;
    let submitted = false;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !submitted && !finishing) {
        submitted = true;
        void finishRef.current(true);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [
    sessionId,
    startedAt,
    filters.sessionMode,
    filters.durationMinutes,
    summary,
    finishing,
  ]);

  const requestedCount =
    requestedForPool(filters.questions) +
    requestedForPool(filters.vocabulary) +
    requestedForPool(filters.readings) +
    requestedForPool(filters.listenings);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-5">
      <header className="mb-6">
        <Link
          to="/student"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t("self_practice")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t("self_practice_builder_hint")}
            </p>
          </div>
          {hasGeneratedContent && (
            <Button variant="outline" onClick={resetSession}>
              <RotateCcw className="h-4 w-4" />
              {t("new_practice")}
            </Button>
          )}
        </div>
      </header>

      {summary && (
        <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
          <SummaryCell label={t("answered")} value={summary.answered} />
          <SummaryCell label={t("graded")} value={summary.graded} />
          <SummaryCell
            label={t("score")}
            value={`${round(summary.score)} / ${round(
              summary.max_score,
            )}`}
          />
          <SummaryCell
            label={t("accuracy")}
            value={
              summary.accuracy == null
                ? "—"
                : `${Math.round(summary.accuracy * 100)}%`
            }
          />
        </section>
      )}

      {!hasGeneratedContent ? (
        <form onSubmit={generate} className="space-y-5">
          <SessionSettings
            filters={filters}
            onChange={setFilters}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            {(!focus || focus === "questions") && (
              <QuestionPoolCard
                options={options}
                pool={filters.questions}
                onChange={(questions) =>
                  setFilters((current) => ({ ...current, questions }))
                }
              />
            )}

            {(!focus || focus === "vocabulary") && (
              <VocabularyPoolCard
                options={options}
                pool={filters.vocabulary}
                onChange={(vocabularyPool) =>
                  setFilters((current) => ({
                    ...current,
                    vocabulary: vocabularyPool,
                  }))
                }
              />
            )}

            {(!focus || focus === "readings") && (
              <ContextPoolCard
                kind="reading"
                options={options}
                pool={filters.readings}
                onChange={(readingsPool) =>
                  setFilters((current) => ({
                    ...current,
                    readings: readingsPool,
                  }))
                }
              />
            )}

            {(!focus || focus === "listenings") && (
              <ContextPoolCard
                kind="listening"
                options={options}
                pool={filters.listenings}
                onChange={(listeningsPool) =>
                  setFilters((current) => ({
                    ...current,
                    listenings: listeningsPool,
                  }))
                }
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="text-sm">
              <strong>{t("requested_content")}:</strong>{" "}
              {requestedCount}
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={generating || requestedCount === 0}
            >
              <Play className="h-4 w-4" />
              {t("generate_practice")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
            <span>
              {questions.length} {t("questions").toLocaleLowerCase()}
              {" · "}
              {vocabulary.length} {t("vocabulary").toLocaleLowerCase()}
              {" · "}
              {readings.length} {t("readings").toLocaleLowerCase()}
              {" · "}
              {listenings.length} {t("listenings").toLocaleLowerCase()}
              {" · "}
              {filters.sessionMode === "mock_exam"
                ? t("mock_exam")
                : filters.feedbackMode === "instant"
                  ? t("instant_feedback")
                  : t("feedback_after_finish")}
              {remainingMs != null
                ? ` · ${t("time_remaining")}: ${formatRemaining(
                    remainingMs,
                  )}`
                : ""}
            </span>
            {resumeChecked && !summary && (
              <span className="text-xs text-muted-foreground">
                {t("saved_in_browser")}
              </span>
            )}
          </div>

          <div className="space-y-6">
            {questions.map((question, index) => (
              <section key={question.id}>
                <div className="mb-1 text-xs text-muted-foreground">
                  {index + 1} / {questions.length}
                </div>
                <PracticeQuestionCard
                  question={question}
                  response={responseFor(question)}
                  feedback={feedback[question.id]}
                  revealed={!!revealed[question.id]}
                  busy={busyQuestion === question.id}
                  showCheck={
                    filters.sessionMode === "practice" &&
                    filters.feedbackMode === "instant"
                  }
                  onChange={(response) =>
                    updateResponse(question, response)
                  }
                  onCheck={() => checkQuestion(question)}
                  onReveal={() =>
                    setRevealed((current) => ({
                      ...current,
                      [question.id]: true,
                    }))
                  }
                />
              </section>
            ))}

            {vocabulary.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BookType className="h-4 w-4" />
                  <h2 className="font-semibold">{t("vocabulary")}</h2>
                </div>
                {vocabulary.map((item, index) => (
                  <VocabularyExamCard
                    key={item.entryId}
                    item={item}
                    index={index}
                    total={vocabulary.length}
                    value={vocabularyResponses[item.entryId] ?? ""}
                    feedback={vocabularyFeedback[item.entryId]}
                    busy={busyVocabulary === item.entryId}
                    showCheck={
                      filters.sessionMode === "practice" &&
                      filters.feedbackMode === "instant"
                    }
                    onChange={(value) => {
                      setVocabularyResponses((current) => ({
                        ...current,
                        [item.entryId]: value,
                      }));
                      setVocabularyFeedback((current) => {
                        if (!current[item.entryId]) return current;
                        const next = { ...current };
                        delete next[item.entryId];
                        return next;
                      });
                    }}
                    onCheck={() => checkVocabulary(item)}
                  />
                ))}
              </section>
            )}

            {readings.map((reading) => (
              <StudentReadingBlock
                key={reading.id}
                reading={reading}
                responses={responses}
                feedback={feedback}
                revealed={revealed}
                showCheck={
                  filters.sessionMode === "practice" &&
                  filters.feedbackMode === "instant"
                }
                busyQuestion={busyQuestion}
                onResponse={(id, response) => {
                  const question = allQuestions.find(
                    (row) => row.id === id,
                  );
                  if (question) updateResponse(question, response);
                }}
                onCheck={checkQuestion}
                onReveal={(id) =>
                  setRevealed((current) => ({
                    ...current,
                    [id]: true,
                  }))
                }
              />
            ))}

            {listenings.map((listening) => (
              <StudentListeningBlock
                key={listening.id}
                listening={listening}
                responses={responses}
                feedback={feedback}
                revealed={revealed}
                showCheck={
                  filters.sessionMode === "practice" &&
                  filters.feedbackMode === "instant"
                }
                busyQuestion={busyQuestion}
                onResponse={(id, response) => {
                  const question = allQuestions.find(
                    (row) => row.id === id,
                  );
                  if (question) updateResponse(question, response);
                }}
                onCheck={checkQuestion}
                onReveal={(id) =>
                  setRevealed((current) => ({
                    ...current,
                    [id]: true,
                  }))
                }
              />
            ))}
          </div>

          <div className="sticky bottom-0 z-10 mt-8 flex justify-end border-t border-border bg-background py-4">
            <Button onClick={() => finish()} disabled={finishing}>
              <CheckCircle2 className="h-4 w-4" />
              {t("finish_practice")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SessionSettings({
  filters,
  onChange,
}: {
  filters: SelfPracticeGenerator;
  onChange: React.Dispatch<React.SetStateAction<SelfPracticeGenerator>>;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-4 font-semibold">{t("session_settings")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("session_mode")}>
          <select
            className={selectClass}
            value={filters.sessionMode}
            onChange={(event) => {
              const sessionMode = event.target
                .value as SelfPracticeGenerator["sessionMode"];
              onChange((current) => ({
                ...current,
                sessionMode,
                feedbackMode:
                  sessionMode === "mock_exam"
                    ? "end"
                    : current.feedbackMode,
              }));
            }}
          >
            <option value="practice">{t("practice_mode")}</option>
            <option value="mock_exam">{t("mock_exam")}</option>
          </select>
        </Field>

        {filters.sessionMode === "mock_exam" && (
          <Field label={t("duration_min")}>
            <Input
              type="number"
              min={5}
              max={240}
              value={filters.durationMinutes}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  durationMinutes: Math.max(
                    5,
                    Math.min(240, Number(event.target.value) || 30),
                  ),
                }))
              }
            />
          </Field>
        )}

        <Field label={t("feedback_mode")}>
          {filters.sessionMode === "mock_exam" ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
              {t("feedback_after_finish")}
            </div>
          ) : (
            <select
              className={selectClass}
              value={filters.feedbackMode}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  feedbackMode: event.target
                    .value as SelfPracticeGenerator["feedbackMode"],
                }))
              }
            >
              <option value="instant">{t("instant")}</option>
              <option value="end">{t("end_of_practice")}</option>
            </select>
          )}
        </Field>
      </div>
    </section>
  );
}

function QuestionPoolCard({
  options,
  pool,
  onChange,
}: {
  options: PracticeOptions;
  pool: SelfPracticeGenerator["questions"];
  onChange: (pool: SelfPracticeGenerator["questions"]) => void;
}) {
  const { t } = useI18n();
  const topics = flattenTopics(options.topics);
  const candidates = options.questions.filter(
    (row) =>
      (!pool.language || row.learning_language === pool.language) &&
      (!pool.level || row.level === pool.level),
  );
  const catalogAvailable =
    pool.source === "catalog" && pool.catalogId
      ? candidates.filter((row) => row.catalogIds.includes(pool.catalogId!)).length
      : null;

  return (
    <PoolCard
      icon={<FileQuestion className="h-5 w-5" />}
      title={t("questions")}
      description={t("question_pool_hint")}
    >
      <PoolSourceFields
        pool={pool}
        catalogs={options.catalogs}
        languages={options.languages}
        onChange={onChange}
      />
      <CatalogAvailability count={catalogAvailable} />
      {pool.source !== "specific" && (
        <Field label={t("question_count")}>
          <Input
            type="number"
            min={0}
            max={100}
            value={pool.count}
            onChange={(event) =>
              onChange({
                ...pool,
                count: Math.max(
                  0,
                  Math.min(100, Number(event.target.value) || 0),
                ),
              })
            }
          />
        </Field>
      )}
      {pool.source === "specific" && (
        <SpecificPicker
          rows={candidates.map((row) => ({
            id: row.id,
            label: row.prompt,
            meta: [
              row.question_type,
              row.level,
              row.learning_language,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          selected={pool.specificIds}
          onChange={(specificIds) =>
            onChange({ ...pool, specificIds })
          }
        />
      )}

      {pool.source !== "specific" && (
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("advanced_filters")}
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-2 text-xs font-medium">
              {t("question_types")}
            </div>
            <div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
              {options.questionTypes.map((type) => (
                <label
                  key={type.id}
                  className="flex items-start gap-2 text-sm"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={pool.types.includes(type.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...pool,
                        types: checked
                          ? [...pool.types, type.id]
                          : pool.types.filter((id) => id !== type.id),
                      })
                    }
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </div>

          <Field label={t("difficulty")}>
            <select
              className={selectClass}
              value={pool.difficulty ?? ""}
              onChange={(event) =>
                onChange({
                  ...pool,
                  difficulty: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            >
              <option value="">{t("all")}</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <div className="mb-2 text-xs font-medium">{t("topics")}</div>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {topics.map((topic) => (
                <label
                  key={topic.id}
                  className="flex items-start gap-2 text-sm"
                  style={{ paddingLeft: topic.depth * 14 }}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={pool.topicIds.includes(topic.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...pool,
                        topicIds: checked
                          ? [...pool.topicIds, topic.id]
                          : pool.topicIds.filter(
                              (id) => id !== topic.id,
                            ),
                      })
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          </div>

          <Field label={t("practice_history_filter")}>
            <select
              className={selectClass}
              value={pool.historyMode}
              onChange={(event) =>
                onChange({
                  ...pool,
                  historyMode: event.target
                    .value as SelfPracticeGenerator["questions"]["historyMode"],
                })
              }
            >
              <option value="all">{t("all_questions")}</option>
              <option value="mistakes">{t("previous_mistakes")}</option>
              <option value="unused">{t("unused_questions")}</option>
            </select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={pool.excludeAnswered}
              onCheckedChange={(checked) =>
                onChange({
                  ...pool,
                  excludeAnswered: !!checked,
                })
              }
            />
            {t("exclude_answered")}
          </label>
        </div>
      </details>
      )}
    </PoolCard>
  );
}

function VocabularyPoolCard({
  options,
  pool,
  onChange,
}: {
  options: PracticeOptions;
  pool: SelfPracticeGenerator["vocabulary"];
  onChange: (pool: SelfPracticeGenerator["vocabulary"]) => void;
}) {
  const { t } = useI18n();
  const candidates = options.vocabulary.filter(
    (row) =>
      (!pool.language || row.learning_language === pool.language) &&
      (!pool.level || row.level === pool.level) &&
      row.translationLanguages.some(
        (language) =>
          language.toLowerCase() ===
          pool.translationLanguage.toLowerCase(),
      ),
  );
  const catalogAvailable =
    pool.source === "catalog" && pool.catalogId
      ? candidates.filter((row) => row.catalogIds.includes(pool.catalogId!)).length
      : null;

  return (
    <PoolCard
      icon={<BookType className="h-5 w-5" />}
      title={t("vocabulary")}
      description={t("vocabulary_pool_hint")}
    >
      <PoolSourceFields
        pool={pool}
        catalogs={options.catalogs}
        languages={options.languages}
        onChange={onChange}
      />
      <CatalogAvailability count={catalogAvailable} />

      {pool.source !== "specific" && (
        <Field label={t("vocabulary_count")}>
          <Input
            type="number"
            min={0}
            max={100}
            value={pool.count}
            onChange={(event) =>
              onChange({
                ...pool,
                count: Math.max(
                  0,
                  Math.min(100, Number(event.target.value) || 0),
                ),
              })
            }
          />
        </Field>
      )}

      <Field label={t("vocabulary_direction")}>
        <select
          className={selectClass}
          value={pool.direction}
          onChange={(event) =>
            onChange({
              ...pool,
              direction: event.target
                .value as SelfPracticeGenerator["vocabulary"]["direction"],
            })
          }
        >
          <option value="word_to_translation">
            {t("word_to_translation")}
          </option>
          <option value="translation_to_word">
            {t("translation_to_word")}
          </option>
          <option value="mixed">{t("mixed_direction")}</option>
        </select>
      </Field>

      <Field label={t("translation_language")}>
        <select
          className={selectClass}
          value={pool.translationLanguage}
          onChange={(event) =>
            onChange({
              ...pool,
              translationLanguage: event.target.value,
            })
          }
        >
          {(options.translationLanguages.length
            ? options.translationLanguages
            : ["az"]
          ).map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </Field>

      {pool.source === "specific" && (
        <SpecificPicker
          rows={candidates.map((row) => ({
            id: row.id,
            label: row.word,
            meta: [
              row.part_of_speech,
              row.level,
              row.learning_language,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          selected={pool.specificIds}
          onChange={(specificIds) =>
            onChange({ ...pool, specificIds })
          }
        />
      )}

      {pool.source !== "specific" && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("advanced_filters")}
          </summary>
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium">{t("topics")}</div>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {flattenTopics(options.topics).map((topic) => (
                <label
                  key={topic.id}
                  className="flex items-start gap-2 text-sm"
                  style={{ paddingLeft: topic.depth * 14 }}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={pool.topicIds.includes(topic.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...pool,
                        topicIds: checked
                          ? [...pool.topicIds, topic.id]
                          : pool.topicIds.filter((id) => id !== topic.id),
                      })
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          </div>
        </details>
      )}
    </PoolCard>
  );
}

function ContextPoolCard({
  kind,
  options,
  pool,
  onChange,
}: {
  kind: "reading" | "listening";
  options: PracticeOptions;
  pool:
    | SelfPracticeGenerator["readings"]
    | SelfPracticeGenerator["listenings"];
  onChange: (
    pool:
      | SelfPracticeGenerator["readings"]
      | SelfPracticeGenerator["listenings"],
  ) => void;
}) {
  const { t } = useI18n();
  const rows =
    kind === "reading" ? options.readings : options.listenings;
  const candidates = rows.filter(
    (row) =>
      (!pool.language || row.learning_language === pool.language) &&
      (!pool.level || row.level === pool.level),
  );
  const catalogAvailable =
    pool.source === "catalog" && pool.catalogId
      ? candidates.filter((row) => row.catalogIds.includes(pool.catalogId!)).length
      : null;

  return (
    <PoolCard
      icon={
        kind === "reading" ? (
          <BookOpen className="h-5 w-5" />
        ) : (
          <Headphones className="h-5 w-5" />
        )
      }
      title={kind === "reading" ? t("readings") : t("listenings")}
      description={
        kind === "reading"
          ? t("reading_pool_hint")
          : t("listening_pool_hint")
      }
    >
      <PoolSourceFields
        pool={pool}
        catalogs={options.catalogs}
        languages={options.languages}
        onChange={onChange}
      />
      <CatalogAvailability count={catalogAvailable} />

      {pool.source !== "specific" && (
        <Field
          label={
            kind === "reading"
              ? t("reading_count")
              : t("listening_count")
          }
        >
          <Input
            type="number"
            min={0}
            max={20}
            value={pool.count}
            onChange={(event) =>
              onChange({
                ...pool,
                count: Math.max(
                  0,
                  Math.min(20, Number(event.target.value) || 0),
                ),
              })
            }
          />
        </Field>
      )}

      {pool.source === "specific" && (
        <SpecificPicker
          rows={candidates.map((row) => ({
            id: row.id,
            label: row.title,
            meta: [row.level, row.learning_language]
              .filter(Boolean)
              .join(" · "),
          }))}
          selected={pool.specificIds}
          onChange={(specificIds) =>
            onChange({ ...pool, specificIds })
          }
        />
      )}

      {pool.source !== "specific" && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("advanced_filters")}
          </summary>
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium">{t("topics")}</div>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {flattenTopics(options.topics).map((topic) => (
                <label
                  key={topic.id}
                  className="flex items-start gap-2 text-sm"
                  style={{ paddingLeft: topic.depth * 14 }}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={pool.topicIds.includes(topic.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...pool,
                        topicIds: checked
                          ? [...pool.topicIds, topic.id]
                          : pool.topicIds.filter((id) => id !== topic.id),
                      })
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          </div>
        </details>
      )}
    </PoolCard>
  );
}

function PoolSourceFields<T extends {
  source: "all" | "catalog" | "specific";
  catalogId: string | null;
  specificIds: string[];
  language: string | null;
  level: string | null;
}>({
  pool,
  catalogs,
  languages,
  onChange,
}: {
  pool: T;
  catalogs: PracticeOptions["catalogs"];
  languages: string[];
  onChange: (pool: T) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("content_source")}>
        <select
          className={selectClass}
          value={pool.source}
          onChange={(event) =>
            onChange({
              ...pool,
              source: event.target.value as T["source"],
              catalogId: null,
              specificIds: [],
            })
          }
        >
          <option value="all">{t("global_pool")}</option>
          <option value="catalog">{t("from_catalog")}</option>
          <option value="specific">{t("choose_specific")}</option>
        </select>
      </Field>

      {pool.source === "catalog" && (
        <Field label={t("catalog")}>
          <select
            className={selectClass}
            value={pool.catalogId ?? ""}
            onChange={(event) =>
              onChange({
                ...pool,
                catalogId: event.target.value || null,
              })
            }
          >
            <option value="">{t("choose_catalog")}</option>
            {flattenCatalogs(catalogs).map((catalog) => (
              <option key={catalog.id} value={catalog.id}>
                {"— ".repeat(catalog.depth)}
                {catalog.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={t("language")}>
        <select
          className={selectClass}
          value={pool.language ?? ""}
          onChange={(event) =>
            onChange({
              ...pool,
              language: event.target.value || null,
            })
          }
        >
          <option value="">{t("all")}</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("level")}>
        <select
          className={selectClass}
          value={pool.level ?? ""}
          onChange={(event) =>
            onChange({
              ...pool,
              level: event.target.value || null,
            })
          }
        >
          <option value="">{t("all")}</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function CatalogAvailability({
  count,
}: {
  count: number | null;
}) {
  const { t } = useI18n();
  if (count == null) return null;
  return (
    <div
      className={
        "rounded-md border px-3 py-2 text-xs " +
        (count > 0
          ? "border-border bg-muted/20 text-muted-foreground"
          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100")
      }
    >
      {count > 0
        ? `${t("available_in_catalog")}: ${count}`
        : t("no_active_content_in_catalog")}
    </div>
  );
}

function SpecificPicker({
  rows,
  selected,
  onChange,
}: {
  rows: Array<{ id: string; label: string; meta: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const visible = needle
    ? rows.filter(
        (row) =>
          row.label.toLocaleLowerCase().includes(needle) ||
          row.meta.toLocaleLowerCase().includes(needle),
      )
    : rows;

  return (
    <div className="rounded-md border border-border">
      <div className="space-y-2 border-b border-border p-2">
        <div className="px-1 text-xs font-medium">
          {t("selected_count")}: {selected.length}
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("search")}
        />
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            {rows.length === 0 ? t("no_active_content") : t("no_results")}
          </div>
        ) : (
          visible.map((row) => (
            <label
              key={row.id}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-muted/40"
            >
              <Checkbox
                className="mt-0.5"
                checked={selected.includes(row.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block line-clamp-2 text-sm">
                  {row.label}
                </span>
                {row.meta && (
                  <span className="block text-xs text-muted-foreground">
                    {row.meta}
                  </span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function PoolCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-start gap-3 border-b border-border pb-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function VocabularyExamCard({
  item,
  index,
  total,
  value,
  feedback,
  busy,
  showCheck,
  onChange,
  onCheck,
}: {
  item: SelfPracticeVocabularyItem;
  index: number;
  total: number;
  value: string;
  feedback?: VocabularyFeedback;
  busy: boolean;
  showCheck: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 text-xs text-muted-foreground">
        {index + 1} / {total} ·{" "}
        {item.direction === "word_to_translation"
          ? t("word_to_translation")
          : t("translation_to_word")}
      </div>
      <div className="mb-3 text-lg font-semibold">{item.prompt}</div>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("type_answer")}
        disabled={!!feedback}
      />
      {showCheck && !feedback && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={busy || !value.trim()}
            onClick={onCheck}
          >
            {t("check")}
          </Button>
        </div>
      )}
      {feedback && (
        <div
          className={
            "mt-3 rounded-md border p-3 text-sm " +
            (feedback.correct
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30")
          }
        >
          <div className="font-medium">
            {feedback.correct ? t("correct") : t("incorrect")}
          </div>
          {!feedback.correct && (
            <div className="mt-1 text-xs">
              {t("correct_answer")}: {feedback.expected.join(" / ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function SummaryCell({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-background p-4">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function requestedForPool(pool: {
  source: "all" | "catalog" | "specific";
  count: number;
  specificIds: string[];
}) {
  return pool.source === "specific" ? pool.specificIds.length : pool.count;
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function flattenTopics(
  rows: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    sort_order: number;
  }>,
) {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    byParent.set(row.parent_id, [
      ...(byParent.get(row.parent_id) ?? []),
      row,
    ]);
  }
  const result: Array<(typeof rows)[number] & { depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({ ...row, depth });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const row of rows) {
    if (!seen.has(row.id)) result.push({ ...row, depth: 0 });
  }
  return result;
}

function flattenCatalogs(
  rows: Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>,
) {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    byParent.set(row.parent_id, [
      ...(byParent.get(row.parent_id) ?? []),
      row,
    ]);
  }
  const result: Array<(typeof rows)[number] & { depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({ ...row, depth });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const row of rows) {
    if (!seen.has(row.id)) result.push({ ...row, depth: 0 });
  }
  return result;
}
