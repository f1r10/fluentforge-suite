import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Filter, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  getStudentQuestionPractice,
  listStudentQuestions,
} from "@/lib/student-library.functions";
import { submitSelfPracticeAnswer } from "@/lib/self-practice.functions";
import { LEVELS, QUESTION_TYPES, TYPE_BY_ID } from "@/lib/question-types";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/questions")({
  head: () => ({
    meta: [
      { title: "Question Bank" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentQuestionsPage,
});

function StudentQuestionsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["student-question-library", search, type, level, page],
    queryFn: () =>
      listStudentQuestions({
        data: { search, type, level, language: "", page },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("browse_questions")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("question_bank_hint_student")}
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_220px_140px]">
        <Input
          value={search}
          placeholder={t("search")}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("type")}</option>
          {QUESTION_TYPES.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={level}
          onChange={(event) => {
            setLevel(event.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("level")}</option>
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {total} {t("questions").toLocaleLowerCase()}
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isFetching ? "…" : t("no_active_content")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <button
                type="button"
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium">
                    {row.prompt}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {TYPE_BY_ID[row.question_type]?.label ?? row.question_type}
                    {row.level ? ` · ${row.level}` : ""}
                    {row.learning_language
                      ? ` · ${row.learning_language}`
                      : ""}
                  </div>
                </div>
                <Play className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {page + 1} / {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            →
          </Button>
        </div>
      </div>

      {selectedId && (
        <QuestionPracticeDialog
          questionId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function QuestionPracticeDialog({
  questionId,
  onClose,
}: {
  questionId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: question, isLoading } = useQuery({
    queryKey: ["student-question-practice", questionId],
    queryFn: () => getStudentQuestionPractice({ data: { id: questionId } }),
  });
  const [sessionId] = useState(() => crypto.randomUUID());
  const [response, setResponse] = useState<PracticeResponse>({});
  const [feedback, setFeedback] = useState<PracticeFeedback | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check() {
    if (!question) return;
    const typed = question as PracticeQuestion;
    if (!hasPracticeResponse(typed, response)) {
      toast.error(t("answer_required"));
      return;
    }

    setBusy(true);
    try {
      const result = await submitSelfPracticeAnswer({
        data: {
          sessionId,
          practiceKind: "question_bank",
          contextId: questionId,
          answer: {
            questionId,
            response,
            duration_ms: 0,
          },
        },
      });
      setFeedback(result.result as PracticeFeedback);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const typed = question as PracticeQuestion | undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("practice_this_question")}</DialogTitle>
        </DialogHeader>
        {isLoading || !typed ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            …
          </div>
        ) : (
          <PracticeQuestionCard
            question={typed}
            response={
              Object.keys(response).length
                ? response
                : defaultPracticeResponse(typed)
            }
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
        )}
      </DialogContent>
    </Dialog>
  );
}
