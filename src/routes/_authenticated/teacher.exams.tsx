import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createExam, listExams } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const examsQuery = queryOptions({ queryKey: ["exams"], queryFn: () => listExams() });

export const Route = createFileRoute("/_authenticated/teacher/exams")({
  loader: ({ context }) => context.queryClient.ensureQueryData(examsQuery),
  component: ExamsPage,
});

function ExamsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(examsQuery);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", duration: "60", from: "", until: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createExam({ data: {
        title: f.title,
        duration_minutes: f.duration ? Number(f.duration) : null,
        available_from: f.from ? new Date(f.from).toISOString() : null,
        available_until: f.until ? new Date(f.until).toISOString() : null,
      } });
      setOpen(false); setF({ title: "", duration: "60", from: "", until: "" });
      qc.invalidateQueries({ queryKey: ["exams"] });
    } catch (err) { toast.error(String(err)); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("exams")}</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("add_exam")}</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("title")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("available_from")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("available_until")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("duration_min")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t("no_results")}</td></tr>}
            {data.map((x) => (
              <tr key={x.id}>
                <td className="px-3 py-2 font-medium">{x.title}</td>
                <td className="px-3 py-2">{t(x.status)}</td>
                <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{formatDateTime(x.available_from, lang)}</td>
                <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{formatDateTime(x.available_until, lang)}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{x.duration_minutes ?? "—"}</td>
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
              <div className="space-y-2"><Label>{t("title")}</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus /></div>
              <div className="space-y-2"><Label>{t("duration_min")}</Label><Input type="number" min={1} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>{t("available_from")}</Label><Input type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
                <div className="space-y-2"><Label>{t("available_until")}</Label><Input type="datetime-local" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="submit">{t("create")}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
