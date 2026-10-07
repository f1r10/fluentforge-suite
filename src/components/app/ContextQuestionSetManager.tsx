import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Link2,
  Pencil,
  Plus,
  Search,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  linkQuestionToContext,
  listContextQuestions,
  reorderContextQuestions,
  searchContextQuestionCandidates,
  unlinkQuestionFromContext,
} from "@/lib/context-content.functions";
import { QUESTION_TYPES, TYPE_BY_ID } from "@/lib/question-types";
import { QuestionEditor } from "@/components/app/QuestionEditor";
import type { TopicRow } from "@/components/app/topics";
import { useI18n } from "@/lib/i18n";

type Kind = "reading" | "listening";

export function ContextQuestionSetManager({
  kind,
  questionSetId,
  topics,
  initialCreateOpen = false,
  createRequest = 0,
}: {
  kind: Kind;
  questionSetId: string;
  topics: TopicRow[];
  initialCreateOpen?: boolean;
  createRequest?: number;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (createRequest > 0) setCreateOpen(true);
  }, [createRequest]);

  const queryKey = ["context-questions", kind, questionSetId] as const;
  const { data: rows = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      listContextQuestions({
        data: { kind, questionSetId },
      }),
  });

  async function refresh() {
    await qc.invalidateQueries({ queryKey });
    await qc.invalidateQueries({ queryKey: ["questions"] });
  }

  async function attach(questionId: string) {
    try {
      await linkQuestionToContext({
        data: { questionId, kind, questionSetId },
      });
      await refresh();
      toast.success(t("question_linked_to_set"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function detach(questionId: string) {
    if (!confirm(t("unlink_question_confirm"))) return;
    try {
      await unlinkQuestionFromContext({ data: { questionId } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length || moving) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];

    setMoving(true);
    try {
      await reorderContextQuestions({
        data: {
          kind,
          questionSetId,
          questionIds: next.map((row) => row.id),
        },
      });
      qc.setQueryData(queryKey, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      await refresh();
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("questions_in_set")}</div>
          <div className="text-xs text-muted-foreground">
            {t("context_question_set_hint")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPickerOpen(true)}
          >
            <Link2 className="h-4 w-4" />
            {t("add_existing_question")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("create_question_here")}
          </Button>
        </div>
      </div>

      {isFetching && rows.length === 0 ? (
        <div className="py-4 text-sm text-muted-foreground">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("no_questions_in_set")}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="flex items-start gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">
                  {row.prompt}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {TYPE_BY_ID[row.question_type]?.label ?? row.question_type}
                  {" · "}
                  {t(row.status)}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={moving || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t("move_up")}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={moving || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t("move_down")}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  asChild
                >
                  <Link
                    to="/teacher/questions/$id"
                    params={{ id: row.id }}
                    aria-label={t("edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => detach(row.id)}
                  aria-label={t("unlink")}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateOpen(false);
          }}
        >
          <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("create_question_here")}</DialogTitle>
            </DialogHeader>
            <QuestionEditor
              topics={topics}
              onSaved={async (questionId, options) => {
                await attach(questionId);
                if (!options.next) setCreateOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {pickerOpen && (
        <ContextQuestionPicker
          kind={kind}
          questionSetId={questionSetId}
          existingIds={new Set(rows.map((row) => row.id))}
          onClose={() => setPickerOpen(false)}
          onAttach={attach}
        />
      )}
    </div>
  );
}

function ContextQuestionPicker({
  kind,
  questionSetId,
  existingIds,
  onClose,
  onAttach,
}: {
  kind: Kind;
  questionSetId: string;
  existingIds: Set<string>;
  onClose: () => void;
  onAttach: (questionId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: [
      "context-question-candidates",
      kind,
      questionSetId,
      search,
      type,
      page,
    ],
    queryFn: () =>
      searchContextQuestionCandidates({
        data: { search, type, page },
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function attach(questionId: string) {
    setBusyId(questionId);
    try {
      await onAttach(questionId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("add_existing_question")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              className="pl-9"
              placeholder={t("search")}
            />
          </div>
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
        </div>

        <div className="max-h-[58vh] overflow-y-auto rounded-md border border-border">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_results")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => {
                const alreadyHere = existingIds.has(row.id);
                const linkedElsewhere =
                  row.context_kind !== "none" && !alreadyHere;
                return (
                  <div
                    key={row.id}
                    className="flex items-start gap-3 p-3"
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
                        {linkedElsewhere
                          ? ` · ${t("linked_to_other_context")}`
                          : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={alreadyHere ? "outline" : "default"}
                      disabled={alreadyHere || busyId === row.id}
                      onClick={() => {
                        if (
                          linkedElsewhere &&
                          !confirm(t("move_question_context_confirm"))
                        ) {
                          return;
                        }
                        void attach(row.id);
                      }}
                    >
                      {alreadyHere ? t("already_added") : t("add")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              ←
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              →
            </Button>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
