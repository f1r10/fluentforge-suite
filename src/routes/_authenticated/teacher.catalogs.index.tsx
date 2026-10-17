import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Folder, FolderPlus, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listCatalogsDetailed, saveCatalog, type CatalogSettings } from "@/lib/catalog.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const catalogsQuery = queryOptions({
  queryKey: ["catalogs-detailed"],
  queryFn: () => listCatalogsDetailed(),
});

type CatalogRow = Awaited<ReturnType<typeof listCatalogsDetailed>>[number];
type FlatCatalog = CatalogRow & { depth: number };

const defaults: CatalogSettings = {
  shuffle_questions: true,
  shuffle_vocabulary: true,
  preserve_context: true,
  feedback_mode: "instant",
  show_explanations: true,
  allow_self_practice: true,
};

function flattenCatalogs(rows: CatalogRow[]) {
  const byParent = new Map<string | null, CatalogRow[]>();
  for (const row of rows) {
    const key = row.parent_id ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }

  const result: FlatCatalog[] = [];
  const visited = new Set<string>();

  const visit = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      result.push({ ...row, depth });
      visit(row.id, depth + 1);
    }
  };

  visit(null, 0);

  for (const row of rows) {
    if (!visited.has(row.id)) result.push({ ...row, depth: 0 });
  }

  return result;
}

export const Route = createFileRoute("/_authenticated/teacher/catalogs/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogsQuery),
  component: CatalogsPage,
});

function CatalogsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(catalogsQuery);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState("");
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);

  const flat = useMemo(() => flattenCatalogs(data), [data]);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return flat;
    return flat.filter((row) =>
      [row.name, row.description ?? ""].some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [flat, search]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await saveCatalog({
        data: {
          name: form.name,
          description: form.description || null,
          parent_id: parentId || null,
          status: "active",
          settings: defaults,
        },
      });
      setOpen(false);
      setForm({ name: "", description: "" });
      setParentId("");
      await qc.invalidateQueries({ queryKey: ["catalogs-detailed"] });
      toast.success(t("create"));
      window.location.href = `/teacher/catalogs/${result.id}`;
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
          <h1 className="text-2xl font-bold">{t("catalogs")}</h1>
          <p className="text-sm text-muted-foreground">{data.length} {t("catalogs").toLocaleLowerCase()}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("add_catalog")}
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")} />
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("name")}</th>
              <th className="px-3 py-2 font-medium">{t("items")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("assignments")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("last_active")}</th>
              <th className="w-28 px-3 py-2 font-medium">{t("edit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {t("no_results")}
                </td>
              </tr>
            )}
            {visible.map((catalog) => (
              <tr key={catalog.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    to="/teacher/catalogs/$id"
                    params={{ id: catalog.id }}
                    className="flex items-start gap-2 font-medium hover:underline"
                    style={{ paddingLeft: catalog.depth * 18 }}
                  >
                    <Folder className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      {catalog.name}
                      {catalog.description && (
                        <span className="block max-w-xl truncate text-xs font-normal text-muted-foreground">
                          {catalog.description}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">{catalog.items}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{catalog.assignments}</td>
                <td className="hidden px-3 py-2 md:table-cell">{t(catalog.status)}</td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                  {formatDateTime(catalog.updated_at, lang)}
                </td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/teacher/catalogs/$id" params={{ id: catalog.id }}>
                      {t("edit")}
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("add_catalog")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={create} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <Label>{t("description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("parent_catalog")}</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— {t("root_catalog")} —</option>
                  {flat
                    .filter((row) => row.status !== "archived")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {"— ".repeat(row.depth)}
                        {row.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <div className="flex gap-2">
                  <FolderPlus className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("catalog_create_hint")}</span>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={busy}>
                  {t("create")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
