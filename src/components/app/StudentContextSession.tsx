import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
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
  submitSelfPracticeAnswer,
} from "@/lib/self-practice.functions";
import { useI18n } from "@/lib/i18n";

type Props =
  | {
      kind: "reading";
      data: StudentReadingPractice;
    }
  | {
      kind: "listening";
      data: StudentListeningPractice;
    };

export function StudentContextSession(props: Props) {
  const { t } = useI18n();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [responses, setResponses] = useState<
    Record<string, PracticeResponse>
  >({});
  const [feedback, setFeedback] = useState<
    Record<string, PracticeFeedback>
  >({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<{
    answered: number;
    graded: number;
    score: number;
    max_score: number;
    accuracy: number | null;
  } | null>(null);

  const questions = useMemo(
    () => collectContextQuestions(props.data),
    [props.data],
  );

  function responseFor(question: PracticeQuestion) {
    return (
      responses[question.id] ?? defaultPracticeResponse(question)
    );
  }

  function updateResponse(
    questionId: string,
    response: PracticeResponse,
  ) {
    setResponses((current) => ({
      ...current,
      [questionId]: response,
    }));
    setFeedback((current) => {
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setRevealed((current) => ({
      ...current,
      [questionId]: false,
    }));
  }

  async function check(question: PracticeQuestion) {
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
          practiceKind: props.kind,
          contextId: props.data.id,
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
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyQuestion(null);
    }
  }

  async function finish() {
    const answered = questions.filter((question) =>
      hasPracticeResponse(question, responseFor(question)),
    );
    if (!answered.length) {
      toast.error(t("answer_required"));
      return;
    }
    if (
      answered.length < questions.length &&
      !confirm(t("finish_with_unanswered_confirm"))
    ) {
      return;
    }

    setFinishing(true);
    try {
      const result = await finishSelfPractice({
        data: {
          sessionId,
          practiceKind: props.kind,
          contextId: props.data.id,
          filters: {
            sessionMode: "practice",
            durationMinutes: 30,
            feedbackMode: "instant",
            questions: {
              source: "all",
              catalogId: null,
              specificIds: [],
              language: null,
              level: null,
              count: 0,
              types: [],
              topicIds: [],
              sourceFileId: null,
              historyMode: "all",
              excludeAnswered: false,
            },
            vocabulary: {
              source: "all",
              catalogId: null,
              specificIds: [],
              language: null,
              level: null,
              count: 0,
              direction: "word_to_translation",
              translationLanguage: "az",
            },
            readings: {
              source: props.kind === "reading" ? "specific" : "all",
              catalogId: null,
              specificIds:
                props.kind === "reading" ? [props.data.id] : [],
              language: null,
              level: null,
              count: 0,
            },
            listenings: {
              source: props.kind === "listening" ? "specific" : "all",
              catalogId: null,
              specificIds:
                props.kind === "listening" ? [props.data.id] : [],
              language: null,
              level: null,
              count: 0,
            },
          },
          alreadyLoggedQuestionIds: Object.keys(feedback),
          presentedQuestionIds: questions.map(
            (question) => question.id,
          ),
          answers: answered.map((question) => ({
            questionId: question.id,
            response: responseFor(question),
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
      setSummary(result.summary);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setFinishing(false);
    }
  }

  const common = {
    responses,
    feedback,
    revealed,
    showCheck: true,
    busyQuestion,
    onResponse: updateResponse,
    onCheck: check,
    onReveal: (questionId: string) =>
      setRevealed((current) => ({
        ...current,
        [questionId]: true,
      })),
  };

  return (
    <div className="space-y-5">
      {summary && (
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
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

      {props.kind === "reading" ? (
        <StudentReadingBlock reading={props.data} {...common} />
      ) : (
        <StudentListeningBlock listening={props.data} {...common} />
      )}

      {questions.length > 0 && (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-background py-4">
          <Button onClick={finish} disabled={finishing}>
            <CheckCircle2 className="h-4 w-4" />
            {t("finish_practice")}
          </Button>
        </div>
      )}
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

function round(value: number) {
  return Math.round(value * 100) / 100;
}
