import { createFileRoute } from "@tanstack/react-router";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import {
  BookmarkPlus,
  BookOpen,
  Search,
  Trash2,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteStudentPersonalWord,
  listStudentPersonalWords,
  lookupStudentWord,
  saveStudentPersonalWord,
  type StudentWordLookupResult,
} from "@/lib/student-word-search.functions";
import { useContentLanguages } from "@/lib/content-languages";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/word-search")({
  head: () => ({
    meta: [
      { title: "Word search" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentWordSearchPage,
});

function StudentWordSearchPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const languages = useContentLanguages();
  const [word, setWord] = useState("");
  const [learningLanguage, setLearningLanguage] = useState("en");
  const [result, setResult] =
    useState<StudentWordLookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSearch, setSavedSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data: personal, isFetching } = useQuery({
    queryKey: ["student-personal-vocabulary", savedSearch, page],
    queryFn: () =>
      listStudentPersonalWords({
        data: { search: savedSearch, page },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = personal?.rows ?? [];
  const pageSize = personal?.pageSize ?? 50;
  const total = personal?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function lookup(event?: React.FormEvent) {
    event?.preventDefault();
    const clean = word.trim();
    if (!clean) return;

    setLookingUp(true);
    try {
      const found = await lookupStudentWord({
        data: {
          word: clean,
          learningLanguage,
        },
      });
      setResult(found);
    } catch (error) {
      toast.error(readUiError(error, "Dictionary lookup failed."));
    } finally {
      setLookingUp(false);
    }
  }

  async function saveResult() {
    if (!result) return;
    setSaving(true);
    try {
      const {
        saved: _saved,
        savedId: _savedId,
        ...payload
      } = result;
      const saved = await saveStudentPersonalWord({ data: payload });
      setResult((current) =>
        current
          ? {
              ...current,
              saved: true,
              savedId: saved.id,
            }
          : current,
      );
      await qc.invalidateQueries({
        queryKey: ["student-personal-vocabulary"],
      });
      toast.success(t("saved_to_my_dictionary"));
    } catch (error) {
      toast.error(readUiError(error, "Could not save this word."));
    } finally {
      setSaving(false);
    }
  }

  async function removeWord(id: string) {
    try {
      await deleteStudentPersonalWord({ data: { id } });
      if (result?.savedId === id) {
        setResult({ ...result, saved: false, savedId: null });
      }
      await qc.invalidateQueries({
        queryKey: ["student-personal-vocabulary"],
      });
      toast.success(t("removed_from_my_dictionary"));
    } catch (error) {
      toast.error(readUiError(error, "Could not remove this word."));
    }
  }

  async function reopenSaved(
    savedWord: string,
    savedLanguage: string,
  ) {
    setWord(savedWord);
    setLearningLanguage(savedLanguage);
    setLookingUp(true);
    try {
      const found = await lookupStudentWord({
        data: {
          word: savedWord,
          learningLanguage: savedLanguage,
        },
      });
      setResult(found);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error(readUiError(error, "Dictionary lookup failed."));
    } finally {
      setLookingUp(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t("word_search")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("word_search_hint")}
        </p>
      </header>

      <form
        className="grid gap-2 rounded-md border border-border p-4 sm:grid-cols-[1fr_220px_auto]"
        onSubmit={lookup}
      >
        <Input
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder={t("search_for_a_word")}
          autoComplete="off"
          autoFocus
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={learningLanguage}
          onChange={(event) => setLearningLanguage(event.target.value)}
        >
          {(languages.learning.length
            ? languages.learning
            : [{ code: "en", label: "English (en)" }]
          ).map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={lookingUp || !word.trim()}>
          <Search className="h-4 w-4" />
          {lookingUp ? "…" : t("search_word")}
        </Button>
      </form>

      {result && (
        <DictionaryResult
          result={result}
          saving={saving}
          onSave={() => void saveResult()}
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("my_dictionary")}</h2>
            <p className="text-xs text-muted-foreground">
              {total} {t("items").toLocaleLowerCase()}
            </p>
          </div>
          <Input
            className="w-full sm:w-64"
            value={savedSearch}
            onChange={(event) => {
              setSavedSearch(event.target.value);
              setPage(0);
            }}
            placeholder={t("search")}
          />
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_saved_words")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => {
                const translations = Array.isArray(row.translations)
                  ? (row.translations as Array<Record<string, unknown>>)
                  : [];
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 p-3"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left hover:underline"
                      onClick={() =>
                        void reopenSaved(
                          row.word,
                          row.learning_language,
                        )
                      }
                    >
                      <div className="font-medium">{row.word}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[row.ipa, row.part_of_speech, row.level]
                          .filter(Boolean)
                          .join(" · ")}
                        {translations.length > 0
                          ? ` · ${translations
                              .slice(0, 3)
                              .map((item) => String(item["value"] ?? ""))
                              .filter(Boolean)
                              .join(" · ")}`
                          : ""}
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("remove_from_my_dictionary")}
                      onClick={() => void removeWord(row.id)}
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
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              ←
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              →
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function DictionaryResult({
  result,
  saving,
  onSave,
}: {
  result: StudentWordLookupResult;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="space-y-5 rounded-md border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-2xl font-bold">{result.word}</h2>
            {result.part_of_speech && (
              <span className="text-sm text-muted-foreground">
                {result.part_of_speech}
              </span>
            )}
            {result.level && (
              <span className="rounded border border-border px-2 py-0.5 text-xs">
                {result.level}
              </span>
            )}
          </div>
          {result.ipa && (
            <div className="mt-1 text-sm text-muted-foreground">
              {result.ipa}
            </div>
          )}
          {result.level_estimate && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("automatic_level")}: {result.level ?? "—"} ·{" "}
              {Math.round(result.level_estimate.confidence * 100)}%
            </div>
          )}
        </div>
        <Button onClick={onSave} disabled={saving}>
          <BookmarkPlus className="h-4 w-4" />
          {saving
            ? "…"
            : result.saved
              ? t("update_my_dictionary")
              : t("add_to_my_dictionary")}
        </Button>
      </div>

      {result.pronunciations.some((item) => item.ipa || item.audio) && (
        <DetailBlock title={t("pronunciation")}>
          <div className="flex flex-wrap gap-2">
            {result.pronunciations
              .filter((item) => item.ipa || item.audio)
              .slice(0, 6)
              .map((item, index) => (
                <div
                  key={`${item.ipa ?? ""}:${item.audio ?? ""}:${index}`}
                  className="rounded-md border border-border p-2 text-xs"
                >
                  <div className="flex items-center gap-1">
                    <Volume2 className="h-3.5 w-3.5" />
                    {item.region ? `${item.region} · ` : ""}
                    {item.ipa || "audio"}
                  </div>
                  {item.audio && (
                    <audio
                      controls
                      preload="none"
                      src={item.audio}
                      className="mt-2 h-7 max-w-60"
                    />
                  )}
                </div>
              ))}
          </div>
        </DetailBlock>
      )}

      {result.definition && (
        <DetailBlock title={t("definition")}>
          <p className="text-sm leading-6">{result.definition}</p>
        </DetailBlock>
      )}

      {result.translations.length > 0 && (
        <DetailBlock title={t("translations")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.translations.map((item) => (
              <div
                key={item.language}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="mr-2 text-xs font-medium uppercase text-muted-foreground">
                  {item.language}
                </span>
                {item.value}
              </div>
            ))}
          </div>
        </DetailBlock>
      )}

      {(result.synonyms.length > 0 || result.antonyms.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <DetailBlock title={t("synonyms")}>
            <TagList values={result.synonyms} />
          </DetailBlock>
          <DetailBlock title={t("antonyms")}>
            <TagList values={result.antonyms} />
          </DetailBlock>
        </div>
      )}

      {result.forms.length > 0 && (
        <DetailBlock title={t("word_forms")}>
          <div className="flex flex-wrap gap-2">
            {result.forms.slice(0, 30).map((item, index) => (
              <span
                key={`${item.form}:${index}`}
                className="rounded-md border border-border px-2 py-1 text-xs"
              >
                {item.form}
                {item.tags.length
                  ? ` · ${item.tags.join(", ")}`
                  : ""}
              </span>
            ))}
          </div>
        </DetailBlock>
      )}

      {result.examples.length > 0 && (
        <DetailBlock title={t("examples")}>
          <div className="space-y-2">
            {result.examples.map((item, index) => (
              <div
                key={`${item.sentence}:${index}`}
                className="rounded-md bg-muted/30 px-3 py-2 text-sm"
              >
                <div>{item.sentence}</div>
                {item.translation && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.translation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DetailBlock>
      )}

      {result.source && (
        <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          {t("source")}: {result.source.name}
          {result.source.license ? ` · ${result.source.license}` : ""}
        </div>
      )}
    </section>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function TagList({ values }: { values: string[] }) {
  if (!values.length) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-md bg-muted px-2 py-1 text-xs"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function readUiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const value = String(error ?? "").trim();
  return value && value !== "[object Object]" ? value : fallback;
}
