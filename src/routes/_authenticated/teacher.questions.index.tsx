import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkQuestions, listQuestions, listTopics } from "@/lib/questions.functions";
import { listCatalogs } from "@/lib/teacher.functions";
import { LEVELS, QUESTION_TYPES, TYPE_BY_ID } from "@/lib/question-types";
import { topicOptions } from "@/components/app/topics";
import { QuestionImportDialog } from "@/components/app/QuestionImportDialog";
import { useI18n } from "@/lib/i18n";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });
const catalogsQuery = queryOptions({ queryKey: ["catalogs"], queryFn: () => listCatalogs() });

export const Route = createFileRoute("/_authenticated/teacher/questions/")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(topicsQuery), context.queryClient.ensureQueryData(catalogsQuery)]),
  component: QuestionBank,
});

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function QuestionBank() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const { data: catalogs } = useSuspenseQuery(catalogsQuery);
  const tOpts = topicOptions(topics);
  const [f, setF] = useState({ text: "", type: "", level: "", topicId: "", status: "active" as "active" | "draft" | "archived" | "all", page: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTopic, setBulkTopic] = useState("");
  const [bulkCatalog, setBulkCatalog] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["questions", f],
    queryFn: () => listQuestions({ data: { ...f, topicId: f.topicId || undefined } }),
    placeholderData: keepPreviousData,
  });
  const set = (patch: Partial<typeof f>) => { setF({ ...f, page: 0, ...patch }); };
  const rows = data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  }

  async function bulk(action: "archive" | "activate" | "trash" | "add_topic" | "add_to_catalog" | "duplicate") {
    if (action === "trash" && !confirm(`${t("move_to_trash")}: ${selected.size}?`)) return;
    try {
      await bulkQuestions({ data: { ids: [...selected], action, topicId: bulkTopic || undefined, catalogId: bulkCatalog || undefined } });
      toast.success(`${selected.size} ✓`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["catalogs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("questions_bank")} {data && <span className="text-base font-normal text-muted-foreground">({data.total})</span>}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/teacher/sources?target=questions">
              <FileUp className="h-4 w-4" />
              {t("import_document")}
            </a>
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" />
            {t("import_questions")}
          </Button>
          <Button asChild><Link to="/teacher/questions/new"><Plus className="h-4 w-4" />{t("add_question")}</Link></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder={t("search")} value={f.text} onChange={(e) => set({ text: e.target.value })} className="h-9 max-w-xs" />
        <select value={f.type} onChange={(e) => set({ type: e.target.value })} className={sel}>
          <option value="">{t("type")}: {t("all")}</option>
          {QUESTION_TYPES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
        <select value={f.level} onChange={(e) => set({ level: e.target.value })} className={sel}>
          <option value="">{t("level")}: {t("all")}</option>
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} className={sel}>
          <option value="">{t("topics")}: {t("all")}</option>
          {tOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={f.status} onChange={(e) => set({ status: e.target.value as typeof f.status })} className={sel}>
          {(["active", "draft", "archived", "all"] as const).map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      </div>

      <div className={`overflow-hidden rounded-md border border-border ${isFetching ? "opacity-70" : ""}`}>
        <div className="flex items-center gap-3 border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Checkbox checked={allOnPage} onCheckedChange={(c) => { const n = new Set(selected); rows.forEach((r) => (c ? n.add(r.id) : n.delete(r.id))); setSelected(n); }} aria-label={t("select_all")} />
          <span>{t("select_all")}</span>
        </div>
        {rows.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("no_results")}</p>}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className={`flex items-start gap-3 px-3 py-3 ${selected.has(r.id) ? "bg-accent" : ""}`}>
              <Checkbox className="mt-1 h-5 w-5" checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="select" />
              <Link to="/teacher/questions/$id" params={{ id: r.id }} className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm">{r.prompt || "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {TYPE_BY_ID[r.question_type]?.label ?? r.question_type}
                  {r.level && ` · ${r.level}`}
                  {r.status !== "active" && ` · ${t(r.status)}`}
                  {r.current_version > 1 && ` · v${r.current_version}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>‹</Button>
          <span>{f.page + 1} / {Math.ceil(data.total / data.pageSize)}</span>
          <Button variant="outline" size="sm" disabled={(f.page + 1) * data.pageSize >= data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>›</Button>
        </div>
      )}

      <QuestionImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        topics={topics}
      />

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-3 shadow-sm md:left-56">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-sm">
            <strong>{selected.size} {t("selected")}</strong>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("clear")}</Button>
            <select value={bulkCatalog} onChange={(e) => setBulkCatalog(e.target.value)} className={sel}>
              <option value="">{t("catalogs")}…</option>
              {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!bulkCatalog} onClick={() => bulk("add_to_catalog")}>{t("add_to_catalog")}</Button>
            <select value={bulkTopic} onChange={(e) => setBulkTopic(e.target.value)} className={sel}>
              <option value="">{t("topics")}…</option>
              {tOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!bulkTopic} onClick={() => bulk("add_topic")}>{t("add_topic")}</Button>
            <Button size="sm" variant="outline" onClick={() => bulk("duplicate")}>{t("duplicate")}</Button>
            <Button size="sm" variant="outline" onClick={() => bulk(f.status === "archived" ? "activate" : "archive")}>{f.status === "archived" ? t("enable") : t("archive")}</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulk("trash")}>{t("move_to_trash")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
