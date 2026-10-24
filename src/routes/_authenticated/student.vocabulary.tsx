import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BookType, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  VocabularyPracticeCard,
  type VocabularyPracticeEntry,
} from "@/components/app/VocabularyPracticeCard";
import { listStudentVocabulary } from "@/lib/student-library.functions";
import type { VocabularyPracticeMode } from "@/lib/vocabulary-practice";
import { LEVELS } from "@/lib/question-types";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/vocabulary")({
  head: () => ({
    meta: [
      { title: "Vocabulary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentVocabularyPage,
});

function StudentVocabularyPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [practiceSessionId, setPracticeSessionId] = useState(() =>
    crypto.randomUUID(),
  );
  const [mode, setMode] =
    useState<VocabularyPracticeMode>("flashcard");

  const { data, isFetching } = useQuery({
    queryKey: ["student-vocabulary-library", search, level, page],
    queryFn: () =>
      listStudentVocabulary({
        data: { search, language: "", level, page },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = (data?.rows ?? []) as VocabularyPracticeEntry[];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function moveWord(step: -1 | 1) {
    const next = selectedIndex + step;
    if (next < 0 || next >= rows.length) return;
    setSelectedId(rows[next]!.id);
    setPracticeSessionId(crypto.randomUUID());
  }

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          (target instanceof HTMLElement && (target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable))) {
        return;
      }
      if (event.key === "ArrowRight" && selectedIndex < rows.length - 1) {
        event.preventDefault();
        moveWord(1);
      }
      if (event.key === "ArrowLeft" && selectedIndex > 0) {
        event.preventDefault();
        moveWord(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selectedIndex, rows]);


  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("vocabulary")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("vocabulary_library_hint")}
          </p>
        </div>
        <Button asChild>
          <Link to="/student/practice" search={{ focus: "vocabulary" }}>
            <Play className="h-4 w-4" />
            {t("test_yourself")}
          </Link>
        </Button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_220px]">
        <Input
          value={search}
          placeholder={t("search")}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <select
          value={level}
          onChange={(event) => {
            setLevel(event.target.value);
            setPage(0);
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t("all")} — {t("level")}</option>
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as VocabularyPracticeMode)
          }
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
      </div>

      <div className="overflow-hidden rounded-md border border-border">
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
                onClick={() => {
                  setPracticeSessionId(crypto.randomUUID());
                  setSelectedId(row.id);
                }}
                className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/30"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <BookType className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.word}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.ipa ? `${row.ipa} · ` : ""}
                    {row.part_of_speech ?? ""}
                    {row.level ? ` · ${row.level}` : ""}
                    {row.translations[0]?.value
                      ? ` · ${row.translations[0].value}`
                      : ""}
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
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

      {selected && (
        <Dialog open onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent
            className="max-h-[92vh] max-w-3xl overflow-y-auto"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={(event) => {
              const touch = event.changedTouches[0];
              const start = touchStart.current;
              touchStart.current = null;
              if (!start || !touch) return;
              const deltaX = touch.clientX - start.x;
              const deltaY = touch.clientY - start.y;
              if (Math.abs(deltaX) >= 70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
                moveWord(deltaX < 0 ? 1 : -1);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("vocabulary")}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3" aria-label={t("vocabulary")}>
              <Button type="button" size="sm" variant="outline"
                disabled={selectedIndex <= 0} onClick={() => moveWord(-1)}
                aria-label={t("back")}>
                <ChevronLeft className="h-4 w-4" /> {t("back")}
              </Button>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {selectedIndex + 1} / {rows.length}
              </span>
              <Button type="button" size="sm" variant="outline"
                disabled={selectedIndex >= rows.length - 1} onClick={() => moveWord(1)}
                aria-label={t("next")}>
                {t("next")} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <VocabularyPracticeCard
              key={`${selected.id}:${practiceSessionId}:${mode}`}
              catalogId={null}
              sessionId={practiceSessionId}
              entry={selected}
              allEntries={rows}
              mode={mode}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
