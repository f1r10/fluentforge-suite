import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Headphones } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getWhoAmI } from "@/lib/teacher.functions";
import {
  finishPractice,
  getStudentCatalogPractice,
  submitPracticeAnswer,
} from "@/lib/practice.functions";
import {
  PracticeQuestionCard,
  defaultPracticeResponse,
  hasPracticeResponse,
  type PracticeFeedback,
  type PracticeQuestion,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import { supabase } from "@/integrations/supabase/client";
import {
  VocabularyPracticeCard,
  type VocabularyPracticeEntry,
} from "@/components/app/VocabularyPracticeCard";
import type { VocabularyPracticeMode } from "@/lib/vocabulary-practice";
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

function PracticePage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data } = useSuspenseQuery(practiceQuery(id));
  const [sessionId] = useState(() => crypto.randomUUID());
  const [responses, setResponses] = useState<Record<string, PracticeResponse>>({});
  const [feedback, setFeedback] = useState<Record<string, PracticeFeedback>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [vocabularyMode, setVocabularyMode] = useState<VocabularyPracticeMode>("flashcard");
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
  const vocabularyEntries = useMemo(() => collectVocabulary(data), [data]);
  const feedbackMode = data.catalog.settings.feedback_mode;

  function currentResponse(question: PracticeQuestion) {
    return responses[question.id] ?? defaultPracticeResponse(question);
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
    if (!hasPracticeResponse(question, response)) {
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
        setFeedback((prev) => ({ ...prev, [question.id]: result.result as PracticeFeedback }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyQuestion(null);
    }
  }

  async function finish() {
    const answered = questions.filter((question) => hasPracticeResponse(question, currentResponse(question)));
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
          presentedQuestionIds: questions.map((question) => question.id),
          answers: answered.map((question) => ({
            questionId: question.id,
            response: currentResponse(question),
            duration_ms: 0,
          })),
        },
      });
      setFeedback(
        Object.fromEntries(result.results.map((row) => [row.question_id, row as PracticeFeedback])),
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

      {vocabularyEntries.length > 0 && (
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
          <div>
            <div className="text-sm font-medium">{t("vocabulary_practice_mode")}</div>
            <div className="text-xs text-muted-foreground">
              {t("vocabulary_practice_mode_hint")}
            </div>
          </div>
          <select
            value={vocabularyMode}
            onChange={(event) =>
              setVocabularyMode(event.target.value as VocabularyPracticeMode)
            }
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="flashcard">{t("flashcards")}</option>
            <option value="translation_recall">{t("translation_recall")}</option>
            <option value="reverse_recall">{t("reverse_translation")}</option>
            <option value="multiple_choice">{t("multiple_choice_practice")}</option>
          </select>
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
              <PracticeQuestionCard
                key={block.item_id}
                question={question}
                response={currentResponse(question)}
                feedback={feedback[question.id]}
                revealed={!!revealed[question.id]}
                showCheck={feedbackMode === "instant"}
                busy={busyQuestion === question.id}
                onChange={(response) => updateResponse(question.id, response)}
                onCheck={() => checkAnswer(question)}
                onReveal={() => setRevealed((prev) => ({ ...prev, [question.id]: true }))}
              />
            );
          }

          if (block.kind === "vocabulary") {
            const entry = block.entry as VocabularyPracticeEntry;
            return (
              <VocabularyPracticeCard
                key={block.item_id}
                catalogId={id}
                sessionId={sessionId}
                entry={entry}
                allEntries={vocabularyEntries}
                mode={vocabularyMode}
              />
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
                showCheck={feedbackMode === "instant"}
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
              showCheck={feedbackMode === "instant"}
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
  feedback: Record<string, PracticeFeedback>;
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
            <PracticeQuestionCard
              key={question.id}
              question={question}
              response={props.responses[question.id] ?? defaultPracticeResponse(question)}
              feedback={props.feedback[question.id]}
              revealed={!!props.revealed[question.id]}
              showCheck={props.feedbackMode === "instant"}
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
  feedback: Record<string, PracticeFeedback>;
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
              <PracticeQuestionCard
                key={question.id}
                question={question}
                response={props.responses[question.id] ?? defaultPracticeResponse(question)}
                feedback={props.feedback[question.id]}
                revealed={!!props.revealed[question.id]}
                showCheck={props.feedbackMode === "instant"}
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

function Passage({ body }: { body: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-7">{body}</div>;
}

function collectVocabulary(data: PracticeData): VocabularyPracticeEntry[] {
  return data.blocks.flatMap((block) =>
    block.kind === "vocabulary"
      ? [block.entry as VocabularyPracticeEntry]
      : [],
  );
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
