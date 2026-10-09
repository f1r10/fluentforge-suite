import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FolderTree,
  GripVertical,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addCatalogAssignment,
  addCatalogItems,
  CATALOG_ITEM_TYPES,
  getCatalog,
  listCatalogsDetailed,
  removeCatalogAssignment,
  removeCatalogItem,
  reorderCatalogItems,
  saveCatalog,
  searchCatalogAssignmentTargets,
  searchCatalogContent,
  trashCatalog,
  type CatalogItemType,
  type CatalogSettings,
} from "@/lib/catalog.functions";
import { useI18n } from "@/lib/i18n";
import { listTopics } from "@/lib/questions.functions";
import { LEVELS, QUESTION_TYPES } from "@/lib/question-types";
import { topicOptions } from "@/components/app/topics";
import { useContentLanguages } from "@/lib/content-languages";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

const catalogQuery = (id: string) =>
  queryOptions({
    queryKey: ["catalog", id],
    queryFn: () => getCatalog({ data: { id } }),
  });

const catalogsQuery = queryOptions({
  queryKey: ["catalogs-detailed"],
  queryFn: () => listCatalogsDetailed(),
});

const topicsQuery = queryOptions({
  queryKey: ["topics"],
  queryFn: () => listTopics(),
});

const VOCAB_PARTS_OF_SPEECH = [
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
] as const;

export const Route = createFileRoute("/_authenticated/teacher/catalogs/$id")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(catalogQuery(params.id)),
      context.queryClient.ensureQueryData(catalogsQuery),
      context.queryClient.ensureQueryData(topicsQuery),
    ]);
  },
  component: CatalogWorkspace,
});

type CatalogData = Awaited<ReturnType<typeof getCatalog>>;
type Item = CatalogData["items"][number];

function CatalogWorkspace() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(catalogQuery(id));
  const { data: allCatalogs } = useSuspenseQuery(catalogsQuery);

  const [meta, setMeta] = useState({
    name: data.name,
    description: data.description ?? "",
    parent_id: data.parent_id ?? "",
    status: data.status,
    settings: data.settings,
  });
  const [savingMeta, setSavingMeta] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState<"group" | "student" | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    setMeta({
      name: data.name,
      description: data.description ?? "",
      parent_id: data.parent_id ?? "",
      status: data.status,
      settings: data.settings,
    });
  }, [data]);

  const descendants = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const row of allCatalogs) {
      if (!row.parent_id) continue;
      children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row.id]);
    }
    const result = new Set<string>();
    const visit = (parent: string) => {
      for (const child of children.get(parent) ?? []) {
        if (result.has(child)) continue;
        result.add(child);
        visit(child);
      }
    };
    visit(id);
    return result;
  }, [allCatalogs, id]);

  async function refreshCatalog() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["catalog", id] }),
      qc.invalidateQueries({ queryKey: ["catalogs-detailed"] }),
    ]);
    await qc.refetchQueries({
      queryKey: ["catalog", id],
      type: "active",
    });
  }

  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    try {
      await saveCatalog({
        data: {
          id,
          name: meta.name,
          description: meta.description || null,
          parent_id: meta.parent_id || null,
          status: meta.status,
          settings: meta.settings,
        },
      });
      await refreshCatalog();
      toast.success(t("save"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMeta(false);
    }
  }

  async function applyOrder(next: Item[]) {
    try {
      await reorderCatalogItems({ data: { catalogId: id, itemIds: next.map((x) => x.id) } });
      qc.setQueryData<CatalogData>(["catalog", id], (old) => (old ? { ...old, items: next } : old));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await qc.invalidateQueries({ queryKey: ["catalog", id] });
    }
  }

  async function moveItem(itemId: string, direction: -1 | 1) {
    const index = data.items.findIndex((x) => x.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.items.length) return;
    const next = [...data.items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    await applyOrder(next);
  }

  async function dropItem(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const from = data.items.findIndex((x) => x.id === draggedId);
    const to = data.items.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...data.items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setDraggedId(null);
    await applyOrder(next);
  }

  async function removeItem(itemId: string) {
    if (!confirm(t("remove_from_catalog_confirm"))) return;
    try {
      await removeCatalogItem({ data: { catalogId: id, itemId } });
      await refreshCatalog();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function removeAssignment(idToRemove: string) {
    try {
      await removeCatalogAssignment({ data: { catalogId: id, assignmentId: idToRemove } });
      await refreshCatalog();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function removeCatalog() {
    if (!confirm(t("delete_catalog_confirm"))) return;
    try {
      await trashCatalog({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["catalogs-detailed"] });
      navigate({ to: "/teacher/catalogs" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/teacher/catalogs" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t("catalogs")}
          </Link>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          {data.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{data.description}</p>}
        </div>
        <Button variant="ghost" className="text-destructive" onClick={removeCatalog}>
          <Trash2 className="h-4 w-4" />
          {t("delete")}
        </Button>
      </div>

      <section className="rounded-md border border-border p-4">
        <div className="mb-4 flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("catalog_settings")}</h2>
        </div>
        <form onSubmit={saveMetadata} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("name")}>
              <Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} required />
            </Field>
            <Field label={t("parent_catalog")}>
              <select className={selectClass} value={meta.parent_id} onChange={(e) => setMeta({ ...meta, parent_id: e.target.value })}>
                <option value="">— {t("root_catalog")} —</option>
                {allCatalogs
                  .filter((row) => row.id !== id && !descendants.has(row.id) && row.status !== "archived")
                  .map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label={t("description")}>
            <Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} rows={3} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("status")}>
              <select
                className={selectClass}
                value={meta.status}
                onChange={(e) => setMeta({ ...meta, status: e.target.value as typeof meta.status })}
              >
                {(["active", "draft", "archived"] as const).map((status) => (
                  <option key={status} value={status}>{t(status)}</option>
                ))}
              </select>
            </Field>
            <Check
              label={t("shuffle_questions")}
              checked={meta.settings.shuffle_questions}
              onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, shuffle_questions: value } })}
            />
            <Check
              label={t("shuffle_vocabulary")}
              checked={meta.settings.shuffle_vocabulary}
              onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, shuffle_vocabulary: value } })}
            />
            <Check
              label={t("allow_self_practice")}
              checked={meta.settings.allow_self_practice}
              onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, allow_self_practice: value } })}
            />
            <Field label={t("feedback_mode")}>
              <select
                className={selectClass}
                value={meta.settings.feedback_mode}
                onChange={(e) =>
                  setMeta({
                    ...meta,
                    settings: { ...meta.settings, feedback_mode: e.target.value as CatalogSettings["feedback_mode"] },
                  })
                }
              >
                <option value="instant">{t("instant")}</option>
                <option value="end">{t("end_of_practice")}</option>
              </select>
            </Field>
            <Check
              label={t("show_explanations")}
              checked={meta.settings.show_explanations}
              onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, show_explanations: value } })}
            />
            <div className="self-end rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {t("context_preserved")}
            </div>
          </div>

          <Button type="submit" disabled={savingMeta}>{t("save")}</Button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("catalog_content")}</h2>
            <p className="text-sm text-muted-foreground">{data.items.length} {t("items").toLocaleLowerCase()}</p>
          </div>
          <Button onClick={() => setContentOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("add_content")}
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10" />
                <th className="px-3 py-2 font-medium">{t("content")}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("type")}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t("language")}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t("level")}</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("status")}</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{t("catalog_empty")}</td>
                </tr>
              )}
              {data.items.map((item, index) => (
                <tr
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggedId(item.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropItem(item.id)}
                  className={item.available ? "hover:bg-muted/30" : "bg-destructive/5"}
                >
                  <td className="px-2 py-2 text-muted-foreground">
                    <GripVertical className="h-4 w-4 cursor-grab" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-2xl truncate font-medium">{item.title}</div>
                    {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
                    {!item.available && <div className="text-xs text-destructive">{t("content_unavailable")}</div>}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{t(item.entity_type)}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{item.language ?? "—"}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{item.level ?? "—"}</td>
                  <td className="hidden px-3 py-2 lg:table-cell">{t(item.status)}</td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => moveItem(item.id, -1)}
                        aria-label={t("move_up")}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === data.items.length - 1}
                        onClick={() => moveItem(item.id, 1)}
                        aria-label={t("move_down")}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => removeItem(item.id)}
                        aria-label={t("remove")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("assignments")}</h2>
          <p className="text-sm text-muted-foreground">{t("catalog_assignment_hint")}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AssignmentPanel
            title={t("groups")}
            type="group"
            assignments={data.assignments.filter((x) => x.type === "group")}
            onAdd={() => setAssignmentOpen("group")}
            onRemove={removeAssignment}
          />
          <AssignmentPanel
            title={t("students")}
            type="student"
            assignments={data.assignments.filter((x) => x.type === "student")}
            onAdd={() => setAssignmentOpen("student")}
            onRemove={removeAssignment}
          />
        </div>
      </section>

      {contentOpen && (
        <ContentPicker catalogId={id} onClose={() => setContentOpen(false)} onChanged={refreshCatalog} />
      )}
      {assignmentOpen && (
        <AssignmentPicker
          catalogId={id}
          kind={assignmentOpen}
          onClose={() => setAssignmentOpen(null)}
          onChanged={refreshCatalog}
        />
      )}
    </div>
  );
}

function AssignmentPanel({
  title,
  type,
  assignments,
  onAdd,
  onRemove,
}: {
  title: string;
  type: "group" | "student";
  assignments: CatalogData["assignments"];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <UserPlus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("no_assignments")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{assignment.label}</div>
                {assignment.secondary && (
                  <div className="truncate text-xs text-muted-foreground">{assignment.secondary}</div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-destructive"
                onClick={() => onRemove(assignment.id)}
                aria-label={t("remove")}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-xs text-muted-foreground">{type === "group" ? t("group_assignment_note") : t("student_assignment_note")}</div>
    </div>
  );
}

function ContentPicker({
  catalogId,
  onClose,
  onChanged,
}: {
  catalogId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const languages = useContentLanguages();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const topicOpts = topicOptions(topics);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | CatalogItemType>("all");
  const [language, setLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [subtype, setSubtype] = useState("");
  const [topicId, setTopicId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data = [], isFetching } = useQuery({
    queryKey: [
      "catalog-content-search",
      catalogId,
      search,
      type,
      language,
      level,
      subtype,
      topicId,
    ],
    queryFn: () =>
      searchCatalogContent({
        data: {
          catalogId,
          search,
          type,
          language,
          level,
          subtype,
          topicId: topicId || null,
        },
      }),
  });

  const selectable = data.filter((row) => !row.inCatalog);
  const selectedRows = selectable.filter((row) =>
    selected.includes(`${row.entity_type}:${row.entity_id}`),
  );

  const subtypeOptions =
    type === "question"
      ? QUESTION_TYPES.map((item) => ({
          value: item.id,
          label: item.label,
        }))
      : type === "vocabulary"
        ? VOCAB_PARTS_OF_SPEECH.map((value) => ({
            value,
            label: value,
          }))
        : [];

  async function add() {
    if (!selectedRows.length) return;
    setBusy(true);
    try {
      await addCatalogItems({
        data: {
          catalogId,
          items: selectedRows.map((row) => ({
            entity_type: row.entity_type,
            entity_id: row.entity_id,
          })),
        },
      });
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("add_content")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search")}
              />
            </div>
            <select
              className={selectClass}
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setSubtype("");
              }}
            >
              <option value="all">{t("all")}</option>
              {CATALOG_ITEM_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(x)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              className={selectClass}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="">
                {t("language")}: {t("all")}
              </option>
              {(languages.learning.length ? languages.learning : languages.all).map(
                (item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ),
              )}
            </select>

            <select
              className={selectClass}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
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
              className={selectClass}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
            >
              <option value="">
                {t("topics")}: {t("all")}
              </option>
              {topicOpts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              className={selectClass}
              value={subtype}
              disabled={subtypeOptions.length === 0}
              onChange={(e) => setSubtype(e.target.value)}
            >
              <option value="">
                {type === "question"
                  ? `${t("type")}: ${t("all")}`
                  : type === "vocabulary"
                    ? `${t("part_of_speech")}: ${t("all")}`
                    : "—"}
              </option>
              {subtypeOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {data.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_results")}
            </div>
          )}
          <ul className="divide-y divide-border">
            {data.map((row) => {
              const key = `${row.entity_type}:${row.entity_id}`;
              return (
                <li key={key} className="flex items-start gap-3 p-3">
                  <Checkbox
                    className="mt-0.5"
                    disabled={row.inCatalog}
                    checked={row.inCatalog || selected.includes(key)}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? [...selected, key]
                          : selected.filter((x) => x !== key),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(row.entity_type)}
                      {row.subtitle ? ` · ${row.subtitle}` : ""}
                      {row.language ? ` · ${row.language}` : ""}
                      {row.level ? ` · ${row.level}` : ""}
                    </div>
                  </div>
                  {row.inCatalog && (
                    <span className="text-xs text-muted-foreground">
                      {t("already_added")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={add} disabled={busy || selectedRows.length === 0}>
            {t("add")} ({selectedRows.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentPicker({
  catalogId,
  kind,
  onClose,
  onChanged,
}: {
  catalogId: string;
  kind: "group" | "student";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["catalog-assignment-targets", catalogId, kind, search, page],
    queryFn: () => searchCatalogAssignmentTargets({ data: { catalogId, kind, search, page } }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function add(targetId: string) {
    setBusyId(targetId);
    try {
      await addCatalogAssignment({ data: { catalogId, kind, targetId } });
      await Promise.all([
        onChanged(),
        qc.invalidateQueries({
          queryKey: ["catalog-assignment-targets", catalogId, kind],
        }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{kind === "group" ? t("assign_group") : t("assign_student")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("search")}
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {rows.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{isFetching ? "…" : t("no_results")}</div>}
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{row.label}</div>
                  {row.secondary && <div className="truncate text-xs text-muted-foreground">{row.secondary}</div>}
                </div>
                <Button
                  size="sm"
                  variant={row.assigned ? "outline" : "default"}
                  disabled={row.assigned || busyId === row.id}
                  onClick={() => add(row.id)}
                >
                  {row.assigned ? t("assigned") : t("add")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{page + 1} / {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>←</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>→</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(!!value)} />
      {label}
    </label>
  );
}
