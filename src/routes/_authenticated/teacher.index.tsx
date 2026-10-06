import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getTeacherDashboard } from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/app/common";

const dashQuery = queryOptions({
  queryKey: ["teacher-dashboard"],
  queryFn: () => getTeacherDashboard(),
  refetchInterval: 30_000,
});

export const Route = createFileRoute("/_authenticated/teacher/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashQuery),
  component: Dashboard,
});

const EVENT_LABEL: Record<string, string> = { login: "signed in" };

function Dashboard() {
  const { t, lang } = useI18n();
  const { data } = useSuspenseQuery(dashQuery);
  const c = data.counts;

  const stats = {
    students: {
      label: t("students"),
      value: c.students,
      to: "/teacher/students" as const,
    },
    active_today: {
      label: t("active_today"),
      value: c.activeToday,
      to: "/teacher/students" as const,
    },
    groups: {
      label: t("groups"),
      value: c.groups,
      to: "/teacher/groups" as const,
    },
    catalogs: {
      label: t("catalogs"),
      value: c.catalogs,
      to: "/teacher/catalogs" as const,
    },
    exams: {
      label: t("exams"),
      value: c.exams,
      to: "/teacher/exams" as const,
    },
    pending_reviews: {
      label: t("pending_reviews"),
      value: c.pendingReviews,
      to: "/teacher/reviews" as const,
    },
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <h1 className="text-2xl font-bold">{t("dashboard")}</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {data.visibleWidgets.map((key) => {
          if (key in stats) {
            const stat = stats[key as keyof typeof stats];
            return (
              <Link
                key={key}
                to={stat.to}
                className="rounded-md border border-border bg-background p-4 hover:bg-muted md:col-span-1 lg:col-span-2"
              >
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">
                  {stat.label}
                </div>
              </Link>
            );
          }

          if (key === "online_now") {
            return (
              <Section
                key={key}
                title={`${t("online_now")} (${data.online.length})`}
              >
                {data.online.length === 0 ? (
                  <Empty>{t("nobody_online")}</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.online.map((student) => (
                      <li
                        key={student.id}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-success" />
                          {student.first_name} {student.last_name}
                        </span>
                        <span className="text-muted-foreground">
                          {student.location ?? ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          }

          if (key === "recent_activity") {
            return (
              <Section key={key} title={t("recent_activity")}>
                {data.activity.length === 0 ? (
                  <Empty>{t("no_activity")}</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.activity.map((activity) => (
                      <li key={activity.id} className="flex gap-3 py-2 text-sm">
                        <span className="w-28 shrink-0 text-muted-foreground">
                          {formatDateTime(activity.at, lang)}
                        </span>
                        <span>
                          {activity.student
                            ? `${activity.student.first_name} ${activity.student.last_name}`
                            : ""}{" "}
                          —{" "}
                          {activity.type === "login"
                            ? t("logged_in")
                            : EVENT_LABEL[activity.type] ?? activity.type}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          }

          if (key === "upcoming_exams") {
            return (
              <Section
                key={key}
                title={t("upcoming_exams")}
                action={
                  <Link
                    to="/teacher/exams"
                    className="text-sm text-primary hover:underline"
                  >
                    {t("all")}
                  </Link>
                }
              >
                {data.upcomingExams.length === 0 ? (
                  <Empty>{t("no_results")}</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.upcomingExams.map((exam) => (
                      <li
                        key={exam.id}
                        className="flex justify-between py-2 text-sm"
                      >
                        <span>{exam.title}</span>
                        <span className="text-muted-foreground">
                          {t(exam.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          }

          if (key === "recent_catalogs") {
            return (
              <Section
                key={key}
                title={t("recent_catalogs")}
                action={
                  <Link
                    to="/teacher/catalogs"
                    className="text-sm text-primary hover:underline"
                  >
                    {t("all")}
                  </Link>
                }
              >
                {data.recentCatalogs.length === 0 ? (
                  <Empty>{t("no_results")}</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentCatalogs.map((catalog) => (
                      <li
                        key={catalog.id}
                        className="flex justify-between gap-3 py-2 text-sm"
                      >
                        <span>{catalog.name}</span>
                        <span className="text-muted-foreground">
                          {formatDateTime(catalog.updated_at, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border p-4 md:col-span-2 lg:col-span-3">
      <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-sm text-muted-foreground">{children}</p>;
}
