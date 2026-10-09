import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Settings2,
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
  addExamAssignment,
  addExamItems,
  deleteExamSection,
  EXAM_ITEM_TYPES,
  getExam,
  previewExamPool,
  publishExam,
  removeExamAssignment,
  removeExamItem,
  reorderExamItems,
  reorderExamSections,
  saveExam,
  saveExamSection,
  searchExamAssignmentTargets,
  searchExamContent,
  setExamLifecycleStatus,
  trashDraftExam,
  type ExamItemType,
  type ExamSettings,
  type PoolRules,
} from "@/lib/exam.functions";
import { listCatalogsDetailed } from "@/lib/catalog.functions";
import { listTopics } from "@/lib/questions.functions";
import { LEVELS, QUESTION_TYPES } from "@/lib/question-types";
import { useI18n } from "@/lib/i18n";

const examQuery = (id: string) =>
  queryOptions({
    queryKey: ["exam", id],
    queryFn: () => getExam({ data: { id } }),
  });

const catalogsQuery = queryOptions({
  queryKey: ["catalogs-detailed"],
  queryFn: () => listCatalogsDetailed(),
});

const topicsQuery = queryOptions({
  queryKey: ["topics"],
  queryFn: () => listTopics(),
});

export const Route = createFileRoute("/_authenticated/teacher/exams/$id")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(examQuery(params.id)),
      context.queryClient.ensureQueryData(catalogsQuery),
      context.queryClient.ensureQueryData(topicsQuery),
    ]);
  },
  component: ExamWorkspace,
});

type ExamData = Awaited<ReturnType<typeof getExam>>;
type ExamSection = ExamData["sections"][number];
type ExamItem = ExamSection["items"][number];
type Assignment = ExamData["assignments"][number];

function ExamWorkspace() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(examQuery(id));
  const { data: catalogs } = useSuspenseQuery(catalogsQuery);
  const { data: topics } = useSuspenseQuery(topicsQuery);

  const [meta, setMeta] = useState(() => examToForm(data));
  const [savingMeta, setSavingMeta] = useState(false);
  const [sectionEditor, setSectionEditor] = useState<ExamSection | "new" | null>(null);
  const [contentSection, setContentSection] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState<"group" | "student" | null>(null);
  const [poolEditor, setPoolEditor] = useState<{ section: ExamSection; poolIndex: number | null } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const isDraft = data.status === "draft";
  const closeTimeRequired =
    !meta.available_until &&
    (meta.settings.result_release === "after_close" ||
      meta.settings.answer_visibility === "after_close" ||
      meta.settings.explanation_visibility === "after_close");

  useEffect(() => {
    setMeta(examToForm(data));
  }, [data]);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["exam", id] }),
      qc.invalidateQueries({ queryKey: ["exams-detailed"] }),
    ]);
  }

  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (!isDraft) return;
    setSavingMeta(true);
    try {
      await saveExam({
        data: {
          id,
          title: meta.title,
          description: meta.description || null,
          duration_minutes: meta.duration ? Number(meta.duration) : null,
          available_from: meta.available_from ? new Date(meta.available_from).toISOString() : null,
          available_until: meta.available_until ? new Date(meta.available_until).toISOString() : null,
          settings: meta.settings,
        },
      });
      await refresh();
      toast.success(t("save"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMeta(false);
    }
  }

  async function moveSection(sectionId: string, direction: -1 | 1) {
    if (!isDraft) return;
    const index = data.sections.findIndex((section) => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.sections.length) return;
    const next = [...data.sections];
    [next[index], next[target]] = [next[target]!, next[index]!];

    try {
      await reorderExamSections({ data: { examId: id, sectionIds: next.map((section) => section.id) } });
      qc.setQueryData<ExamData>(["exam", id], (old) => (old ? { ...old, sections: next } : old));
    } catch (err) {
      toast.error(String(err));
      await refresh();
    }
  }

  async function deleteSection(sectionId: string) {
    if (!confirm(t("delete_section_confirm"))) return;
    try {
      await deleteExamSection({ data: { examId: id, sectionId } });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function moveItem(section: ExamSection, itemId: string, direction: -1 | 1) {
    if (!isDraft) return;
    const index = section.items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= section.items.length) return;
    const nextItems = [...section.items];
    [nextItems[index], nextItems[target]] = [nextItems[target]!, nextItems[index]!];

    try {
      await reorderExamItems({
        data: {
          examId: id,
          sectionId: section.id,
          itemIds: nextItems.map((item) => item.id),
        },
      });
      qc.setQueryData<ExamData>(["exam", id], (old) =>
        old
          ? {
              ...old,
              sections: old.sections.map((row) =>
                row.id === section.id ? { ...row, items: nextItems } : row,
              ),
            }
          : old,
      );
    } catch (err) {
      toast.error(String(err));
      await refresh();
    }
  }

  async function removeItem(sectionId: string, itemId: string) {
    if (!confirm(t("remove_exam_item_confirm"))) return;
    try {
      await removeExamItem({ data: { examId: id, sectionId, itemId } });
      await refresh();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function removeAssignment(assignmentId: string) {
    try {
      await removeExamAssignment({ data: { examId: id, assignmentId } });
      await refresh();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function publish() {
    if (!confirm(t("publish_exam_confirm"))) return;
    setPublishing(true);
    try {
      const result = await publishExam({ data: { examId: id } });
      await refresh();
      toast.success(`${t("published")} · ${result.assessable_count} ${t("items").toLocaleLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  async function lifecycle(status: "scheduled" | "active" | "finished" | "archived") {
    try {
      await setExamLifecycleStatus({ data: { examId: id, status } });
      await refresh();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function removeExam() {
    if (!confirm(t("delete_exam_confirm"))) return;
    try {
      await trashDraftExam({ data: { examId: id } });
      await qc.invalidateQueries({ queryKey: ["exams-detailed"] });
      navigate({ to: "/teacher/exams" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/teacher/exams" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t("exams")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{data.title}</h1>
            <span className="rounded bg-muted px-2 py-1 text-xs">{t(data.status)}</span>
          </div>
          {data.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{data.description}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <Button
                onClick={publish}
                disabled={publishing || closeTimeRequired}
                title={
                  closeTimeRequired
                    ? t("exam_close_required_for_visibility")
                    : undefined
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("publish_exam")}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={removeExam}>
                <Trash2 className="h-4 w-4" />
                {t("delete")}
              </Button>
            </>
          ) : (
            <>
              {data.status !== "active" && data.status !== "archived" && (
                <Button variant="outline" onClick={() => lifecycle("active")}>{t("activate")}</Button>
              )}
              {data.status !== "finished" && data.status !== "archived" && (
                <Button variant="outline" onClick={() => lifecycle("finished")}>{t("finish")}</Button>
              )}
              {data.status !== "archived" && (
                <Button variant="outline" onClick={() => lifecycle("archived")}>{t("archive")}</Button>
              )}
            </>
          )}
        </div>
      </header>

      {!isDraft && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          {t("published_exam_immutable")}
        </div>
      )}

      {isDraft && closeTimeRequired && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("exam_close_required_for_visibility")}
        </div>
      )}

      <section className="rounded-md border border-border p-4">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("exam_settings")}</h2>
        </div>

        <form onSubmit={saveMetadata} className="space-y-5">
          <fieldset disabled={!isDraft || savingMeta} className="space-y-5 disabled:opacity-70">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label={t("title")}>
                <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} required />
              </Field>
              <Field label={t("duration_min")}>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={meta.duration}
                  onChange={(e) => setMeta({ ...meta, duration: e.target.value })}
                />
              </Field>
            </div>

            <Field label={t("description")}>
              <Textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} rows={3} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("available_from")}>
                <Input
                  type="datetime-local"
                  value={meta.available_from}
                  onChange={(e) => setMeta({ ...meta, available_from: e.target.value })}
                />
              </Field>
              <Field label={t("available_until")}>
                <Input
                  type="datetime-local"
                  value={meta.available_until}
                  onChange={(e) => setMeta({ ...meta, available_until: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("max_attempts")}>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={meta.settings.max_attempts}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      settings: { ...meta.settings, max_attempts: Math.max(1, Number(e.target.value) || 1) },
                    })
                  }
                />
              </Field>
              <Field label={t("pass_score_percent")}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={meta.settings.pass_score_percent ?? ""}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      settings: {
                        ...meta.settings,
                        pass_score_percent: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
              <Field label={t("section_order")}>
                <select
                  className={selectClass}
                  value={meta.settings.section_order}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      settings: { ...meta.settings, section_order: e.target.value as ExamSettings["section_order"] },
                    })
                  }
                >
                  <option value="fixed">{t("fixed")}</option>
                  <option value="shuffle">{t("shuffle")}</option>
                </select>
              </Field>
              <Field label={t("result_release")}>
                <select
                  className={selectClass}
                  value={meta.settings.result_release}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      settings: { ...meta.settings, result_release: e.target.value as ExamSettings["result_release"] },
                    })
                  }
                >
                  <option value="immediate">{t("immediate")}</option>
                  <option value="after_close">{t("after_close")}</option>
                  <option value="after_approval">{t("after_approval")}</option>
                </select>
              </Field>
              <Field label={t("answer_visibility")}>
                <VisibilitySelect
                  value={meta.settings.answer_visibility}
                  onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, answer_visibility: value } })}
                />
              </Field>
              <Field label={t("explanation_visibility")}>
                <VisibilitySelect
                  value={meta.settings.explanation_visibility}
                  onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, explanation_visibility: value } })}
                />
              </Field>
              <Field label={t("max_tab_switches")}>
                <Input
                  type="number"
                  min={0}
                  value={meta.settings.max_tab_switches ?? ""}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      settings: {
                        ...meta.settings,
                        max_tab_switches: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
                />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SettingCheck
                label={t("resume_after_disconnect")}
                checked={meta.settings.resume_after_disconnect}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, resume_after_disconnect: value } })}
              />
              <SettingCheck
                label={t("shuffle_questions")}
                checked={meta.settings.shuffle_questions}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, shuffle_questions: value } })}
              />
              <SettingCheck
                label={t("shuffle_options")}
                checked={meta.settings.shuffle_options}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, shuffle_options: value } })}
              />
              <SettingCheck
                label={t("allow_back_navigation")}
                checked={meta.settings.allow_back_navigation}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, allow_back_navigation: value } })}
              />
              <SettingCheck
                label={t("copy_paste_restricted")}
                checked={meta.settings.copy_paste_restricted}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, copy_paste_restricted: value } })}
              />
              <SettingCheck
                label={t("monitor_tab_switches")}
                checked={meta.settings.monitor_tab_switches}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, monitor_tab_switches: value } })}
              />
              <SettingCheck
                label={t("full_duration_after_start")}
                checked={meta.settings.full_duration_after_start}
                onChange={(value) => setMeta({ ...meta, settings: { ...meta.settings, full_duration_after_start: value } })}
              />
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {t("auto_submit_locked")}
              </div>
            </div>
          </fieldset>

          {isDraft && <Button type="submit" disabled={savingMeta}>{t("save")}</Button>}
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("exam_sections")}</h2>
            <p className="text-sm text-muted-foreground">{data.sections.length} {t("sections").toLocaleLowerCase()}</p>
          </div>
          {isDraft && (
            <Button variant="outline" onClick={() => setSectionEditor("new")}>
              <Plus className="h-4 w-4" />
              {t("add_section")}
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {data.sections.map((section, sectionIndex) => (
            <section key={section.id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div>
                  <div className="text-xs text-muted-foreground">{t("section")} {sectionIndex + 1}</div>
                  <h3 className="font-semibold">{section.title || `${t("section")} ${sectionIndex + 1}`}</h3>
                  {section.instructions && <p className="mt-1 text-sm text-muted-foreground">{section.instructions}</p>}
                </div>
                {isDraft && (
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon" disabled={sectionIndex === 0} onClick={() => moveSection(section.id, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={sectionIndex === data.sections.length - 1}
                      onClick={() => moveSection(section.id, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setSectionEditor(section)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteSection(section.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-medium">{t("fixed_items")}</h4>
                    <p className="text-xs text-muted-foreground">{section.items.length} {t("items").toLocaleLowerCase()}</p>
                  </div>
                  {isDraft && (
                    <Button size="sm" onClick={() => setContentSection(section.id)}>
                      <Plus className="h-4 w-4" />
                      {t("add_content")}
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("content")}</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("type")}</th>
                        <th className="hidden px-3 py-2 font-medium md:table-cell">{t("level")}</th>
                        <th className="hidden px-3 py-2 font-medium md:table-cell">{t("status")}</th>
                        <th className="w-36" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {section.items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t("no_fixed_items")}</td>
                        </tr>
                      )}
                      {section.items.map((item, itemIndex) => (
                        <tr key={item.id} className={item.available ? "hover:bg-muted/30" : "bg-destructive/5"}>
                          <td className="px-3 py-2">
                            <div className="max-w-2xl truncate font-medium">{item.title}</div>
                            {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
                            {!item.available && <div className="text-xs text-destructive">{t("content_unavailable")}</div>}
                          </td>
                          <td className="hidden px-3 py-2 sm:table-cell">{t(item.entity_type)}</td>
                          <td className="hidden px-3 py-2 md:table-cell">{item.level ?? "—"}</td>
                          <td className="hidden px-3 py-2 md:table-cell">{t(item.status)}</td>
                          <td className="px-2 py-1">
                            {isDraft && (
                              <div className="flex justify-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={itemIndex === 0}
                                  onClick={() => moveItem(section, item.id, -1)}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={itemIndex === section.items.length - 1}
                                  onClick={() => moveItem(section, item.id, 1)}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive"
                                  onClick={() => removeItem(section.id, item.id)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-medium">{t("random_pools")}</h4>
                      <p className="text-xs text-muted-foreground">{t("random_pool_hint")}</p>
                    </div>
                    {isDraft && (
                      <Button size="sm" variant="outline" onClick={() => setPoolEditor({ section, poolIndex: null })}>
                        <Plus className="h-4 w-4" />
                        {t("add_pool")}
                      </Button>
                    )}
                  </div>

                  {section.pool_rules.pools.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{t("no_random_pools")}</p>
                  ) : (
                    <div className="space-y-2">
                      {section.pool_rules.pools.map((pool, poolIndex) => (
                        <div key={pool.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                          <div>
                            <div className="font-medium">{pool.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {pool.count} {t("questions").toLocaleLowerCase()}
                              {pool.filters.level ? ` · ${pool.filters.level}` : ""}
                              {pool.filters.language ? ` · ${pool.filters.language}` : ""}
                              {pool.filters.types.length ? ` · ${pool.filters.types.length} ${t("types").toLocaleLowerCase()}` : ""}
                            </div>
                          </div>
                          {isDraft && (
                            <div className="flex">
                              <Button variant="ghost" size="icon" onClick={() => setPoolEditor({ section, poolIndex })}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={async () => {
                                  const nextPools = section.pool_rules.pools.filter((_, index) => index !== poolIndex);
                                  try {
                                    await saveExamSection({
                                      data: {
                                        id: section.id,
                                        examId: id,
                                        title: section.title,
                                        instructions: section.instructions,
                                        pool_rules: { enabled: nextPools.length > 0, pools: nextPools },
                                      },
                                    });
                                    await refresh();
                                  } catch (err) {
                                    toast.error(String(err));
                                  }
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("assignments")}</h2>
          <p className="text-sm text-muted-foreground">{t("exam_assignment_hint")}</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <AssignmentPanel
            title={t("groups")}
            assignments={data.assignments.filter((assignment) => assignment.type === "group")}
            onAdd={() => setAssignmentOpen("group")}
            onRemove={removeAssignment}
          />
          <AssignmentPanel
            title={t("students")}
            assignments={data.assignments.filter((assignment) => assignment.type === "student")}
            onAdd={() => setAssignmentOpen("student")}
            onRemove={removeAssignment}
          />
        </div>
      </section>

      {sectionEditor && (
        <SectionEditor
          examId={id}
          section={sectionEditor === "new" ? null : sectionEditor}
          onClose={() => setSectionEditor(null)}
          onChanged={refresh}
        />
      )}

      {contentSection && (
        <ContentPicker
          examId={id}
          sectionId={contentSection}
          onClose={() => setContentSection(null)}
          onChanged={refresh}
        />
      )}

      {assignmentOpen && (
        <AssignmentPicker
          examId={id}
          kind={assignmentOpen}
          onClose={() => setAssignmentOpen(null)}
          onChanged={refresh}
        />
      )}

      {poolEditor && (
        <PoolEditor
          examId={id}
          section={poolEditor.section}
          poolIndex={poolEditor.poolIndex}
          catalogs={catalogs}
          topics={topics}
          onClose={() => setPoolEditor(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function SectionEditor({
  examId,
  section,
  onClose,
  onChanged,
}: {
  examId: string;
  section: ExamSection | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(section?.title ?? "");
  const [instructions, setInstructions] = useState(section?.instructions ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveExamSection({
        data: {
          id: section?.id,
          examId,
          title: title || null,
          instructions: instructions || null,
          pool_rules: section?.pool_rules ?? { enabled: false, pools: [] },
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
      <DialogContent>
        <DialogHeader><DialogTitle>{section ? t("edit_section") : t("add_section")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <Field label={t("title")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <Field label={t("instructions")}>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy}>{t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContentPicker({
  examId,
  sectionId,
  onClose,
  onChanged,
}: {
  examId: string;
  sectionId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | ExamItemType>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data = [], isFetching } = useQuery({
    queryKey: ["exam-content-search", examId, sectionId, search, type],
    queryFn: () => searchExamContent({ data: { examId, sectionId, search, type } }),
  });

  const selectedRows = data.filter((row) => selected.includes(`${row.entity_type}:${row.entity_id}`) && !row.inSection);

  async function add() {
    if (!selectedRows.length) return;
    setBusy(true);
    try {
      await addExamItems({
        data: {
          examId,
          sectionId,
          items: selectedRows.map((row) => ({
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            points: null,
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
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader><DialogTitle>{t("add_exam_content")}</DialogTitle></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")} />
          </div>
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="all">{t("all")}</option>
            {EXAM_ITEM_TYPES.map((itemType) => <option key={itemType} value={itemType}>{t(itemType)}</option>)}
          </select>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {data.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{isFetching ? "…" : t("no_results")}</div>}
          <ul className="divide-y divide-border">
            {data.map((row) => {
              const key = `${row.entity_type}:${row.entity_id}`;
              const toggle = () => {
                if (row.inSection) return;
                setSelected((current) =>
                  current.includes(key)
                    ? current.filter((value) => value !== key)
                    : [...current, key],
                );
              };
              return (
                <li
                  key={key}
                  role={row.inSection ? undefined : "button"}
                  tabIndex={row.inSection ? undefined : 0}
                  className={
                    "flex items-start gap-3 p-3 " +
                    (row.inSection
                      ? "opacity-70"
                      : "cursor-pointer hover:bg-muted/40")
                  }
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (
                      !row.inSection &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <Checkbox
                    className="mt-0.5"
                    disabled={row.inSection}
                    checked={row.inSection || selected.includes(key)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? [...selected.filter((value) => value !== key), key]
                          : selected.filter((value) => value !== key),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(row.entity_type)}
                      {row.subtitle ? ` · ${row.subtitle}` : ""}
                      {row.level ? ` · ${row.level}` : ""}
                      {row.inExam && !row.inSection ? ` · ${t("used_elsewhere_in_exam")}` : ""}
                    </div>
                  </div>
                  {row.inSection && <span className="text-xs text-muted-foreground">{t("already_added")}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={add} disabled={busy || selectedRows.length === 0}>
            {t("add")} ({selectedRows.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoolEditor({
  examId,
  section,
  poolIndex,
  catalogs,
  topics,
  onClose,
  onChanged,
}: {
  examId: string;
  section: ExamSection;
  poolIndex: number | null;
  catalogs: Awaited<ReturnType<typeof listCatalogsDetailed>>;
  topics: Awaited<ReturnType<typeof listTopics>>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const existing = poolIndex == null ? null : section.pool_rules.pools[poolIndex] ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [count, setCount] = useState(existing?.count ?? 10);
  const [language, setLanguage] = useState(existing?.filters.language ?? "");
  const [level, setLevel] = useState(existing?.filters.level ?? "");
  const [types, setTypes] = useState<string[]>(existing?.filters.types ?? []);
  const [topicIds, setTopicIds] = useState<string[]>(existing?.filters.topicIds ?? []);
  const [catalogId, setCatalogId] = useState(existing?.filters.catalogId ?? "");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  const flatTopics = useMemo(() => flattenTopics(topics), [topics]);

  async function previewPool() {
    try {
      const result = await previewExamPool({
        data: {
          language: language || null,
          level: level || null,
          types,
          topicIds,
          catalogId: catalogId || null,
        },
      });
      setPreview(result.count);
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await previewExamPool({
        data: {
          language: language || null,
          level: level || null,
          types,
          topicIds,
          catalogId: catalogId || null,
        },
      });
      setPreview(result.count);
      if (result.count < count) {
        throw new Error(`${t("pool_not_enough")}: ${result.count} / ${count}`);
      }

      const pool = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        count,
        filters: {
          language: language || null,
          level: level || null,
          types,
          topicIds,
          catalogId: catalogId || null,
        },
      };

      const pools = [...section.pool_rules.pools];
      if (poolIndex == null) pools.push(pool);
      else pools[poolIndex] = pool;

      await saveExamSection({
        data: {
          id: section.id,
          examId,
          title: section.title,
          instructions: section.instructions,
          pool_rules: { enabled: pools.length > 0, pools },
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
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{existing ? t("edit_pool") : t("add_pool")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
            <Field label={t("question_count")}>
              <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label={t("language")}>
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder={t("optional")} />
            </Field>
            <Field label={t("level")}>
              <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">{t("all")}</option>
                {LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label={t("catalog")}>
              <select className={selectClass} value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
                <option value="">{t("all")}</option>
                {catalogs.filter((catalog) => catalog.status === "active").map((catalog) => (
                  <option key={catalog.id} value={catalog.id}>{catalog.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="rounded-md border border-border p-3">
            <Label>{t("question_types")}</Label>
            <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
              {QUESTION_TYPES.map((type) => (
                <label key={type.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={types.includes(type.id)}
                    onCheckedChange={(checked) =>
                      setTypes(checked ? [...types, type.id] : types.filter((id) => id !== type.id))
                    }
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <Label>{t("topics")}</Label>
            <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
              {flatTopics.map((topic) => (
                <label
                  key={topic.id}
                  className="flex items-start gap-2 text-sm"
                  style={{ paddingLeft: topic.depth * 16 }}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={topicIds.includes(topic.id)}
                    onCheckedChange={(checked) =>
                      setTopicIds(checked ? [...topicIds, topic.id] : topicIds.filter((id) => id !== topic.id))
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/30 p-3 text-sm">
            <Button type="button" variant="outline" size="sm" onClick={previewPool}>{t("preview_pool")}</Button>
            <span className="text-muted-foreground">
              {preview == null ? t("preview_pool_hint") : `${preview} ${t("matching_questions")}`}
            </span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy}>{t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentPanel({
  title,
  assignments,
  onAdd,
  onRemove,
}: {
  title: string;
  assignments: Assignment[];
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
                {assignment.secondary && <div className="truncate text-xs text-muted-foreground">{assignment.secondary}</div>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => onRemove(assignment.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssignmentPicker({
  examId,
  kind,
  onClose,
  onChanged,
}: {
  examId: string;
  kind: "group" | "student";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["exam-assignment-targets", examId, kind, search, page],
    queryFn: () => searchExamAssignmentTargets({ data: { examId, kind, search, page } }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function add(targetId: string) {
    setBusyId(targetId);
    try {
      await addExamAssignment({ data: { examId, kind, targetId } });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader><DialogTitle>{kind === "group" ? t("assign_group") : t("assign_student")}</DialogTitle></DialogHeader>
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
                <Button size="sm" variant={row.assigned ? "outline" : "default"} disabled={row.assigned || busyId === row.id} onClick={() => add(row.id)}>
                  {row.assigned ? t("assigned") : t("add")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{page + 1} / {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>→</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t("close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VisibilitySelect({
  value,
  onChange,
}: {
  value: ExamSettings["answer_visibility"];
  onChange: (value: ExamSettings["answer_visibility"]) => void;
}) {
  const { t } = useI18n();
  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value as ExamSettings["answer_visibility"])}>
      <option value="never">{t("never")}</option>
      <option value="after_submit">{t("after_submit")}</option>
      <option value="after_close">{t("after_close")}</option>
      <option value="after_approval">{t("after_approval")}</option>
    </select>
  );
}

function SettingCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(!!value)} />
      {label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function examToForm(data: ExamData) {
  return {
    title: data.title,
    description: data.description ?? "",
    duration: data.duration_minutes == null ? "" : String(data.duration_minutes),
    available_from: toLocalDateTime(data.available_from),
    available_until: toLocalDateTime(data.available_until),
    settings: data.settings,
  };
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function flattenTopics(rows: Array<{ id: string; name: string; parent_id: string | null; sort_order: number }>) {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) byParent.set(row.parent_id, [...(byParent.get(row.parent_id) ?? []), row]);
  const result: Array<(typeof rows)[number] & { depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({ ...row, depth });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const row of rows) if (!seen.has(row.id)) result.push({ ...row, depth: 0 });
  return result;
}

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
