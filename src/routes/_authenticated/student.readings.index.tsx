import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listStudentReadings } from "@/lib/student-library.functions";
import { LEVELS } from "@/lib/question-types";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/readings/")({
  head: () => ({
    meta: [
      { title: "Readings" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentReadingsPage,
});

function StudentReadingsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["student-reading-library", search, level, page],
    queryFn: () =>
      listStudentReadings({
        data: { search, language: "", level, page },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 30;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("reading_library")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("reading_library_hint")}
          </p>
        </div>
        <Button asChild>
          <Link to="/student/practice" search={{ focus: "readings" }}>
            <Play className="h-4 w-4" />
            {t("test_yourself")}
          </Link>
        </Button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px]">
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
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isFetching ? "…" : t("no_active_content")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <Link
                key={row.id}
                to="/student/readings/$id"
                params={{ id: row.id }}
                className="flex items-start gap-3 p-4 hover:bg-muted/30"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.word_count ?? 0} {t("word_count").toLocaleLowerCase()}
                    {" · "}
                    {row.question_sets} {t("content_question_sets").toLocaleLowerCase()}
                    {row.level ? ` · ${row.level}` : ""}
                    {row.learning_language
                      ? ` · ${row.learning_language}`
                      : ""}
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
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
    </div>
  );
}
