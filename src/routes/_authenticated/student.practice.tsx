import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Filter, Play, RotateCcw } from "lucide-react";
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
  type SelfPracticeGenerator,
} from "@/lib/self-practice.functions";
import { getWhoAmI } from "@/lib/teacher.functions";
import { LEVELS } from "@/lib/question-types";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

const optionsQuery = queryOptions({
  queryKey: ["self-practice-options"],
  queryFn: () => getSelfPracticeOptions(),
});

const STORAGE_KEY = "fluentforge:self-practice:v1";

type StoredSession = {
  sessionId: string;
  filters: SelfPracticeGenerator;
  questions: PracticeQuestion[];
  readings: StudentReadingPractice[];
  listenings: StudentListeningPractice[];
  responses: Record<string, PracticeResponse>;
};

export const Route = createFileRoute("/_authenticated/student/practice")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(optionsQuery),
  head: () => ({ meta: [{ title: "Self practice" }, { name: "robots", content: "noindex" }] }),
  component: SelfPracticePage,
});

function SelfPracticePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: options } = useSuspenseQuery(optionsQuery);

  const [filters, setFilters] = useState<SelfPracticeGenerator>({
    count: 20,
    readingCount: 0,
    listeningCount: 0,
    language: null,
    level: null,
    types: [],
    topicIds: [],
    catalogId: null,
    sourceFileId: null,
    historyMode: "all",
    excludeAnswered: false,
    feedbackMode: "instant",
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [readings, setReadings] = useState<StudentReadingPractice[]>([]);
  const [listenings, setListenings] = useState<StudentListeningPractice[]>([]);
  const [responses, setResponses] = useState<Record<string, PracticeResponse>>({});
  const [feedback, setFeedback] = useState<Record<string, PracticeFeedback>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
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

  const topicTree = useMemo(() => flattenTopics(options.topics), [options.topics]);
  const catalogTree = useMemo(() => flattenCatalogs(options.catalogs), [options.catalogs]);
  const allQuestions = useMemo(
    () => [
      ...questions,
      ...readings.flatMap(collectContextQuestions),
      ...listenings.flatMap(collectContextQuestions),
    ],
    [questions, readings, listenings],
  );
  const hasGeneratedContent =
    questions.length > 0 || readings.length > 0 || listenings.length > 0;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSession;
        if (
          parsed.sessionId &&
          (Array.isArray(parsed.questions) ||
            Array.isArray(parsed.readings) ||
            Array.isArray(parsed.listenings))
        ) {
          const storedQuestions = parsed.questions ?? [];
          const storedReadings = parsed.readings ?? [];
          const storedListenings = parsed.listenings ?? [];
          if (
            storedQuestions.length ||
            storedReadings.length ||
            storedListenings.length
          ) {
            setSessionId(parsed.sessionId);
            setFilters(parsed.filters);
            setQuestions(storedQuestions);
            setReadings(storedReadings);
            setListenings(storedListenings);
            setResponses(parsed.responses ?? {});
          }
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setResumeChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!resumeChecked || !sessionId || !hasGeneratedContent || summary) return;
    const payload: StoredSession = {
      sessionId,
      filters,
      questions,
      readings,
      listenings,
      responses,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    resumeChecked,
    sessionId,
    filters,
    questions,
    readings,
    listenings,
    responses,
    summary,
    hasGeneratedContent,
  ]);

  function resetSession() {
    setSessionId(null);
    setQuestions([]);
    setReadings([]);
    setListenings([]);
    setResponses({});
    setFeedback({});
    setRevealed({});
    setSummary(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setSummary(null);
    setFeedback({});
    setRevealed({});
    try {
      const result = await generateSelfPractice({ data: filters });
      const nextQuestions = result.questions as PracticeQuestion[];
      const nextReadings =
        result.readings as unknown as StudentReadingPractice[];
      const nextListenings =
        result.listenings as unknown as StudentListeningPractice[];
      if (
        !nextQuestions.length &&
        !nextReadings.length &&
        !nextListenings.length
      ) {
        toast.error(t("no_questions_match"));
        return;
      }
      const nextSessionId = crypto.randomUUID();
      setSessionId(nextSessionId);
      setQuestions(nextQuestions);
      setReadings(nextReadings);
      setListenings(nextListenings);
      setResponses({});
      if (result.generated < result.requested) {
        toast.message(`${t("generated")} ${result.generated} / ${result.requested}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function responseFor(question: PracticeQuestion) {
    return responses[question.id] ?? defaultPracticeResponse(question);
  }

  function updateResponse(question: PracticeQuestion, response: PracticeResponse) {
    setResponses((current) => ({ ...current, [question.id]: response }));
    setFeedback((current) => {
      if (!current[question.id]) return current;
      const next = { ...current };
      delete next[question.id];
      return next;
    });
    setRevealed((current) => ({ ...current, [question.id]: false }));
  }

  async function check(question: PracticeQuestion) {
    if (!sessionId) return;
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyQuestion(null);
    }
  }

  async function finish() {
    if (!sessionId) return;
    const answered = allQuestions.filter((question) => hasPracticeResponse(question, responseFor(question)));
    if (!answered.length) {
      toast.error(t("answer_required"));
      return;
    }
    if (answered.length < allQuestions.length && !confirm(t("finish_with_unanswered_confirm"))) return;

    setFinishing(true);
    try {
      const result = await finishSelfPractice({
        data: {
          sessionId,
          filters,
          alreadyLoggedQuestionIds: Object.keys(feedback),
          presentedQuestionIds: allQuestions.map((question) => question.id),
          answers: answered.map((question) => ({
            questionId: question.id,
            response: responseFor(question),
            duration_ms: 0,
          })),
        },
      });
      setFeedback(Object.fromEntries(result.results.map((row) => [row.question_id, row as PracticeFeedback])));
      setSummary(result.summary);
      localStorage.removeItem(STORAGE_KEY);
      await qc.invalidateQueries({ queryKey: ["practice-progress"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-5">
      <header className="mb-6">
        <Link to="/student" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t("self_practice")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("self_practice_hint")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("mixed_practice_hint")}</p>
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
          <SummaryCell label={t("score")} value={`${round(summary.score)} / ${round(summary.max_score)}`} />
          <SummaryCell
            label={t("accuracy")}
            value={summary.accuracy == null ? "—" : `${Math.round(summary.accuracy * 100)}%`}
          />
        </section>
      )}

      {!hasGeneratedContent ? (
        <form onSubmit={generate} className="space-y-6">
          <section className="rounded-md border border-border p-4">
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">{t("practice_filters")}</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("direct_question_count")}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={filters.count}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      count: Math.max(
                        0,
                        Math.min(100, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
              </Field>

              <Field label={t("reading_count")}>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={filters.readingCount}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      readingCount: Math.max(
                        0,
                        Math.min(20, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
              </Field>

              <Field label={t("listening_count")}>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={filters.listeningCount}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      listeningCount: Math.max(
                        0,
                        Math.min(20, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
              </Field>

              <Field label={t("language")}>
                <select
                  className={selectClass}
                  value={filters.language ?? ""}
                  onChange={(e) => setFilters({ ...filters, language: e.target.value || null })}
                >
                  <option value="">{t("all")}</option>
                  {options.languages.map((language) => <option key={language} value={language}>{language}</option>)}
                </select>
              </Field>

              <Field label={t("level")}>
                <select
                  className={selectClass}
                  value={filters.level ?? ""}
                  onChange={(e) => setFilters({ ...filters, level: e.target.value || null })}
                >
                  <option value="">{t("all")}</option>
                  {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </Field>

              <Field label={t("practice_history_filter")}>
                <select
                  className={selectClass}
                  value={filters.historyMode}
                  onChange={(e) => setFilters({ ...filters, historyMode: e.target.value as SelfPracticeGenerator["historyMode"] })}
                >
                  <option value="all">{t("all_questions")}</option>
                  <option value="mistakes">{t("previous_mistakes")}</option>
                  <option value="unused">{t("unused_questions")}</option>
                </select>
              </Field>

              <Field label={t("catalog")}>
                <select
                  className={selectClass}
                  value={filters.catalogId ?? ""}
                  onChange={(e) => setFilters({ ...filters, catalogId: e.target.value || null })}
                >
                  <option value="">{t("all")}</option>
                  {catalogTree.map((catalog) => (
                    <option key={catalog.id} value={catalog.id}>
                      {"— ".repeat(catalog.depth)}
                      {catalog.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("source")}>
                <select
                  className={selectClass}
                  value={filters.sourceFileId ?? ""}
                  onChange={(e) => setFilters({ ...filters, sourceFileId: e.target.value || null })}
                >
                  <option value="">{t("all")}</option>
                  {options.sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.original_filename}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("feedback_mode")}>
                <select
                  className={selectClass}
                  value={filters.feedbackMode}
                  onChange={(e) => setFilters({ ...filters, feedbackMode: e.target.value as SelfPracticeGenerator["feedbackMode"] })}
                >
                  <option value="instant">{t("instant")}</option>
                  <option value="end">{t("end_of_practice")}</option>
                </select>
              </Field>

              <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
                <Checkbox
                  checked={filters.excludeAnswered}
                  onCheckedChange={(checked) => setFilters({ ...filters, excludeAnswered: !!checked })}
                />
                {t("exclude_answered")}
              </label>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border p-4">
              <h2 className="mb-3 font-semibold">{t("question_types")}</h2>
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {options.questionTypes.map((type) => (
                  <label key={type.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={filters.types.includes(type.id)}
                      onCheckedChange={(checked) =>
                        setFilters({
                          ...filters,
                          types: checked
                            ? [...filters.types, type.id]
                            : filters.types.filter((id) => id !== type.id),
                        })
                      }
                    />
                    {type.label}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("empty_means_all")}</p>
            </div>

            <div className="rounded-md border border-border p-4">
              <h2 className="mb-3 font-semibold">{t("topics")}</h2>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {topicTree.length === 0 && <p className="text-sm text-muted-foreground">{t("no_results")}</p>}
                {topicTree.map((topic) => (
                  <label
                    key={topic.id}
                    className="flex items-start gap-2 text-sm"
                    style={{ paddingLeft: topic.depth * 16 }}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={filters.topicIds.includes(topic.id)}
                      onCheckedChange={(checked) =>
                        setFilters({
                          ...filters,
                          topicIds: checked
                            ? [...filters.topicIds, topic.id]
                            : filters.topicIds.filter((id) => id !== topic.id),
                        })
                      }
                    />
                    {topic.name}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("empty_means_all")}</p>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={generating}>
              <Play className="h-4 w-4" />
              {t("generate_practice")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
            <span>
              {questions.length} {t("questions").toLocaleLowerCase()}
              {" · "}{readings.length} {t("readings").toLocaleLowerCase()}
              {" · "}{listenings.length} {t("listenings").toLocaleLowerCase()}
              {" · "}
              {filters.feedbackMode === "instant" ? t("instant_feedback") : t("feedback_after_finish")}
            </span>
            {resumeChecked && !summary && <span className="text-xs text-muted-foreground">{t("saved_in_browser")}</span>}
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
                  showCheck={filters.feedbackMode === "instant"}
                  onChange={(response) => updateResponse(question, response)}
                  onCheck={() => check(question)}
                  onReveal={() => setRevealed((current) => ({ ...current, [question.id]: true }))}
                />
              </section>
            ))}

            {readings.map((reading) => (
              <StudentReadingBlock
                key={reading.id}
                reading={reading}
                responses={responses}
                feedback={feedback}
                revealed={revealed}
                showCheck={filters.feedbackMode === "instant"}
                busyQuestion={busyQuestion}
                onResponse={(id, response) => {
                  const question = allQuestions.find((row) => row.id === id);
                  if (question) updateResponse(question, response);
                }}
                onCheck={check}
                onReveal={(id) =>
                  setRevealed((current) => ({ ...current, [id]: true }))
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
                showCheck={filters.feedbackMode === "instant"}
                busyQuestion={busyQuestion}
                onResponse={(id, response) => {
                  const question = allQuestions.find((row) => row.id === id);
                  if (question) updateResponse(question, response);
                }}
                onCheck={check}
                onReveal={(id) =>
                  setRevealed((current) => ({ ...current, [id]: true }))
                }
              />
            ))}
          </div>

          <div className="sticky bottom-0 z-10 mt-8 flex justify-end border-t border-border bg-background py-4">
            <Button onClick={finish} disabled={finishing}>
              <CheckCircle2 className="h-4 w-4" />
              {t("finish_practice")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string | number }) {
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

function flattenTopics(rows: Array<{ id: string; name: string; parent_id: string | null; sort_order: number }>) {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    byParent.set(row.parent_id, [...(byParent.get(row.parent_id) ?? []), row]);
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
  for (const row of rows) if (!seen.has(row.id)) result.push({ ...row, depth: 0 });
  return result;
}

function flattenCatalogs(rows: Array<{ id: string; name: string; parent_id: string | null }>) {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    byParent.set(row.parent_id, [...(byParent.get(row.parent_id) ?? []), row]);
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
  for (const row of rows) if (!seen.has(row.id)) result.push({ ...row, depth: 0 });
  return result;
}
