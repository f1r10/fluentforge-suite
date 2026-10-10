import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { listCatalogsDetailed } from "@/lib/catalog.functions";
import { useI18n } from "@/lib/i18n";

export function CatalogTargetSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (catalogId: string) => void;
}) {
  const { t } = useI18n();
  const { data = [], isFetching } = useQuery({
    queryKey: ["catalogs-detailed"],
    queryFn: () => listCatalogsDetailed(),
  });

  return (
    <div className="space-y-2">
      <Label>{t("add_to_catalog")}</Label>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        disabled={isFetching}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">— {t("none")} —</option>
        {data
          .filter((catalog) => catalog.status !== "archived")
          .map((catalog) => (
            <option key={catalog.id} value={catalog.id}>
              {catalog.name}
            </option>
          ))}
      </select>
    </div>
  );
}
