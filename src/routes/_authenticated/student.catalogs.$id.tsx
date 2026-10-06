import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Eye, Headphones, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getWhoAmI } from "@/lib/teacher.functions";
import {
  finishPractice,
  getStudentCatalogPractice,
  submitPracticeAnswer,
  type PracticeResponse,
} from "@/lib/practice.functions";
import { TYPE_BY_ID } from "@/lib/question-types";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

const practiceQuery = (id: string) =>
  queryOptions({
    queryKey: ["student-practice", id],
    queryFn: () => getStudentCatalogPractice({ data: { catalogId: id } }),
  });

export const Route = createFileRoute("/_authenticated/student/catalogs/$id")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(practiceQuery(params.id)),
  head: () => ({ meta: [{ title: "Practice" }, { name: "robots", content: "noindex" }] }),
  component: PracticePage,
});

type PracticeData = Awaited<ReturnType<typeof getStudentCatalogPractice>>;
type PracticeQuestion = {
  id: string;
  question_type: string;
  prompt: string;
  instructions: string | null;
  payload: Record<string, unknown>;
  scoring: unknown;
  grading_mode: string;
  current_version: number;
};

type Feedback = {
  question_id: string;
  question_version: number;
  question_type: string;
  score: number | null;
  max_score: number;
  is_correct: boolean | null;
  needs_review: boolean;
  explanation: string | null;
  answer_key: unknown;
};

function PracticePage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data } = useSuspenseQuery(practiceQuery(id));
  const [sessionId] = useState(() => crypto.randomUUID());
  const [responses, setResponses] = useState<Record<string, PracticeResponse>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [vocabShown, setVocabShown] = useState<Record<string, boolean>>({});
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<{
    answered: number;
    graded: number;
    score: number;
    max_score: number;
    accuracy: number | null;
  } | null>(null);

  const questions = useMemo(() => collectQuestions(data), [data]);
  const feedbackMode = data.catalog.settings.feedback_mode;

  function currentResponse(question: PracticeQuestion) {
    return responses[question.id] ?? defaultResponse(question);
  }

  function updateResponse(questionId: string, response: PracticeResponse) {
    setResponses((prev) => ({ ...prev, [questionId]: response }));
    setFeedback((prev) => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setRevealed((prev) => ({ ...prev, [questionId]: false }));
  }

  async function checkAnswer(question: PracticeQuestion) {
    const response = currentResponse(question);
    if (!hasResponse(question, response)) {
      toast.error(t("answer_required"));
      return;
    }
    setBusyQuestion(question.id);
    try {
      const result = await submitPracticeAnswer({
        data: {
          catalogId: id,
          sessionId,
          answer: {
            questionId: question.id,
            response,
            duration_ms: 0,
          },
        },
      });
      if (!result.deferred && result.result) {
        setFeedback((prev) => ({ ...prev, [question.id]: result.result as Feedback }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyQuestion(null);
    }
  }

  async function finish() {
    const answered = questions.filter((question) => hasResponse(question, currentResponse(question)));
    if (!answered.length) {
      toast.error(t("answer_required"));
      return;
    }

    if (answered.length < questions.length && !confirm(t("finish_with_unanswered_confirm"))) return;

    setFinishing(true);
    try {
      const result = await finishPractice({
        data: {
          catalogId: id,
          sessionId,
          answers: answered.map((question) => ({
            questionId: question.id,
            response: currentResponse(question),
            duration_ms: 0,
          })),
        },
      });
      setFeedback(
        Object.fromEntries(result.results.map((row) => [row.question_id, row as Feedback])),
      );
      setSummary(result.summary);
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
        <h1 className="text-2xl font-bold">{data.catalog.name}</h1>
        {data.catalog.description && <p className="mt-1 text-sm text-muted-foreground">{data.catalog.description}</p>}
        <div className="mt-2 text-xs text-muted-foreground">
          {feedbackMode === "instant" ? t("instant_feedback") : t("feedback_after_finish")}
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

      <div className="space-y-6">
        {data.blocks.length === 0 && (
          <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
            {t("catalog_empty")}
          </div>
        )}

        {data.blocks.map((block) => {
          if (block.kind === "question") {
            const question = block.question as PracticeQuestion;
            return (
              <QuestionCard
                key={block.item_id}
                question={question}
                response={currentResponse(question)}
                feedback={feedback[question.id]}
                revealed={!!revealed[question.id]}
                feedbackMode={feedbackMode}
                busy={busyQuestion === question.id}
                onChange={(response) => updateResponse(question.id, response)}
                onCheck={() => checkAnswer(question)}
                onReveal={() => setRevealed((prev) => ({ ...prev, [question.id]: true }))}
              />
            );
          }

          if (block.kind === "vocabulary") {
            const entry = block.entry;
            const shown = !!vocabShown[entry.id];
            return (
              <section key={block.item_id} className="rounded-md border border-border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("vocabulary")}</div>
                    <h2 className="mt-1 text-2xl font-bold">{entry.word}</h2>
                    {entry.ipa && <div className="text-sm text-muted-foreground">{entry.ipa}</div>}
                    {entry.part_of_speech && <div className="mt-1 text-xs text-muted-foreground">{entry.part_of_speech}</div>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVocabShown((prev) => ({ ...prev, [entry.id]: !shown }))}
                  >
                    {shown ? <RotateCcw className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {shown ? t("hide_meaning") : t("show_meaning")}
                  </Button>
                </div>
                {shown && (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    {entry.translations.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {entry.translations.map((translation) => (
                          <span key={`${translation.language}:${translation.value}`} className="rounded bg-muted px-2 py-1 text-sm">
                            <span className="text-xs text-muted-foreground">{translation.language}: </span>
                            {translation.value}
                          </span>
                        ))}
                      </div>
                    )}
                    {entry.definition && <p className="text-sm">{entry.definition}</p>}
                    {entry.examples.length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {entry.examples.map((example, index) => (
                          <li key={index}>
                            {example.sentence}
                            {example.translation && <span className="text-muted-foreground"> — {example.translation}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          }

          if (block.kind === "reading") {
            return (
              <ReadingBlock
                key={block.item_id}
                reading={block.reading as unknown as ReadingData}
                responses={responses}
                feedback={feedback}
                revealed={revealed}
                feedbackMode={feedbackMode}
                busyQuestion={busyQuestion}
                onResponse={updateResponse}
                onCheck={checkAnswer}
                onReveal={(questionId) => setRevealed((prev) => ({ ...prev, [questionId]: true }))}
              />
            );
          }

          return (
            <ListeningBlock
              key={block.item_id}
              listening={block.listening as unknown as ListeningData}
              responses={responses}
              feedback={feedback}
              revealed={revealed}
              feedbackMode={feedbackMode}
              busyQuestion={busyQuestion}
              onResponse={updateResponse}
              onCheck={checkAnswer}
              onReveal={(questionId) => setRevealed((prev) => ({ ...prev, [questionId]: true }))}
            />
          );
        })}
      </div>

      {feedbackMode === "end" && questions.length > 0 && (
        <div className="sticky bottom-0 mt-8 flex justify-end border-t border-border bg-background py-4">
          <Button onClick={finish} disabled={finishing}>
            <CheckCircle2 className="h-4 w-4" />
            {t("finish_practice")}
          </Button>
        </div>
      )}
    </div>
  );
}

type ReadingData = {
  id: string;
  title: string;
  body: string;
  display_layout: string;
  question_sets: QuestionSetData[];
};

type ListeningData = {
  id: string;
  title: string;
  transcript: string | null;
  playback_rules: {
    max_plays: number | null;
    allow_pause: boolean;
    allow_seek: boolean;
    allow_rewind: boolean;
    show_transcript: boolean;
  };
  media: {
    id: string;
    kind: string;
    external_url: string | null;
    mime_type: string | null;
    duration_seconds: number | null;
  } | null;
  sections: Array<{
    id: string;
    title: string | null;
    start_seconds: number | null;
    end_seconds: number | null;
  }>;
  question_sets: QuestionSetData[];
};

type QuestionSetData = {
  id: string;
  section_id?: string | null;
  title: string | null;
  instructions: string | null;
  questions: PracticeQuestion[];
};

function ReadingBlock(props: {
  reading: ReadingData;
  responses: Record<string, PracticeResponse>;
  feedback: Record<string, Feedback>;
  revealed: Record<string, boolean>;
  feedbackMode: "instant" | "end";
  busyQuestion: string | null;
  onResponse: (id: string, response: PracticeResponse) => void;
  onCheck: (question: PracticeQuestion) => void;
  onReveal: (questionId: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"passage" | "questions">("passage");
  const questions = props.reading.question_sets.flatMap((set) => set.questions);

  const questionArea = (
    <div className="space-y-4">
      {props.reading.question_sets.map((set) => (
        <section key={set.id} className="space-y-3">
          {(set.title || set.instructions) && (
            <div>
              {set.title && <h3 className="font-semibold">{set.title}</h3>}
              {set.instructions && <p className="text-sm text-muted-foreground">{set.instructions}</p>}
            </div>
          )}
          {set.questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              response={props.responses[question.id] ?? defaultResponse(question)}
              feedback={props.feedback[question.id]}
              revealed={!!props.revealed[question.id]}
              feedbackMode={props.feedbackMode}
              busy={props.busyQuestion === question.id}
              onChange={(response) => props.onResponse(question.id, response)}
              onCheck={() => props.onCheck(question)}
              onReveal={() => props.onReveal(question.id)}
            />
          ))}
        </section>
      ))}
      {questions.length === 0 && <p className="text-sm text-muted-foreground">{t("no_questions")}</p>}
    </div>
  );

  if (props.reading.display_layout === "tabbed") {
    return (
      <section className="rounded-md border border-border">
        <div className="border-b border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("reading")}</div>
          <h2 className="text-xl font-bold">{props.reading.title}</h2>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant={tab === "passage" ? "default" : "outline"} onClick={() => setTab("passage")}>{t("passage")}</Button>
            <Button size="sm" variant={tab === "questions" ? "default" : "outline"} onClick={() => setTab("questions")}>{t("questions")}</Button>
          </div>
        </div>
        <div className="p-4">
          {tab === "passage" ? <Passage body={props.reading.body} /> : questionArea}
        </div>
      </section>
    );
  }

  if (props.reading.display_layout === "split") {
    return (
      <section className="rounded-md border border-border p-4">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("reading")}</div>
          <h2 className="text-xl font-bold">{props.reading.title}</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="lg:max-h-[70vh] lg:overflow-y-auto lg:pr-3"><Passage body={props.reading.body} /></div>
          <div>{questionArea}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-md border border-border p-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("reading")}</div>
        <h2 className="text-xl font-bold">{props.reading.title}</h2>
      </div>
      <Passage body={props.reading.body} />
      {questionArea}
    </section>
  );
}

function ListeningBlock(props: {
  listening: ListeningData;
  responses: Record<string, PracticeResponse>;
  feedback: Record<string, Feedback>;
  revealed: Record<string, boolean>;
  feedbackMode: "instant" | "end";
  busyQuestion: string | null;
  onResponse: (id: string, response: PracticeResponse) => void;
  onCheck: (question: PracticeQuestion) => void;
  onReveal: (questionId: string) => void;
}) {
  const { t } = useI18n();
  const [playCount, setPlayCount] = useState(0);
  const max = props.listening.playback_rules.max_plays;
  const blocked = max != null && playCount >= max;

  return (
    <section className="space-y-5 rounded-md border border-border p-4">
      <div>
        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          <Headphones className="h-3.5 w-3.5" />
          {t("listening")}
        </div>
        <h2 className="text-xl font-bold">{props.listening.title}</h2>
      </div>

      {props.listening.media?.external_url ? (
        <div>
          {props.listening.media.kind === "video" ? (
            <video
              className="w-full rounded-md bg-black"
              controls={!blocked}
              src={props.listening.media.external_url}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                setPlayCount((count) => count + 1);
              }}
            />
          ) : (
            <audio
              className="w-full"
              controls={!blocked}
              src={props.listening.media.external_url}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                setPlayCount((count) => count + 1);
              }}
            />
          )}
          {max != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("plays_used")}: {Math.min(playCount, max)} / {max}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("media_not_available")}
        </div>
      )}

      {props.listening.transcript && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("transcript")}</summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{props.listening.transcript}</p>
        </details>
      )}

      {props.listening.sections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {props.listening.sections.map((section, index) => (
            <span key={section.id} className="rounded bg-muted px-2 py-1 text-xs">
              {section.title || `${t("section")} ${index + 1}`}
              {section.start_seconds != null && section.end_seconds != null
                ? ` · ${section.start_seconds}s–${section.end_seconds}s`
                : ""}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {props.listening.question_sets.map((set) => (
          <section key={set.id} className="space-y-3">
            {(set.title || set.instructions) && (
              <div>
                {set.title && <h3 className="font-semibold">{set.title}</h3>}
                {set.instructions && <p className="text-sm text-muted-foreground">{set.instructions}</p>}
              </div>
            )}
            {set.questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                response={props.responses[question.id] ?? defaultResponse(question)}
                feedback={props.feedback[question.id]}
                revealed={!!props.revealed[question.id]}
                feedbackMode={props.feedbackMode}
                busy={props.busyQuestion === question.id}
                onChange={(response) => props.onResponse(question.id, response)}
                onCheck={() => props.onCheck(question)}
                onReveal={() => props.onReveal(question.id)}
              />
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function QuestionCard({
  question,
  response,
  feedback,
  revealed,
  feedbackMode,
  busy,
  onChange,
  onCheck,
  onReveal,
}: {
  question: PracticeQuestion;
  response: PracticeResponse;
  feedback?: Feedback;
  revealed: boolean;
  feedbackMode: "instant" | "end";
  busy: boolean;
  onChange: (response: PracticeResponse) => void;
  onCheck: () => void;
  onReveal: () => void;
}) {
  const { t } = useI18n();
  const def = TYPE_BY_ID[question.question_type];

  return (
    <div className="rounded-md border border-border p-4">
      {question.instructions && <p className="mb-2 text-xs text-muted-foreground">{question.instructions}</p>}
      <p className="mb-4 font-medium">{question.prompt}</p>

      <QuestionAnswer question={question} response={response} onChange={onChange} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {feedbackMode === "instant" && (
          <Button size="sm" onClick={onCheck} disabled={busy}>
            {t("check_answer")}
          </Button>
        )}
        {feedback && (
          <>
            <span className={feedback.is_correct ? "text-sm font-medium text-success" : "text-sm font-medium text-destructive"}>
              {feedback.needs_review
                ? t("needs_review")
                : feedback.is_correct
                  ? t("correct")
                  : `${t("score")}: ${round(feedback.score ?? 0)} / ${round(feedback.max_score)}`}
            </span>
            <Button size="sm" variant="outline" onClick={onReveal}>
              <Eye className="h-4 w-4" />
              {t("show_answer")}
            </Button>
          </>
        )}
      </div>

      {feedback && feedback.explanation && (
        <div className="mt-3 rounded-md bg-muted p-3 text-sm">
          <strong>{t("explanation")}:</strong> {feedback.explanation}
        </div>
      )}

      {feedback && revealed && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <strong>{t("correct_answer")}:</strong>
          <div className="mt-1">{formatAnswerKey(feedback.answer_key, question)}</div>
        </div>
      )}

      {!def && <p className="mt-2 text-xs text-destructive">{t("unsupported_question_type")}</p>}
    </div>
  );
}

function QuestionAnswer({
  question,
  response,
  onChange,
}: {
  question: PracticeQuestion;
  response: PracticeResponse;
  onChange: (response: PracticeResponse) => void;
}) {
  const def = TYPE_BY_ID[question.question_type];
  const payload = question.payload ?? {};

  if (!def) return null;

  if (def.editor === "choice" || def.editor === "fixed_choice") {
    const options = Array.isArray(payload["options"])
      ? (payload["options"] as Array<string | { id: string; text: string }>)
      : [];
    const normalized = options.map((option) =>
      typeof option === "string" ? { id: option, text: option } : option,
    );
    const selected = response.selected ?? [];

    return (
      <div className="space-y-2">
        {normalized.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={checked}
                onCheckedChange={(value) => {
                  if (def.multiple) {
                    onChange({
                      selected: value
                        ? [...new Set([...selected, option.id])]
                        : selected.filter((id) => id !== option.id),
                    });
                  } else {
                    onChange({ selected: value ? [option.id] : [] });
                  }
                }}
              />
              <span>{option.text}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (def.editor === "text") {
    const count = Math.max(1, Number(payload["blank_count"] ?? 1));
    const answers = response.answers ?? Array.from({ length: count }, () => "");
    return (
      <div className="space-y-2">
        {Array.from({ length: count }, (_, index) => (
          <Input
            key={index}
            value={answers[index] ?? ""}
            placeholder={count > 1 ? `${index + 1}` : undefined}
            onChange={(e) => {
              const next = Array.from({ length: count }, (_, i) => answers[i] ?? "");
              next[index] = e.target.value;
              onChange({ answers: next });
            }}
          />
        ))}
      </div>
    );
  }

  if (def.editor === "matching") {
    const leftItems = Array.isArray(payload["left_items"]) ? (payload["left_items"] as string[]) : [];
    const rightOptions = Array.isArray(payload["right_options"]) ? (payload["right_options"] as string[]) : [];
    const pairs = response.pairs ?? leftItems.map((left) => ({ left, right: "" }));
    return (
      <div className="space-y-2">
        {leftItems.map((left, index) => {
          const pair = pairs.find((x) => x.left === left) ?? { left, right: "" };
          return (
            <div key={`${left}:${index}`} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-md border border-border px-3 py-2 text-sm">{left}</div>
              <span className="text-muted-foreground">→</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={pair.right}
                onChange={(e) => {
                  const next = leftItems.map((item) => {
                    const existing = pairs.find((x) => x.left === item);
                    return { left: item, right: item === left ? e.target.value : existing?.right ?? "" };
                  });
                  onChange({ pairs: next });
                }}
              >
                <option value="">—</option>
                {rightOptions.map((right) => <option key={right} value={right}>{right}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    );
  }

  if (def.editor === "ordering") {
    const items = response.order ?? (Array.isArray(payload["items"]) ? (payload["items"] as string[]) : []);
    return (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item}:${index}`} className="flex items-center gap-2 rounded-md border border-border p-2">
            <span className="w-6 text-sm text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1 text-sm">{item}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={index === 0}
              onClick={() => {
                const next = [...items];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                onChange({ order: next });
              }}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={index === items.length - 1}
              onClick={() => {
                const next = [...items];
                [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                onChange({ order: next });
              }}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Textarea
      rows={6}
      value={response.text ?? ""}
      onChange={(e) => onChange({ text: e.target.value })}
    />
  );
}

function Passage({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-7">{body}</div>;
}

function defaultResponse(question: PracticeQuestion): PracticeResponse {
  const def = TYPE_BY_ID[question.question_type];
  if (!def) return {};
  if (def.editor === "choice" || def.editor === "fixed_choice") return { selected: [] };
  if (def.editor === "text") {
    const count = Math.max(1, Number(question.payload?.["blank_count"] ?? 1));
    return { answers: Array.from({ length: count }, () => "") };
  }
  if (def.editor === "matching") {
    const leftItems = Array.isArray(question.payload?.["left_items"])
      ? (question.payload["left_items"] as string[])
      : [];
    return { pairs: leftItems.map((left) => ({ left, right: "" })) };
  }
  if (def.editor === "ordering") {
    return {
      order: Array.isArray(question.payload?.["items"]) ? [...(question.payload["items"] as string[])] : [],
    };
  }
  return { text: "" };
}

function hasResponse(question: PracticeQuestion, response: PracticeResponse) {
  const def = TYPE_BY_ID[question.question_type];
  if (!def) return false;
  if (def.editor === "choice" || def.editor === "fixed_choice") return (response.selected?.length ?? 0) > 0;
  if (def.editor === "text") return (response.answers ?? []).some((answer) => answer.trim().length > 0);
  if (def.editor === "matching") return (response.pairs ?? []).some((pair) => pair.right.trim().length > 0);
  if (def.editor === "ordering") return (response.order?.length ?? 0) > 0;
  return (response.text?.trim().length ?? 0) > 0;
}

function collectQuestions(data: PracticeData): PracticeQuestion[] {
  const questions: PracticeQuestion[] = [];
  for (const block of data.blocks) {
    if (block.kind === "question") {
      questions.push(block.question as PracticeQuestion);
    } else if (block.kind === "reading") {
      const reading = block.reading as unknown as ReadingData;
      questions.push(...reading.question_sets.flatMap((set) => set.questions));
    } else if (block.kind === "listening") {
      const listening = block.listening as unknown as ListeningData;
      questions.push(...listening.question_sets.flatMap((set) => set.questions));
    }
  }
  return questions;
}

function formatAnswerKey(value: unknown, question: PracticeQuestion) {
  if (!value || typeof value !== "object") return "—";
  const answer = value as Record<string, unknown>;
  const def = TYPE_BY_ID[question.question_type];

  if (def?.editor === "choice" || def?.editor === "fixed_choice") {
    const correct = Array.isArray(answer["correct"]) ? (answer["correct"] as string[]) : [];
    const options = Array.isArray(question.payload["options"])
      ? (question.payload["options"] as Array<string | { id: string; text: string }>)
      : [];
    const labels = correct.map((id) => {
      const option = options.find((candidate) =>
        typeof candidate === "string" ? candidate === id : candidate.id === id,
      );
      return typeof option === "string" ? option : option?.text ?? id;
    });
    return labels.join(", ") || "—";
  }

  if (def?.editor === "text") {
    const blanks = Array.isArray(answer["blanks"]) ? (answer["blanks"] as string[][]) : [];
    return blanks.map((choices, index) => `${index + 1}. ${choices.join(" / ")}`).join(" · ") || "—";
  }

  if (def?.editor === "matching") {
    const pairs = Array.isArray(answer["pairs"])
      ? (answer["pairs"] as Array<{ left: string; right: string }>)
      : [];
    return pairs.map((pair) => `${pair.left} → ${pair.right}`).join(" · ") || "—";
  }

  if (def?.editor === "ordering") {
    const order = Array.isArray(answer["order"]) ? (answer["order"] as string[]) : [];
    return order.join(" → ") || "—";
  }

  return typeof answer["model_answer"] === "string" ? answer["model_answer"] : "—";
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
