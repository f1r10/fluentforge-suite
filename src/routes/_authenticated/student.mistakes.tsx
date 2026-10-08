import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BookType, Play, RotateCcw, XCircle } from "lucide-react";
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
  type PracticeFeedback,
  type PracticeQuestion,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import {
  VocabularyPracticeCard,
  type VocabularyPracticeEntry,
} from "@/components/app/VocabularyPracticeCard";
import { getMyMistakes } from "@/lib/student-insights.functions";
import { submitSelfPracticeAnswer } from "@/lib/self-practice.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/mistakes")({
  component: StudentMistakesPage,
  head: () => ({
    meta: [
      { title: "Mistakes" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type Mistakes = Awaited<ReturnType<typeof getMyMistakes>>;
type QuestionMistake = Mistakes["questions"][number];

function StudentMistakesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [question, setQuestion] = useState<QuestionMistake | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyPracticeEntry | null>(
    null,
  );
  const [vocabularySessionId, setVocabularySessionId] = useState(() =>
    crypto.randomUUID(),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["my-mistakes"],
    queryFn: () => getMyMistakes(),
  });

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">
        …
      </div>
    );
  }

  const total = data.questions.length + data.vocabulary.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">{t("my_mistakes")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("mistakes_hint")}
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center">
          <RotateCcw className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 font-medium">{t("no_current_mistakes")}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("no_current_mistakes_hint")}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-md border border-border">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">
                {t("questions")} ({data.questions.length})
              </h2>
            </div>
            {data.questions.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                {t("no_results")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.questions.map((item) => (
                  <div
                    key={item.question.id}
                    className="flex items-start gap-3 p-4"
                  >
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {item.question.prompt}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.question.level ?? "—"} ·{" "}
                        {formatDateTime(item.lastWrongAt, lang)}
                      </div>
                    </div>
                    {item.context?.kind === "reading" ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/student/readings/$id"
                          params={{ id: item.context.id }}
                        >
                          <Play className="h-4 w-4" />
                          {t("practice_again")}
                        </Link>
                      </Button>
                    ) : item.context?.kind === "listening" ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/student/listenings/$id"
                          params={{ id: item.context.id }}
                        >
                          <Play className="h-4 w-4" />
                          {t("practice_again")}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setQuestion(item)}
                      >
                        <Play className="h-4 w-4" />
                        {t("practice_again")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-md border border-border">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">
                {t("vocabulary")} ({data.vocabulary.length})
              </h2>
            </div>
            {data.vocabulary.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                {t("no_results")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.vocabulary.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 p-4">
                    <BookType className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{entry.word}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {entry.translations.map((row) => row.value).join(" · ")}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setVocabularySessionId(crypto.randomUUID());
                        setVocabulary(entry as VocabularyPracticeEntry);
                      }}
                    >
                      <Play className="h-4 w-4" />
                      {t("practice_again")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {question && (
        <QuestionRetryDialog
          item={question}
          onClose={() => setQuestion(null)}
          onCorrect={async () => {
            setQuestion(null);
            await qc.invalidateQueries({ queryKey: ["my-mistakes"] });
          }}
        />
      )}

      {vocabulary && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setVocabulary(null);
              void qc.invalidateQueries({ queryKey: ["my-mistakes"] });
            }
          }}
        >
          <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("practice_again")}</DialogTitle>
            </DialogHeader>
            <VocabularyPracticeCard
              catalogId={null}
              sessionId={vocabularySessionId}
              entry={vocabulary}
              allEntries={
                data.vocabulary as unknown as VocabularyPracticeEntry[]
              }
              mode="translation_recall"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function QuestionRetryDialog({
  item,
  onClose,
  onCorrect,
}: {
  item: QuestionMistake;
  onClose: () => void;
  onCorrect: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [sessionId] = useState(() => crypto.randomUUID());
  const question = item.question as PracticeQuestion;
  const [response, setResponse] = useState<PracticeResponse>(() =>
    defaultPracticeResponse(question),
  );
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
          answer: {
            questionId: question.id,
            response,
            duration_ms: 0,
          },
        },
      });
      const next = result.result as PracticeFeedback;
      setFeedback(next);
      if (next.is_correct === true) {
        window.setTimeout(() => {
          void onCorrect();
        }, 700);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("practice_again")}</DialogTitle>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
