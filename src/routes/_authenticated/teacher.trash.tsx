import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTrash, restoreTrashItem, TRASH_TYPES, type TrashType } from "@/lib/trash.functions";
import { runMaintenanceCleanup } from "@/lib/maintenance.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

type TypeFilter = "all" | TrashType;

export const Route = createFileRoute("/_authenticated/teacher/trash")({
  component: TrashPage,
});

function TrashPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [type, setType] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["trash-center", type, search],
    queryFn: () => listTrash({ data: { type, search } }),
    placeholderData: keepPreviousData,
  });

  async function restore(item: { type: TrashType; id: string }) {
    const key = `${item.type}:${item.id}`;
    setRestoring(key);
    try {
      await restoreTrashItem({ data: item });
      await qc.invalidateQueries();
      toast.success(t("trash_item_restored"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoring(null);
    }
  }

  async function permanentCleanup() {
    const confirmation = window.prompt(t("permanent_cleanup_prompt"), "");
    if (confirmation !== "PERMANENTLY DELETE") {
      if (confirmation !== null) toast.error(t("confirmation_did_not_match"));
      return;
    }
    setCleaning(true);
    try {
      const result = await runMaintenanceCleanup({
        data: { confirmation: "PERMANENTLY DELETE" },
      });
      await qc.invalidateQueries();
      const removed =
        result.result.questions +
        result.result.vocabulary +
        result.result.readings +
        result.result.listenings +
        result.result.catalogs +
        result.result.media;
      toast.success(
        removed > 0
          ? `${t("permanent_cleanup_complete")}: ${removed}`
          : t("nothing_to_cleanup"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCleaning(false);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trash2 className="h-5 w-5" />
            {t("trash")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("trash_hint")}</p>
        </div>
        <Link to="/teacher/settings" className="text-sm text-primary hover:underline">
          {t("retention_settings")} →
        </Link>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        {t("trash_retention_prefix")} <strong>{data?.retention_days ?? 30}</strong>{" "}
        {t("days").toLocaleLowerCase()}.
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("search")}
          />
        </div>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as TypeFilter)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">{t("all")}</option>
          {TRASH_TYPES.map((value) => (
            <option key={value} value={value}>{t(value)}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("type")}</th>
              <th className="px-3 py-2 font-medium">{t("name")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("trashed_at")}</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  {isFetching ? "…" : t("trash_empty")}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const key = `${row.type}:${row.id}`;
              return (
                <tr key={key}>
                  <td className="px-3 py-2">{t(row.type)}</td>
                  <td className="max-w-xl px-3 py-2">
                    <div className="truncate font-medium">{row.title}</div>
                    {row.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">{row.subtitle}</div>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{t(row.status)}</td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                    {formatDateTime(row.trashed_at, lang)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={restoring === key}
                      onClick={() => restore(row)}
                      aria-label={t("restore")}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-3 rounded-md border border-destructive/30 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">{t("permanent_cleanup")}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t("permanent_cleanup_hint")}</p>
          </div>
        </div>
        <Button variant="destructive" onClick={permanentCleanup} disabled={cleaning}>
          <Trash2 className="h-4 w-4" />
          {t("delete_expired_permanently")}
        </Button>
      </section>
    </div>
  );
}
