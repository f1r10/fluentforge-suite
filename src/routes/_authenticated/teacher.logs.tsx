import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, Search, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listStudentActivityLogs,
  listSystemAuditLogs,
  listTechnicalLoginLogs,
} from "@/lib/logs.functions";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

type Tab = "activity" | "audit" | "technical";

export const Route = createFileRoute("/_authenticated/teacher/logs")({
  component: LogsPage,
});

function LogsPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>("activity");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState("all");
  const [loginResult, setLoginResult] = useState<
    "all" | "success" | "failed"
  >("all");

  const activity = useQuery({
    queryKey: ["student-activity-logs", search, category, page],
    queryFn: () =>
      listStudentActivityLogs({
        data: { search, category, page },
      }),
    enabled: tab === "activity",
  });

  const audit = useQuery({
    queryKey: ["system-audit-logs", search, page],
    queryFn: () =>
      listSystemAuditLogs({
        data: { search, page },
      }),
    enabled: tab === "audit",
  });

  const technical = useQuery({
    queryKey: ["technical-login-logs", search, loginResult, page],
    queryFn: () =>
      listTechnicalLoginLogs({
        data: { search, success: loginResult, page },
      }),
    enabled: tab === "technical",
  });

  const pageData =
    tab === "activity"
      ? activity.data
      : tab === "audit"
        ? audit.data
        : technical.data;
  const pages = Math.max(
    1,
    Math.ceil((pageData?.total ?? 0) / (pageData?.pageSize ?? 60)),
  );

  function changeTab(next: Tab) {
    setTab(next);
    setPage(0);
    setSearch("");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("logs")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("logs_hint")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === "activity" ? "default" : "outline"}
          onClick={() => changeTab("activity")}
        >
          <Activity className="h-4 w-4" />
          {t("student_activity_logs")}
        </Button>
        <Button
          variant={tab === "audit" ? "default" : "outline"}
          onClick={() => changeTab("audit")}
        >
          <ShieldCheck className="h-4 w-4" />
          {t("system_audit_logs")}
        </Button>
        <Button
          variant={tab === "technical" ? "default" : "outline"}
          onClick={() => changeTab("technical")}
        >
          <Wrench className="h-4 w-4" />
          {t("technical_logs")}
        </Button>
        <Link
          to="/teacher/monitoring"
          className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
        >
          {t("assessment_logs")} →
        </Link>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder={t("search")}
          />
        </div>

        {tab === "activity" ? (
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">{t("all")}</option>
            <option value="practice">{t("practice")}</option>
            <option value="exam">{t("exams")}</option>
            <option value="vocabulary">{t("vocabulary")}</option>
            <option value="activity">{t("activity")}</option>
          </select>
        ) : tab === "technical" ? (
          <select
            value={loginResult}
            onChange={(event) => {
              setLoginResult(event.target.value as typeof loginResult);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">{t("all")}</option>
            <option value="success">{t("successful")}</option>
            <option value="failed">{t("failed")}</option>
          </select>
        ) : (
          <span />
        )}
      </div>

      {tab === "activity" && (
        <ActivityTable
          rows={activity.data?.rows ?? []}
          loading={activity.isFetching}
          lang={lang}
          t={t}
        />
      )}
      {tab === "audit" && (
        <AuditTable
          rows={audit.data?.rows ?? []}
          loading={audit.isFetching}
          lang={lang}
          t={t}
        />
      )}
      {tab === "technical" && (
        <TechnicalTable
          rows={technical.data?.rows ?? []}
          loading={technical.isFetching}
          lang={lang}
          t={t}
        />
      )}

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

function ActivityTable({
  rows,
  loading,
  lang,
  t,
}: {
  rows: Awaited<ReturnType<typeof listStudentActivityLogs>>["rows"];
  loading: boolean;
  lang: string;
  t: (key: string) => string;
}) {
  return (
    <LogTable
      headers={[
        t("time"),
        t("student"),
        t("event"),
        t("category"),
        t("details"),
      ]}
      empty={loading ? "…" : t("no_activity")}
      rows={rows.map((row) => [
        formatDateTime(row.created_at, lang),
        row.student_name
          ? `${row.student_name} · ${row.username ?? ""}`
          : "—",
        humanize(row.event_type),
        humanize(row.category),
        row.details || "—",
      ])}
    />
  );
}

function AuditTable({
  rows,
  loading,
  lang,
  t,
}: {
  rows: Awaited<ReturnType<typeof listSystemAuditLogs>>["rows"];
  loading: boolean;
  lang: string;
  t: (key: string) => string;
}) {
  return (
    <LogTable
      headers={[
        t("time"),
        t("actor"),
        t("action"),
        t("entity"),
        t("details"),
      ]}
      empty={loading ? "…" : t("no_results")}
      rows={rows.map((row) => [
        formatDateTime(row.created_at, lang),
        row.actor_type,
        row.summary || humanize(row.action),
        row.entity_type
          ? `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ""}`
          : "—",
        [row.details, row.ip ? `IP: ${row.ip}` : ""]
          .filter(Boolean)
          .join(" · ") || "—",
      ])}
    />
  );
}

function TechnicalTable({
  rows,
  loading,
  lang,
  t,
}: {
  rows: Awaited<ReturnType<typeof listTechnicalLoginLogs>>["rows"];
  loading: boolean;
  lang: string;
  t: (key: string) => string;
}) {
  return (
    <LogTable
      headers={[
        t("time"),
        t("type"),
        t("identifier"),
        "IP",
        t("result"),
      ]}
      empty={loading ? "…" : t("no_results")}
      rows={rows.map((row) => [
        formatDateTime(row.created_at, lang),
        humanize(row.kind),
        row.identifier,
        row.ip || "—",
        row.success ? t("successful") : t("failed"),
      ])}
    />
  );
}

function LogTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, index) => (
              <tr key={index}>
                {cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={
                      cellIndex === 0
                        ? "whitespace-nowrap px-3 py-2 text-muted-foreground"
                        : "max-w-xl px-3 py-2"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
