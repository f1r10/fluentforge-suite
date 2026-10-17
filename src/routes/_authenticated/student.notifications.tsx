import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listMyNotifications,
  markMyNotification,
} from "@/lib/notifications.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute(
  "/_authenticated/student/notifications",
)({
  component: StudentNotifications,
});

function StudentNotifications() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data, isFetching } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () =>
      listMyNotifications({
        data: { page: 0, unreadOnly: false },
      }),
  });

  async function markAll() {
    await markMyNotification({ data: { all: true } });
    await qc.invalidateQueries({ queryKey: ["my-notifications"] });
  }

  async function markOne(id: string) {
    await markMyNotification({
      data: { id, all: false },
    });
    await qc.invalidateQueries({ queryKey: ["my-notifications"] });
  }

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Bell className="h-5 w-5" />
            {t("notifications")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("student_notifications_hint")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={markAll}>
          <CheckCheck className="h-4 w-4" />
          {t("mark_all_read")}
        </Button>
      </div>

      <Link
        to="/student"
        className="inline-block text-sm text-primary hover:underline"
      >
        ← {t("dashboard")}
      </Link>

      <div className="divide-y divide-border rounded-md border border-border">
        {!rows.length && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {isFetching ? "…" : t("no_notifications")}
          </div>
        )}
        {rows.map((row) => (
          <article
            key={row.id}
            className={
              "space-y-1 p-4 " +
              (row.read_at ? "" : "bg-primary/[0.035]")
            }
          >
            <div className="font-medium">{row.title}</div>
            <div className="text-xs text-muted-foreground">
              {formatDateTime(row.created_at, lang)}
            </div>
            {row.body && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {row.body}
              </p>
            )}
            <div className="flex items-center gap-3 pt-1">
              {row.link && (
                <Link
                  to={row.link as never}
                  className="text-sm text-primary hover:underline"
                  onClick={() => !row.read_at && void markOne(row.id)}
                >
                  {t("open")}
                </Link>
              )}
              {!row.read_at && (
                <button
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => markOne(row.id)}
                >
                  {t("mark_read")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
