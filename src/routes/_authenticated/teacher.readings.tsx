import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, FileUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listTopics } from "@/lib/questions.functions";
import {
  deleteContextQuestionSet,
  getReading,
  getReadingStudentPreview,
  listReadings,
  saveReading,
  saveReadingQuestionSet,
} from "@/lib/context-content.functions";
import { LEVELS } from "@/lib/question-types";
import { trashContextContent } from "@/lib/trash.functions";
import { topicOptions } from "@/components/app/topics";
import { useI18n } from "@/lib/i18n";
import { useContentLanguages } from "@/lib/content-languages";
import { ContextQuestionSetManager } from "@/components/app/ContextQuestionSetManager";
import { addCatalogItems } from "@/lib/catalog.functions";
import { CatalogTargetSelect } from "@/components/app/CatalogTargetSelect";
import {
  ContextActivityStudentPreview,
  type StudentReadingPractice,
} from "@/components/app/StudentContextPractice";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

type Status = "active" | "draft" | "archived" | "all";
type QuestionSet = { id?: string; title: string; instructions: string; sort_order: number };
type EditorState = {
  id?: string;
  title: string;
  body: string;
  learning_language: string;
  level: string;
  status: "active" | "draft" | "archived";
  display_layout: "stacked" | "split" | "tabbed";
  topicIds: string[];
  tags: string;
  questionSets: QuestionSet[];
};

const emptyEditor = (learningLanguage = ""): EditorState => ({
  title: "",
  body: "",
  learning_language: learningLanguage,
  level: "",
  status: "active",
  display_layout: "stacked",
  topicIds: [],
  tags: "",
  questionSets: [],
});

export const Route = createFileRoute("/_authenticated/teacher/readings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  component: ReadingsPage,
});

function ReadingsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const languages = useContentLanguages();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const topicOpts = topicOptions(topics);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [catalogTarget, setCatalogTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<
    Awaited<ReturnType<typeof getReadingStudentPreview>> | null
  >(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [autoCreateSetId, setAutoCreateSetId] = useState<string | null>(null);
  const [questionCreateRequest, setQuestionCreateRequest] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["readings", search, language, level, status, page],
    queryFn: () => listReadings({ data: { search, language, level, status, page } }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function openEdit(id: string) {
    setAutoCreateSetId(null);
    setCatalogTarget("");
    setQuestionCreateRequest(0);
    try {
      const row = await getReading({ data: { id } });
      setEditor({
        id: row.id,
        title: row.title,
        body: row.body,
        learning_language:
          row.learning_language ?? languages.defaultLearningCode,
        level: row.level ?? "",
        status: row.status,
        display_layout: (row.display_layout as EditorState["display_layout"]) ?? "stacked",
        topicIds: row.topicIds,
        tags: row.tags.join(", "),
        questionSets: row.questionSets.map((x) => ({
          id: x.id,
          title: x.title ?? "",
          instructions: x.instructions ?? "",
          sort_order: x.sort_order,
        })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!editor) return;
    setBusy(true);
    try {
      const saved = await saveReading({
        data: {
          id: editor.id,
          title: editor.title,
          body: editor.body,
          learning_language: editor.learning_language || null,
          level: editor.level || null,
          status: editor.status,
          display_layout: editor.display_layout,
          topicIds: editor.topicIds,
          tags: editor.tags.split(",").map((x) => x.trim()).filter(Boolean),
        },
      });

      for (let i = 0; i < editor.questionSets.length; i++) {
        const set = editor.questionSets[i]!;
        await saveReadingQuestionSet({
          data: {
            id: set.id,
            readingId: saved.id,
            title: set.title || null,
            instructions: set.instructions || null,
            sort_order: i,
          },
        });
      }

      if (catalogTarget) {
        await addCatalogItems({
          data: {
            catalogId: catalogTarget,
            items: [
              {
                entity_type: "reading",
                entity_id: saved.id,
              },
            ],
          },
        });
        await qc.invalidateQueries({ queryKey: ["catalogs-detailed"] });
      }

      await qc.invalidateQueries({ queryKey: ["readings"] });
      await openEdit(saved.id);
      toast.success(t("save"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addQuestionSet() {
    if (!editor) return;
    if (!editor.title.trim()) {
      toast.error(t("title") + " is required.");
      return;
    }

    const existingSet = editor.questionSets.find((set) => !!set.id);
    if (existingSet?.id) {
      setAutoCreateSetId(existingSet.id);
      setQuestionCreateRequest((value) => value + 1);
      return;
    }

    setBusy(true);
    try {
      let readingId = editor.id;
      if (!readingId) {
        const saved = await saveReading({
          data: {
            title: editor.title,
            body: editor.body,
            learning_language: editor.learning_language || null,
            level: editor.level || null,
            status: "draft",
            display_layout: editor.display_layout,
            topicIds: editor.topicIds,
            tags: editor.tags
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          },
        });
        readingId = saved.id;
      }

      const created = await saveReadingQuestionSet({
        data: {
          readingId,
          title: null,
          instructions: null,
          sort_order: editor.questionSets.length,
        },
      });

      setEditor((current) =>
        current
          ? {
              ...current,
              id: readingId,
              questionSets: [
                ...current.questionSets,
                {
                  id: created.id,
                  title: "",
                  instructions: "",
                  sort_order: current.questionSets.length,
                },
              ],
            }
          : current,
      );
      setAutoCreateSetId(created.id);
      setQuestionCreateRequest((value) => value + 1);
      await qc.invalidateQueries({ queryKey: ["readings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestionSet(index: number) {
    if (!editor) return;
    const set = editor.questionSets[index];
    if (!set) return;

    if (set.id) {
      if (!confirm(t("delete_question_set_confirm"))) return;
      try {
        await deleteContextQuestionSet({
          data: { kind: "reading", id: set.id },
        });
        await qc.invalidateQueries({ queryKey: ["questions"] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    setEditor((current) =>
      current
        ? {
            ...current,
            questionSets: current.questionSets.filter(
              (_, rowIndex) => rowIndex !== index,
            ),
          }
        : current,
    );
  }

  async function openPreview(id: string) {
    setPreviewBusyId(id);
    try {
      setPreview(await getReadingStudentPreview({ data: { id } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewBusyId(null);
    }
  }

  async function trashReading(id: string) {
    if (!confirm(t("move_to_trash_confirm"))) return;
    try {
      await trashContextContent({ data: { type: "reading", id } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["readings"] }),
        qc.invalidateQueries({ queryKey: ["trash-center"] }),
      ]);
      toast.success(t("moved_to_trash"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("readings")}</h1>
          <p className="text-sm text-muted-foreground">{total} {t("items").toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/teacher/sources?target=readings">
              <FileUp className="h-4 w-4" />
              {t("import_document")}
            </a>
          </Button>
          <Button
            disabled={languages.isPending}
            onClick={() =>
              setEditor(emptyEditor(languages.defaultLearningCode))
            }
          >
            <Plus className="h-4 w-4" />
            {t("add_reading")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <Input
          value={search}
          placeholder={t("search")}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <select className={selectClass} value={language} onChange={(e) => { setLanguage(e.target.value); setPage(0); }}>
          <option value="">{t("all")} — {t("language")}</option>
          {languages.all.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={level} onChange={(e) => { setLevel(e.target.value); setPage(0); }}>
          <option value="">{t("all")} — {t("level")}</option>
          {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }}>
          {(["active", "draft", "archived", "all"] as const).map((x) => <option key={x} value={x}>{t(x)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("title")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("language")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("level")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("word_count")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("question_sets")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{isFetching ? "…" : t("no_results")}</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <button className="text-left font-medium hover:underline" onClick={() => openEdit(row.id)}>{row.title}</button>
                  <div className="text-xs text-muted-foreground">{t(row.display_layout)}</div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">{row.learning_language ?? "—"}</td>
                <td className="hidden px-3 py-2 md:table-cell">{row.level ?? "—"}</td>
                <td className="hidden px-3 py-2 md:table-cell">{row.word_count ?? 0}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{row.questionSets}</td>
                <td className="px-3 py-2">{t(row.status)}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={previewBusyId === row.id}
                      onClick={() => void openPreview(row.id)}
                      aria-label={t("preview")}
                      title={t("preview")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(row.id)} aria-label={t("edit")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => trashReading(row.id)}
                      aria-label={t("trash")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page + 1} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>←</Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>→</Button>
        </div>
      </div>

      {editor && (
        <Dialog open onOpenChange={(open) => !open && setEditor(null)}>
          <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
            <DialogHeader><DialogTitle>{editor.id ? t("edit_reading") : t("add_reading")}</DialogTitle></DialogHeader>
            <div className="space-y-5">
              <Field label={t("title")}><Input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} required autoFocus /></Field>
              <Field label={t("passage")}><Textarea rows={14} value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} /></Field>

              <div className="max-w-sm">
                <Field label={t("language")}>
                  <select className={selectClass} value={editor.learning_language} onChange={(e) => setEditor({ ...editor, learning_language: e.target.value })}>
                    {editor.learning_language &&
                      !languages.learning.some(
                        (item) => item.code === editor.learning_language,
                      ) && (
                        <option value={editor.learning_language}>
                          {editor.learning_language}
                        </option>
                      )}
                    {languages.learning.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <details className="rounded-md border border-border bg-muted/20 p-3">
                <summary className="cursor-pointer select-none text-sm font-medium">
                  {t("advanced")}
                </summary>
                <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">

                <Field label={t("level")}>
                  <select className={selectClass} value={editor.level} onChange={(e) => setEditor({ ...editor, level: e.target.value })}>
                    <option value="">—</option>{LEVELS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label={t("layout")}>
                  <select className={selectClass} value={editor.display_layout} onChange={(e) => setEditor({ ...editor, display_layout: e.target.value as EditorState["display_layout"] })}>
                    <option value="stacked">{t("stacked")}</option><option value="split">{t("split")}</option><option value="tabbed">{t("tabbed")}</option>
                  </select>
                </Field>
                <Field label={t("status")}>
                  <select className={selectClass} value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value as EditorState["status"] })}>
                    {(["active", "draft", "archived"] as const).map((x) => <option key={x}>{t(x)}</option>)}
                  </select>
                </Field>
              </div>

              <Field label={t("topics")}>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {topicOpts.map((x) => (
                    <label key={x.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: x.depth * 16 }}>
                      <Checkbox
                        checked={editor.topicIds.includes(x.id)}
                        onCheckedChange={(checked) => setEditor({
                          ...editor,
                          topicIds: checked ? [...editor.topicIds, x.id] : editor.topicIds.filter((id) => id !== x.id),
                        })}
                      />
                      {x.name}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Tags"><Input value={editor.tags} onChange={(e) => setEditor({ ...editor, tags: e.target.value })} placeholder="ielts, academic" /></Field>
                </div>
              </details>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("questions")}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void addQuestionSet()}
                  >
                    <Plus className="h-4 w-4" />{t("add_question")}
                  </Button>
                </div>
                {editor.questionSets.length === 0 && <p className="text-sm text-muted-foreground">{t("no_questions")}</p>}
                {editor.questionSets.map((set, index) => (
                  <div
                    key={set.id ?? index}
                    className="space-y-3 rounded-md border border-border p-3"
                  >
                    {set.id ? (
                      <ContextQuestionSetManager
                        kind="reading"
                        questionSetId={set.id}
                        topics={topics}
                        initialCreateOpen={autoCreateSetId === set.id}
                        createRequest={
                          autoCreateSetId === set.id ? questionCreateRequest : 0
                        }
                      />
                    ) : null}

                    <details className="rounded-md border border-border bg-muted/20 p-3">
                      <summary className="cursor-pointer select-none text-sm font-medium">
                        {t("advanced")}
                      </summary>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                        <Input
                          value={set.title}
                          placeholder={t("title")}
                          onChange={(e) => setEditor({
                            ...editor,
                            questionSets: editor.questionSets.map((x, i) => i === index ? { ...x, title: e.target.value } : x),
                          })}
                        />
                        <Input
                          value={set.instructions}
                          placeholder={t("instructions")}
                          onChange={(e) => setEditor({
                            ...editor,
                            questionSets: editor.questionSets.map((x, i) => i === index ? { ...x, instructions: e.target.value } : x),
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void removeQuestionSet(index)}
                          aria-label={t("delete")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </details>
                  </div>
                ))}
              </section>

              <CatalogTargetSelect
                value={catalogTarget}
                onChange={setCatalogTarget}
              />

              <DialogFooter>
                {editor.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={previewBusyId === editor.id}
                    onClick={() => void openPreview(editor.id!)}
                  >
                    <Eye className="h-4 w-4" />
                    {t("preview")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditor(null);
                    setCatalogTarget("");
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button type="button" disabled={busy} onClick={() => void save()}>{t("save")}</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("preview")}</DialogTitle>
          </DialogHeader>
          {preview && (
            <ContextActivityStudentPreview
              kind="reading"
              data={preview as unknown as StudentReadingPractice}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
