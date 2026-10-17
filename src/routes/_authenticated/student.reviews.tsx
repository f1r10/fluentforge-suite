import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarClock, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PracticeQuestionCard,
  defaultPracticeResponse,
  hasPracticeResponse,
  type PracticeQuestion,
  type PracticeFeedback,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import {
  VocabularyPracticeCard,
  type VocabularyPracticeEntry,
} from "@/components/app/VocabularyPracticeCard";
import { getMyDueReviews, type DueReviewItem } from "@/lib/due-reviews.functions";
import { getStudentQuestionPractice } from "@/lib/student-library.functions";
import { submitSelfPracticeAnswer } from "@/lib/self-practice.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews due" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DueReviewsPage,
});

function DueReviewsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["due-reviews"],
    queryFn: () => getMyDueReviews(),
  });
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyPracticeEntry | null>(null);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
  function open(row: DueReviewItem) {
    if (row.kind === "question") {
      setQuestionId(row.id);
    } else if (row.vocabulary) {
      setSessionId(crypto.randomUUID());
      setVocabulary(row.vocabulary);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t("reviews_due")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("reviews_due_hint")}</p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : !data?.items.length ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">{t("no_reviews_due")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("no_reviews_due_hint")}</p>
        </div>
      ) : (
        <section className="divide-y rounded-md border">
          {data.items.map((item) => (
            <div key={item.kind + ":" + item.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.kind === "question" ? t("questions") : t("vocabulary")} · {item.level ?? "—"}
                </p>
              </div>
              {item.context?.kind === "reading" ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/student/readings/$id" params={{ id: item.context.id }}>
                    <Play className="h-4 w-4" aria-hidden />{t("review_now")}
                  </Link>
                </Button>
              ) : item.context?.kind === "listening" ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/student/listenings/$id" params={{ id: item.context.id }}>
                    <Play className="h-4 w-4" aria-hidden />{t("review_now")}
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => open(item)}>
                  <Play className="h-4 w-4" aria-hidden />{t("review_now")}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {questionId && (
        <QuestionReviewModal
          key={questionId}
          id={questionId}
          onClose={() => { setQuestionId(null); void refresh(); }}
        />
      )}
      {vocabulary && (
        <Dialog
          open
          onOpenChange={(opened) => {
            if (!opened) { setVocabulary(null); void refresh(); }
          }}
        >
          <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
            <DialogHeader><DialogTitle>{t("review_now")}</DialogTitle></DialogHeader>
            <VocabularyPracticeCard
              catalogId={null}
              sessionId={sessionId}
              entry={vocabulary}
              allEntries={data?.items.flatMap((row) => row.vocabulary ? [row.vocabulary] : []) ?? []}
              mode="translation_recall"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function QuestionReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["due-question", id],
    queryFn: () => getStudentQuestionPractice({ data: { id } }),
  });
  return (
    <Dialog open onOpenChange={(opened) => { if (!opened) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t("review_now")}</DialogTitle></DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : data ? (
          <GradeDueQuestion question={data as PracticeQuestion} onCorrect={onClose} />
        ) : (
          <p>{t("no_results")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GradeDueQuestion({
  question, onCorrect,
}: {
  question: PracticeQuestion;
  onCorrect: () => void;
}) {
  const { t } = useI18n();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [response, setResponse] = useState<PracticeResponse>(() => defaultPracticeResponse(question));
  const [feedback, setFeedback] = useState<PracticeFeedback | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!hasPracticeResponse(question, response)) {
      toast.error(t("answer_required"));
      return;
    }
    setBusy(true);
    try {
      const result = await submitSelfPracticeAnswer({
        data: {
          sessionId,
          practiceKind: "self",
          contextId: null,
          answer: { questionId: question.id, response, duration_ms: 0 },
        },
      });
      setFeedback(result.result as PracticeFeedback);
      if (result.result.is_correct === true) {
        window.setTimeout(onCorrect, 800);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PracticeQuestionCard
      question={question}
      response={response}
      feedback={feedback}
      revealed={revealed}
      busy={busy}
      showCheck
      onChange={(value) => {
        setResponse(value);
        setFeedback(undefined);
        setRevealed(false);
      }}
      onCheck={check}
      onReveal={() => setRevealed(true)}
    />
  );
}
