import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCatalog } from "@/lib/catalog.functions";
import { useI18n } from "@/lib/i18n";
import { lessonText } from "@/lib/lesson-copy";
import {
  getTeacherLesson, saveLessonDraft, publishLessonDraft, type LessonStep,
} from "@/lib/lesson-mode.functions";

export const Route = createFileRoute("/_authenticated/teacher/lessons/$id")({
  component: LessonEditor,
  head: () => ({ meta: [{ title: "Lesson mode | FluentForge" }] }),
});

type Draft = { title: string; description: string; sequential: boolean; enforce_catalog_locks: boolean; steps: LessonStep[] };
const emptyDraft: Draft = { title: "", description: "", sequential: true, enforce_catalog_locks: false, steps: [] };

function LessonEditor() {
  const { lang } = useI18n();
  const l = (key: string) => lessonText(lang, key);
  const { id } = Route.useParams();
  const { data: catalog, isPending: loadingCatalog } = useQuery({
    queryKey: ["lesson-catalog", id],
    queryFn: () => getCatalog({ data: { id } }),
  });
  const { data: versions, isPending: loadingLesson, refetch } = useQuery({
    queryKey: ["teacher-lesson", id],
    queryFn: () => getTeacherLesson({ data: { catalogId: id } }),
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!versions) return;
    const source = versions.draft ?? versions.published;
    setDraft({
      title: source?.title || versions.catalog.name,
      description: source?.description ?? "",
      sequential: source?.sequential ?? true,
      enforce_catalog_locks: source?.enforce_catalog_locks ?? false,
      steps: Array.isArray(source?.steps) ? source.steps as unknown as LessonStep[] : [],
    });
  }, [versions]);

  const change = (stepId: string, patch: Partial<LessonStep>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    }));
  };

  const addTheory = () => setDraft((current) => ({
    ...current,
    steps: [...current.steps, {
      id: crypto.randomUUID(),
      kind: "theory",
      title: "Theory",
      required: true,
      mode: "view",
      body: "",
    }],
  }));

  const addActivity = (itemId: string) => {
    const item = catalog?.items.find((entry) => entry.id === itemId);
    if (!item || !item.available || item.status !== "active") {
      toast.error("Select an active catalog item.");
      return;
    }
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, {
        id: crypto.randomUUID(),
        kind: "activity",
        title: item.title.slice(0, 200),
        itemId: item.id,
        required: true,
        mode: ["reading", "listening"].includes(item.entity_type) ? "view" : "attempt",
      }],
    }));
  };

  const move = (index: number, offset: number) => setDraft((current) => {
    const next = [...current.steps];
    const target = index + offset;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return { ...current, steps: next };
  });

  async function save() {
    setSaving(true);
    try {
      await saveLessonDraft({ data: { catalogId: id, ...draft } });
      toast.success("Lesson draft saved.");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the lesson.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!draft.steps.length) {
      toast.error("Add at least one lesson step before publishing.");
      return;
    }
    setSaving(true);
    try {
      // Publish the exact state currently displayed in the editor. Publishing
      // an older saved draft while local edits are pending loses the teacher's
      // changes and is dangerously misleading.
      const saved = await saveLessonDraft({ data: { catalogId: id, ...draft } });
      await publishLessonDraft({ data: { catalogId: id, draftId: saved.id } });
      toast.success("Current lesson saved and published as an immutable revision.");
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish the lesson.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingCatalog || loadingLesson) {
    return <div className="p-6 text-sm text-muted-foreground">{l("Loading lesson workspace…")}</div>;
  }
  if (!catalog || !versions) {
    return <div className="p-6">{l("Lesson workspace unavailable.")}</div>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/teacher/catalogs/$id" params={{ id }}
            className="text-sm text-muted-foreground underline">← {l("Back to catalog")}</Link>
          <h1 className="mt-2 text-2xl font-semibold">{l("Lesson Mode")} — {catalog.name}</h1>
          <p className="text-sm text-muted-foreground">
            {l("Create ordered steps from existing catalog content. Publish a new revision without changing learners' prior results.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={saving}>{l("Save draft")}</Button>
          <Button onClick={publish} disabled={saving || draft.steps.length === 0}>
            {l("Publish draft")}
          </Button>
        </div>
      </div>

      {versions.published && (
        <p className="rounded-md border p-3 text-sm">
          {l("Published revision")} {versions.published.revision} ·
          {versions.published.published_at?.slice(0, 10)}
        </p>
      )}

      <section className="space-y-3 rounded-md border p-4">
        <label className="block space-y-1 text-sm font-medium">{l("Lesson title")}
          <Input value={draft.title}
            onChange={(event) => setDraft((x) => ({ ...x, title: event.target.value }))}
            maxLength={200} />
        </label>
        <label className="block space-y-1 text-sm font-medium">{l("Description")}
          <Textarea value={draft.description}
            onChange={(event) => setDraft((x) => ({ ...x, description: event.target.value }))}
            rows={2} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.sequential}
            onChange={(event) => setDraft((x) => ({ ...x, sequential: event.target.checked }))}/>
          {l("Lock later required activities until earlier required steps are completed")}
        </label>
        <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
          <input className="mt-1" type="checkbox" checked={draft.enforce_catalog_locks}
            onChange={(event) => setDraft((x) => ({
              ...x, enforce_catalog_locks: event.target.checked,
            }))}/>
          <span>
            <span className="font-medium">{l("Restrict catalog practice to unlocked lesson activities")}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {l("Off by default. Publishing a lesson does not restrict existing catalog practice unless enabled.")}
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">{l("Lesson steps")} ({draft.steps.length}/100)</h2>
          <Button variant="outline" onClick={addTheory}
            disabled={draft.steps.length >= 100}>{l("Add theory")}</Button>
          <label className="text-sm">
            <span className="sr-only">Add catalog activity</span>
            <select
              className="h-9 max-w-60 rounded-md border bg-background px-2"
              value="" disabled={draft.steps.length >= 100}
              onChange={(event) => { if (event.target.value) addActivity(event.target.value); }}>
              <option value="">{l("Add catalog activity…")}</option>
              {catalog.items.filter((item) => item.available && item.status === "active").map((item) => (
                <option key={item.id} value={item.id}>
                  {item.entity_type}: {item.title.slice(0, 75)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {draft.steps.length === 0 && (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {l("Add a theory explanation or an activity from this catalog.")}
          </p>
        )}

        {draft.steps.map((step, index) => (
          <article key={step.id} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{l("Step")} {index + 1} — {l(step.kind === "theory" ? "Theory" : "Activity")}</span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" disabled={index === 0}
                onClick={() => move(index, -1)}>↑</Button>
              <Button size="sm" variant="outline" disabled={index === draft.steps.length - 1}
                onClick={() => move(index, 1)}>↓</Button>
              <Button size="sm" variant="outline"
                onClick={() => setDraft((x) => ({
                  ...x, steps: x.steps.filter((item) => item.id !== step.id),
                }))}>{l("Remove")}</Button>
            </div>
            <label className="block space-y-1 text-sm font-medium">
              {l("Step title")}
              <Input value={step.title}
                onChange={(event) => change(step.id, { title: event.target.value })} />
            </label>
            {step.kind === "theory" ? (
              <label className="block space-y-1 text-sm font-medium">
                {l("Lesson explanation")}
                <Textarea rows={6} value={step.body ?? ""}
                  onChange={(event) => change(step.id, { body: event.target.value })} />
              </label>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>{l("Complete by:")}</span>
                <select className="rounded-md border bg-background p-2"
                  value={step.mode}
                  onChange={(event) => {
                    const mode = event.target.value as "view" | "attempt" | "pass";
                    change(step.id, {
                      mode,
                      minScorePercent: mode === "pass" ? (step.minScorePercent ?? 70) : undefined,
                    });
                  }}>
                  {["reading", "listening"].includes(
                    catalog.items.find((item) => item.id === step.itemId)?.entity_type ?? "",
                  ) ? (
                    <option value="view">{l("View or listen without a grade")}</option>
                  ) : (
                    <>
                      <option value="attempt">{l("Attempting the activity")}</option>
                      <option value="pass">{l("Passing with minimum score")}</option>
                    </>
                  )}
                </select>
                {step.mode === "pass" && (
                  <label className="flex items-center gap-2">
                    {l("Min. score %")}
                    <Input className="w-24" type="number" min="0" max="100"
                      value={step.minScorePercent ?? 70}
                      onChange={(event) => change(step.id, {
                        minScorePercent: Number(event.target.value),
                      })}/>
                  </label>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={step.required}
                onChange={(event) => change(step.id, { required: event.target.checked })}/>
              {l("Required for completion")}
            </label>
          </article>
        ))}
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={save} disabled={saving}>{l("Save draft")}</Button>
        <Button onClick={publish} disabled={saving || draft.steps.length === 0}>{l("Publish draft")}</Button>
      </div>
    </main>
  );
}
