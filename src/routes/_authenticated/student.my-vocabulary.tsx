import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Eye,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteStudentPersonalWord,
  listStudentPersonalWords,
  submitStudentPersonalWordPractice,
} from "@/lib/student-word-search.functions";
import type { VocabularyPracticeMode } from "@/lib/vocabulary-practice";
import { LEVELS } from "@/lib/question-types";
import { useContentLanguages } from "@/lib/content-languages";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute(
  "/_authenticated/student/my-vocabulary",
)({
  head: () => ({
    meta: [
      { title: "My dictionary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentMyVocabularyPage,
});

const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "determiner",
  "interjection",
  "modal verb",
  "phrasal verb",
];

type PersonalWord = Awaited<
  ReturnType<typeof listStudentPersonalWords>
>["rows"][number];

type PracticeFeedback = {
  correct: boolean;
  expected: string[];
} | null;

function StudentMyVocabularyPage() {
  const { t, lang } = useI18n();
  const languages = useContentLanguages();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState("");
  const [page, setPage] = useState(0);
  const [mode, setMode] =
    useState<VocabularyPracticeMode>("translation_recall");
  const [practiceCount, setPracticeCount] = useState("10");
  const [practiceIds, setPracticeIds] = useState<string[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<PracticeFeedback>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState({ correct: 0, answered: 0 });

  const { data, isFetching } = useQuery({
    queryKey: [
      "student-personal-vocabulary",
      search,
      language,
      level,
      partOfSpeech,
      page,
    ],
    queryFn: () =>
      listStudentPersonalWords({
        data: {
          search,
          language,
          level,
          partOfSpeech,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rowMap = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );
  const current =
    practiceIds.length > 0
      ? rowMap.get(practiceIds[practiceIndex] ?? "") ?? null
      : null;

  const currentTranslation = current
    ? preferredTranslation(current, lang)
    : null;

  const multipleChoiceOptions = useMemo(() => {
    if (!current || !currentTranslation) return [];
    const correct = currentTranslation.value;
    const distractors = rows
      .filter((row) => row.id !== current.id)
      .flatMap((row) => {
        const translation = preferredTranslation(
          row,
          currentTranslation.language,
        );
        return translation?.value ? [translation.value] : [];
      })
      .filter(
        (value, index, array) =>
          value !== correct && array.indexOf(value) === index,
      )
      .sort((a, b) =>
        seededRank(current.id, a) - seededRank(current.id, b),
      )
      .slice(0, 3);
    return [correct, ...distractors].sort(
      (a, b) =>
        seededRank(`${current.id}:personal-options`, a) -
        seededRank(`${current.id}:personal-options`, b),
    );
  }, [current, currentTranslation, rows]);

  function createPractice() {
    const candidates = rows.filter((row) => {
      if (mode === "flashcard") return true;
      return translations(row).length > 0;
    });
    if (!candidates.length) {
      toast.error(t("no_saved_words"));
      return;
    }
    const count = Math.max(
      1,
      Math.min(Number(practiceCount) || 10, candidates.length),
    );
    setPracticeIds(
      shuffle(candidates.map((row) => row.id)).slice(0, count),
    );
    setPracticeIndex(0);
    setResponse("");
    setFeedback(null);
    setRevealed(false);
    setScore({ correct: 0, answered: 0 });
  }

  async function checkAnswer() {
    if (!current || mode === "flashcard") return;
    if (!response.trim()) {
      toast.error(t("answer_required"));
      return;
    }
    setBusy(true);
    try {
      const result = await submitStudentPersonalWordPractice({
        data: {
          id: current.id,
          mode:
            mode === "multiple_choice"
              ? "multiple_choice"
              : mode === "reverse_recall"
                ? "reverse_recall"
                : "translation_recall",
          response,
          targetLanguage: currentTranslation?.language ?? null,
        },
      });
      setFeedback(result);
      setScore((value) => ({
        correct: value.correct + (result.correct ? 1 : 0),
        answered: value.answered + 1,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function nextPractice() {
    if (practiceIndex + 1 >= practiceIds.length) {
      setPracticeIds([]);
      setPracticeIndex(0);
      return;
    }
    setPracticeIndex((value) => value + 1);
    setResponse("");
    setFeedback(null);
    setRevealed(false);
  }

  async function removeWord(id: string) {
    try {
      await deleteStudentPersonalWord({ data: { id } });
      setPracticeIds((currentIds) =>
        currentIds.filter((value) => value !== id),
      );
      await qc.invalidateQueries({
        queryKey: ["student-personal-vocabulary"],
      });
      toast.success(t("removed_from_my_dictionary"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("my_dictionary")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {t("items").toLocaleLowerCase()}
          </p>
        </div>
      </header>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="grid gap-2 md:grid-cols-4">
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
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              setPage(0);
            }}
          >
            <option value="">
              {t("language")}: {t("all")}
            </option>
            {(languages.learning.length
              ? languages.learning
              : languages.all
            ).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
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
            <option value="">
              {t("level")}: {t("all")}
            </option>
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={partOfSpeech}
            onChange={(event) => {
              setPartOfSpeech(event.target.value);
              setPage(0);
            }}
          >
            <option value="">
              {t("part_of_speech")}: {t("all")}
            </option>
            {PARTS_OF_SPEECH.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_140px_auto]">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as VocabularyPracticeMode)
            }
          >
            <option value="flashcard">{t("flashcards")}</option>
            <option value="translation_recall">
              {t("translation_recall")}
            </option>
            <option value="reverse_recall">
              {t("reverse_translation")}
            </option>
            <option value="multiple_choice">
              {t("multiple_choice_practice")}
            </option>
          </select>
          <Input
            type="number"
            min={1}
            max={50}
            value={practiceCount}
            onChange={(event) => setPracticeCount(event.target.value)}
            aria-label={t("vocabulary_count")}
          />
          <Button type="button" onClick={createPractice}>
            <Play className="h-4 w-4" />
            {t("create")}
          </Button>
        </div>
      </section>

      {practiceIds.length > 0 && current && (
        <PersonalPracticeCard
          word={current}
          index={practiceIndex}
          total={practiceIds.length}
          mode={mode}
          translation={currentTranslation}
          options={multipleChoiceOptions}
          response={response}
          feedback={feedback}
          revealed={revealed}
          busy={busy}
          score={score}
          onResponse={setResponse}
          onReveal={() => setRevealed(true)}
          onCheck={() => void checkAnswer()}
          onNext={nextPractice}
        />
      )}

      <div className="overflow-hidden rounded-md border border-border">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isFetching ? "…" : t("no_saved_words")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => {
              const translation = preferredTranslation(row, lang);
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-3 p-4"
                >
                  <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{row.word}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.ipa ? `${row.ipa} · ` : ""}
                      {row.part_of_speech ?? ""}
                      {row.level ? ` · ${row.level}` : ""}
                      {translation?.value
                        ? ` · ${translation.value}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => void removeWord(row.id)}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm">
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
    </div>
  );
}

function PersonalPracticeCard({
  word,
  index,
  total,
  mode,
  translation,
  options,
  response,
  feedback,
  revealed,
  busy,
  score,
  onResponse,
  onReveal,
  onCheck,
  onNext,
}: {
  word: PersonalWord;
  index: number;
  total: number;
  mode: VocabularyPracticeMode;
  translation: { language: string; value: string } | null;
  options: string[];
  response: string;
  feedback: PracticeFeedback;
  revealed: boolean;
  busy: boolean;
  score: { correct: number; answered: number };
  onResponse: (value: string) => void;
  onReveal: () => void;
  onCheck: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const prompt =
    mode === "reverse_recall" && translation
      ? translation.value
      : word.word;

  return (
    <section className="space-y-4 rounded-md border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            {index + 1} / {total}
          </div>
          <h2 className="mt-1 text-2xl font-bold">{prompt}</h2>
          {word.ipa && mode !== "reverse_recall" && (
            <div className="text-sm text-muted-foreground">{word.ipa}</div>
          )}
        </div>
        <div className="rounded-md bg-muted px-2 py-1 text-xs">
          {score.correct} ✓ / {score.answered}
        </div>
      </div>

      {mode === "flashcard" ? (
        <>
          {!revealed ? (
            <Button type="button" variant="outline" onClick={onReveal}>
              <Eye className="h-4 w-4" />
              {t("show_meaning")}
            </Button>
          ) : (
            <div className="space-y-3">
              <Meaning word={word} />
              <Button type="button" onClick={onNext}>
                {t("next")}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {mode === "multiple_choice" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={response === option ? "default" : "outline"}
                  className="h-auto min-h-10 whitespace-normal"
                  disabled={!!feedback || busy}
                  onClick={() => onResponse(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : (
            <Input
              value={response}
              disabled={!!feedback || busy}
              placeholder={
                mode === "reverse_recall"
                  ? t("type_word")
                  : t("type_translation")
              }
              onChange={(event) => onResponse(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !feedback) {
                  event.preventDefault();
                  onCheck();
                }
              }}
            />
          )}

          {!feedback ? (
            <Button
              type="button"
              disabled={
                busy ||
                !response.trim() ||
                (mode === "multiple_choice" && options.length < 2)
              }
              onClick={onCheck}
            >
              {t("check_answer")}
            </Button>
          ) : (
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
              {!feedback.correct && (
                <div className="mt-2">
                  {t("expected_answer")}: {feedback.expected.join(" / ")}
                </div>
              )}
              <div className="mt-3">
                <Meaning word={word} />
              </div>
              <Button type="button" className="mt-3" onClick={onNext}>
                {index + 1 >= total ? t("finish") : t("next")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Meaning({ word }: { word: PersonalWord }) {
  const values = translations(word);
  return (
    <div className="space-y-2 text-sm">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((item) => (
            <span
              key={`${item.language}:${item.value}`}
              className="rounded bg-muted px-2 py-1"
            >
              {item.language}: {item.value}
            </span>
          ))}
        </div>
      )}
      {word.definition && <p>{word.definition}</p>}
      {word.part_of_speech && (
        <p className="text-xs text-muted-foreground">
          {word.part_of_speech}
          {word.level ? ` · ${word.level}` : ""}
        </p>
      )}
    </div>
  );
}

function translations(word: PersonalWord) {
  return Array.isArray(word.translations)
    ? (word.translations as Array<Record<string, unknown>>).flatMap(
        (item) => {
          const language =
            typeof item["language"] === "string" ? item["language"] : "";
          const value =
            typeof item["value"] === "string" ? item["value"] : "";
          return language && value ? [{ language, value }] : [];
        },
      )
    : [];
}

function preferredTranslation(word: PersonalWord, language: string) {
  const values = translations(word);
  return (
    values.find(
      (item) =>
        item.language.toLowerCase() === language.toLowerCase(),
    ) ??
    values[0] ??
    null
  );
}

function shuffle<T>(input: T[]) {
  const output = [...input];
  for (let index = output.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [output[index], output[target]] = [
      output[target]!,
      output[index]!,
    ];
  }
  return output;
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
