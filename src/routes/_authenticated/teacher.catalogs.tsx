import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createCatalog, listCatalogs } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const catalogsQuery = queryOptions({ queryKey: ["catalogs"], queryFn: () => listCatalogs() });

export const Route = createFileRoute("/_authenticated/teacher/catalogs")({
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogsQuery),
  component: CatalogsPage,
});

function CatalogsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(catalogsQuery);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await createCatalog({ data: f }); setOpen(false); setF({ name: "", description: "" }); qc.invalidateQueries({ queryKey: ["catalogs"] }); }
    catch (err) { toast.error(String(err)); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("catalogs")}</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("add_catalog")}</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">{t("name")}</th><th className="px-3 py-2 font-medium">{t("items")}</th><th className="hidden px-3 py-2 font-medium sm:table-cell">{t("last_active")}</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{t("no_results")}</td></tr>}
            {data.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2"><div className="font-medium">{c.name}</div>{c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}</td>
                <td className="px-3 py-2">{c.items}</td>
                <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{formatDateTime(c.updated_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("add_catalog")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2"><Label>{t("name")}</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></div>
              <div className="space-y-2"><Label>{t("description")}</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="submit">{t("create")}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
