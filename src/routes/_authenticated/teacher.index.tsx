import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getTeacherDashboard } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const dashQuery = queryOptions({ queryKey: ["teacher-dashboard"], queryFn: () => getTeacherDashboard(), refetchInterval: 30_000 });

export const Route = createFileRoute("/_authenticated/teacher/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashQuery),
  component: Dashboard,
});

const EVENT_LABEL: Record<string, string> = { login: "signed in" };

function Dashboard() {
  const { t, lang } = useI18n();
  const { data } = useSuspenseQuery(dashQuery);
  const c = data.counts;
  const visible = new Set(data.visibleWidgets);
  const stats = [
    { label: t("students"), value: c.students, to: "/teacher/students" as const },
    { label: t("active_today"), value: c.activeToday, to: "/teacher/students" as const },
    { label: t("groups"), value: c.groups, to: "/teacher/groups" as const },
    { label: t("catalogs"), value: c.catalogs, to: "/teacher/catalogs" as const },
    { label: t("exams"), value: c.exams, to: "/teacher/exams" as const },
    { key: "students", label: t("students"), value: c.students, to: "/teacher/students" as const },
    { key: "active_today", label: t("active_today"), value: c.activeToday, to: "/teacher/students" as const },
    { key: "groups", label: t("groups"), value: c.groups, to: "/teacher/groups" as const },
    { key: "catalogs", label: t("catalogs"), value: c.catalogs, to: "/teacher/catalogs" as const },
    { key: "exams", label: t("exams"), value: c.exams, to: "/teacher/exams" as const },
    { key: "pending_reviews", label: t("pending_reviews"), value: c.pendingReviews, to: "/teacher/reviews" as const },
  ].filter((item) => visible.has(item.key));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <h1 className="text-2xl font-bold">{t("dashboard")}</h1>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="bg-background p-4 hover:bg-muted">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {visible.has("online_now") && <Section title={`${t("online_now")} (${data.online.length})`}>
          {data.online.length === 0 ? <Empty>{t("nobody_online")}</Empty> : (
            <ul className="divide-y divide-border">
              {data.online.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" />{o.first_name} {o.last_name}</span>
                  <span className="text-muted-foreground">{o.location ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>}

        {visible.has("recent_activity") && <Section title={t("recent_activity")}>
          {data.activity.length === 0 ? <Empty>{t("no_activity")}</Empty> : (
            <ul className="divide-y divide-border">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-3 py-2 text-sm">
                  <span className="w-28 shrink-0 text-muted-foreground">{formatDateTime(a.at, lang)}</span>
                  <span>{a.student ? `${a.student.first_name} ${a.student.last_name}` : ""} — {a.type === "login" ? t("logged_in") : EVENT_LABEL[a.type] ?? a.type}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>}

        {visible.has("upcoming_exams") && <Section title={t("upcoming_exams")} action={<Link to="/teacher/exams" className="text-sm text-primary hover:underline">{t("all")}</Link>}>
          {data.upcomingExams.length === 0 ? <Empty>{t("no_results")}</Empty> : (
            <ul className="divide-y divide-border">
              {data.upcomingExams.map((e) => (
                <li key={e.id} className="flex justify-between py-2 text-sm"><span>{e.title}</span><span className="text-muted-foreground">{t(e.status)}</span></li>
              ))}
            </ul>
          )}
        </Section>}

        {visible.has("recent_catalogs") && <Section title={t("recent_catalogs")} action={<Link to="/teacher/catalogs" className="text-sm text-primary hover:underline">{t("all")}</Link>}>
          {data.recentCatalogs.length === 0 ? <Empty>{t("no_results")}</Empty> : (
            <ul className="divide-y divide-border">
              {data.recentCatalogs.map((e) => (
                <li key={e.id} className="flex justify-between py-2 text-sm"><span>{e.name}</span><span className="text-muted-foreground">{formatDateTime(e.updated_at, lang)}</span></li>
              ))}
            </ul>
          )}
        </Section>}
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between border-b border-border pb-2"><h2 className="font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-sm text-muted-foreground">{children}</p>;
}
