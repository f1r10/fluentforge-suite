import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteGroup, listGroups, saveGroup } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";

const groupsQuery = queryOptions({ queryKey: ["groups"], queryFn: () => listGroups() });

export const Route = createFileRoute("/_authenticated/teacher/groups")({
  loader: ({ context }) => context.queryClient.ensureQueryData(groupsQuery),
  component: GroupsPage,
});

type G = { id?: string; name: string; description: string };

function GroupsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(groupsQuery);
  const [edit, setEdit] = useState<G | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    try { await saveGroup({ data: edit }); setEdit(null); qc.invalidateQueries({ queryKey: ["groups"] }); } catch (err) { toast.error(String(err)); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("groups")}</h1>
        <Button onClick={() => setEdit({ name: "", description: "" })}><Plus className="h-4 w-4" />{t("add_group")}</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">{t("name")}</th><th className="px-3 py-2 font-medium">{t("members")}</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{t("no_results")}</td></tr>}
            {data.map((g) => (
              <tr key={g.id}>
                <td className="px-3 py-2"><div className="font-medium">{g.name}</div>{g.description && <div className="text-xs text-muted-foreground">{g.description}</div>}</td>
                <td className="px-3 py-2">{g.members}</td>
                <td className="space-x-1 px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEdit({ id: g.id, name: g.name, description: g.description ?? "" })}>{t("edit")}</Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={async () => {
                    if (!confirm(`${t("delete")} "${g.name}"?`)) return;
                    await deleteGroup({ data: { id: g.id } }); qc.invalidateQueries({ queryKey: ["groups"] });
                  }}>{t("delete")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{edit.id ? t("edit") : t("add_group")}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2"><Label>{t("name")}</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required autoFocus /></div>
              <div className="space-y-2"><Label>{t("description")}</Label><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setEdit(null)}>{t("cancel")}</Button><Button type="submit">{t("save")}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
