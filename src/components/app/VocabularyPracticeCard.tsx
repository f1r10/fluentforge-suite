import { CheckCircle2, Eye, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitVocabularyPracticeAnswer } from "@/lib/practice.functions";
import type {
  VocabularyLearnerState,
  VocabularyPracticeMode,
} from "@/lib/vocabulary-practice";
import { useI18n } from "@/lib/i18n";

export type VocabularyPracticeEntry = {
  id: string;
  word: string;
  definition: string | null;
  ipa: string | null;
  part_of_speech: string | null;
  learning_language: string | null;
  level: string | null;
  translations: Array<{ language: string; value: string }>;
  examples: Array<{ sentence: string; translation: string | null }>;
  learner_state: {
    state: VocabularyLearnerState;
    correct_count: number;
    incorrect_count: number;
    correct_streak: number;
    last_result: boolean | null;
    last_mode: string | null;
    last_practiced_at: string | null;
  };
};

type Feedback = Awaited<ReturnType<typeof submitVocabularyPracticeAnswer>>;

export function VocabularyPracticeCard({
  catalogId,
  sessionId,
  entry,
  allEntries,
  mode,
}: {
  catalogId: string;
  sessionId: string;
  entry: VocabularyPracticeEntry;
  allEntries: VocabularyPracticeEntry[];
  mode: VocabularyPracticeMode;
}) {
  const { t, lang } = useI18n();
  const [response, setResponse] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(entry.learner_state);
  const startedAt = useRef(Date.now());

  const target =
    entry.translations.find((translation) => translation.language === lang) ??
    entry.translations[0] ??
    null;

  const options = useMemo(() => {
    if (!target) return [];
    const correct = target.value;
    const candidates = allEntries
      .filter((candidate) => candidate.id !== entry.id)
      .flatMap((candidate) => {
        const translation =
          candidate.translations.find(
            (item) => item.language === target.language,
          ) ?? candidate.translations[0];
        return translation?.value ? [translation.value] : [];
      })
      .filter(
        (value, index, array) =>
          value !== correct && array.indexOf(value) === index,
      )
      .sort((a, b) => seededRank(entry.id, a) - seededRank(entry.id, b))
      .slice(0, 3);

    return [correct, ...candidates].sort(
      (a, b) => seededRank(`${entry.id}:options`, a) - seededRank(`${entry.id}:options`, b),
    );
  }, [allEntries, entry.id, target]);

  const prompt =
    mode === "reverse_recall" && target
      ? target.value
      : entry.word;

  async function submitAnswer() {
    if (mode === "flashcard") return;
    if (!response.trim()) {
      toast.error(t("answer_required"));
      return;
    }
    setBusy(true);
    try {
      const result = await submitVocabularyPracticeAnswer({
        data: {
          catalogId,
          sessionId,
          entryId: entry.id,
          mode,
          response,
          targetLanguage: target?.language ?? null,
          rating: null,
          duration_ms: Date.now() - startedAt.current,
        },
      });
      setFeedback(result);
      setState(result.learner_state);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function rate(rating: "known" | "learning") {
    setBusy(true);
    try {
      const result = await submitVocabularyPracticeAnswer({
        data: {
          catalogId,
          sessionId,
          entryId: entry.id,
          mode: "flashcard",
          response: "",
          targetLanguage: target?.language ?? null,
          rating,
          duration_ms: Date.now() - startedAt.current,
        },
      });
      setFeedback(result);
      setState(result.learner_state);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setResponse("");
    setFeedback(null);
    setRevealed(false);
    startedAt.current = Date.now();
  }

  return (
    <section className="rounded-md border border-border p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("vocabulary")} · {t(`vocabulary_${state.state}`)}
          </div>
          <h2 className="mt-1 text-2xl font-bold">{prompt}</h2>
          {mode !== "reverse_recall" && entry.ipa && (
            <div className="text-sm text-muted-foreground">{entry.ipa}</div>
          )}
          {entry.part_of_speech && (
            <div className="mt-1 text-xs text-muted-foreground">
              {entry.part_of_speech}
            </div>
          )}
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs">
          {state.correct_count} ✓ · {state.incorrect_count} ✕
        </span>
      </div>

      {mode === "flashcard" ? (
        <>
          {!revealed ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevealed(true)}
            >
              <Eye className="h-4 w-4" />
              {t("show_meaning")}
            </Button>
          ) : (
            <div className="space-y-4">
              <Meaning entry={entry} />
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => rate("learning")}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("still_learning")}
                </Button>
                <Button type="button" disabled={busy} onClick={() => rate("known")}>
                  <CheckCircle2 className="h-4 w-4" />
                  {t("i_know_this")}
                </Button>
              </div>
              {feedback && (
                <p className="text-sm text-muted-foreground">
                  {t("saved_as")}: {t(`vocabulary_${state.state}`)}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {mode === "reverse_recall" && (
            <p className="text-xs text-muted-foreground">
              {t("type_original_word")}
            </p>
          )}
          {mode === "translation_recall" && (
            <p className="text-xs text-muted-foreground">
              {target
                ? `${t("type_translation")} · ${target.language}`
                : t("no_translation_available")}
            </p>
          )}

          {mode === "multiple_choice" ? (
            target && options.length >= 2 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={response === option ? "default" : "outline"}
                    className="h-auto min-h-10 whitespace-normal text-left"
                    disabled={!!feedback || busy}
                    onClick={() => setResponse(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("not_enough_vocabulary_choices")}
              </p>
            )
          ) : (
            <Input
              value={response}
              disabled={!!feedback || busy || (mode === "translation_recall" && !target)}
              placeholder={
                mode === "reverse_recall"
                  ? t("type_word")
                  : t("type_translation")
              }
              onChange={(event) => setResponse(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitAnswer();
                }
              }}
            />
          )}

          {!feedback && (
            <Button
              type="button"
              onClick={submitAnswer}
              disabled={
                busy ||
                !response.trim() ||
                (mode === "translation_recall" && !target) ||
                (mode === "multiple_choice" && options.length < 2)
              }
            >
              {t("check_answer")}
            </Button>
          )}

          {feedback && (
            <div
              className={[
                "rounded-md border p-3 text-sm",
                feedback.correct
                  ? "border-success/40"
                  : "border-destructive/40",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 font-medium">
                {feedback.correct ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {feedback.correct ? t("correct") : t("incorrect")}
              </div>
              {!feedback.correct && feedback.expected.length > 0 && (
                <div className="mt-2">
                  <span className="text-muted-foreground">
                    {t("expected_answer")}:
                  </span>{" "}
                  {feedback.expected.join(" / ")}
                </div>
              )}
              <div className="mt-3">
                <Meaning entry={entry} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={retry}
              >
                <RotateCcw className="h-4 w-4" />
                {t("try_again")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Meaning({ entry }: { entry: VocabularyPracticeEntry }) {
  return (
    <div className="space-y-3">
      {entry.translations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.translations.map((translation) => (
            <span
              key={`${translation.language}:${translation.value}`}
              className="rounded bg-muted px-2 py-1 text-sm"
            >
              <span className="text-xs text-muted-foreground">
                {translation.language}:{" "}
              </span>
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
              {example.translation && (
                <span className="text-muted-foreground">
                  {" "}
                  — {example.translation}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function seededRank(seed: string, value: string) {
  let hash = 2166136261;
  const input = `${seed}:${value}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
