import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { examSettingsSchema, listExamsDetailed, saveExam } from "@/lib/exam.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const examsQuery = queryOptions({ queryKey: ["exams-detailed"], queryFn: () => listExamsDetailed() });

export const Route = createFileRoute("/_authenticated/teacher/exams")({
  loader: ({ context }) => context.queryClient.ensureQueryData(examsQuery),
  component: ExamsPage,
});

function ExamsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(examsQuery);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    duration: "60",
    from: "",
    until: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await saveExam({
        data: {
          title: form.title,
          description: form.description || null,
          duration_minutes: form.duration ? Number(form.duration) : null,
          available_from: form.from ? new Date(form.from).toISOString() : null,
          available_until: form.until ? new Date(form.until).toISOString() : null,
          settings: examSettingsSchema.parse({}),
        },
      });
      setOpen(false);
      setForm({ title: "", description: "", duration: "60", from: "", until: "" });
      await qc.invalidateQueries({ queryKey: ["exams-detailed"] });
      window.location.href = `/teacher/exams/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("exams")}</h1>
          <p className="text-sm text-muted-foreground">{data.length} {t("exams").toLocaleLowerCase()}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("add_exam")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("title")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("sections")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("items")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("assignments")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("available_from")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("available_until")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("duration_min")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">{t("no_results")}</td>
              </tr>
            )}
            {data.map((exam) => (
              <tr key={exam.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    to="/teacher/exams/$id"
                    params={{ id: exam.id }}
                    className="flex items-start gap-2 font-medium hover:underline"
                  >
                    <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      {exam.title}
                      {exam.description && (
                        <span className="block max-w-md truncate text-xs font-normal text-muted-foreground">
                          {exam.description}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">{t(exam.status)}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{exam.sections}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{exam.items}</td>
                <td className="hidden px-3 py-2 md:table-cell">{exam.assignments}</td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">{formatDateTime(exam.available_from, lang)}</td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">{formatDateTime(exam.available_until, lang)}</td>
                <td className="hidden px-3 py-2 md:table-cell">{exam.duration_minutes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("add_exam")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("title")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <Label>{t("description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>{t("duration_min")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("available_from")}</Label>
                  <Input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("available_until")}</Label>
                  <Input type="datetime-local" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button type="submit" disabled={busy}>{t("create")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
