import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderOpen } from "lucide-react";
import { listStudentCatalogs } from "@/lib/practice.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/catalogs/")({
  head: () => ({
    meta: [
      { title: "My catalogs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentCatalogsPage,
});

function StudentCatalogsPage() {
  const { t } = useI18n();
  const { data: catalogs = [], isLoading } = useQuery({
    queryKey: ["student-catalogs"],
    queryFn: () => listStudentCatalogs(),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("my_catalogs")}</h1>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">…</div>
        ) : catalogs.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t("nothing_yet")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {catalogs.map((catalog) => (
              <Link
                key={catalog.id}
                to="/student/catalogs/$id"
                params={{ id: catalog.id }}
                className="flex items-start gap-3 p-4 hover:bg-muted/30"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{catalog.name}</div>
                  {catalog.description && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {catalog.description}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {catalog.items} {t("items").toLocaleLowerCase()}
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
