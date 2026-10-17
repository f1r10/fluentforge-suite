import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listTeacherNotifications,
  markTeacherNotification,
} from "@/lib/notifications.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute(
  "/_authenticated/teacher/notifications",
)({
  component: TeacherNotifications,
});

function TeacherNotifications() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["teacher-notifications", unreadOnly, page],
    queryFn: () =>
      listTeacherNotifications({
        data: { unreadOnly, page },
      }),
  });

  const rows = data?.rows ?? [];
  const pageSize = data?.pageSize ?? 50;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function markAll() {
    await markTeacherNotification({
      data: { all: true, unread: false },
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["teacher-notifications"] }),
      qc.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
    ]);
  }

  async function markOne(id: string) {
    await markTeacherNotification({
      data: { id, all: false, unread: false },
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["teacher-notifications"] }),
      qc.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bell className="h-5 w-5" />
            {t("notifications")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("teacher_notifications_hint")}
          </p>
        </div>
        <Button variant="outline" onClick={markAll}>
          <CheckCheck className="h-4 w-4" />
          {t("mark_all_read")}
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={unreadOnly}
          onCheckedChange={(checked) => {
            setUnreadOnly(!!checked);
            setPage(0);
          }}
        />
        {t("unread_only")}
      </label>

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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{row.title}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(row.created_at, lang)}
                </div>
              </div>
              {!row.read_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markOne(row.id)}
                >
                  {t("mark_read")}
                </Button>
              )}
            </div>
            {row.body && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {row.body}
              </p>
            )}
            {row.link && (
              <Link
                to={row.link as never}
                className="inline-block text-sm text-primary hover:underline"
                onClick={() => !row.read_at && void markOne(row.id)}
              >
                {t("open")}
              </Link>
            )}
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {page + 1} / {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            →
          </Button>
        </div>
      </div>
    </div>
  );
}
