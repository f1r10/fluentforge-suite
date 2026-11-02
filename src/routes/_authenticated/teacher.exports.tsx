import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileArchive, FileJson2, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  createExport,
  getExportDownload,
  listExports,
  type ExportFormat,
  type ExportKind,
} from "@/lib/export.functions";
import {
  EXPORT_FORMATS,
  defaultExportFormat,
} from "@/lib/export-formats";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";
import { listTopics, listQuestions } from "@/lib/questions.functions";

export const Route = createFileRoute("/_authenticated/teacher/exports")({
  component: ExportCenter,
});

const EXPORT_OPTIONS: Array<{
  kind: ExportKind;
  titleKey: string;
  descriptionKey: string;
}> = [
  { kind: "questions", titleKey: "export_questions", descriptionKey: "export_questions_hint" },
  { kind: "vocabulary", titleKey: "export_vocabulary", descriptionKey: "export_vocabulary_hint" },
  { kind: "readings", titleKey: "export_readings", descriptionKey: "export_readings_hint" },
  { kind: "listenings", titleKey: "export_listenings", descriptionKey: "export_listenings_hint" },
  { kind: "catalogs", titleKey: "export_catalogs", descriptionKey: "export_catalogs_hint" },
  { kind: "exams", titleKey: "export_exams", descriptionKey: "export_exams_hint" },
  { kind: "activity", titleKey: "export_activity", descriptionKey: "export_activity_hint" },
  { kind: "results", titleKey: "export_results", descriptionKey: "export_results_hint" },
  { kind: "students", titleKey: "export_students", descriptionKey: "export_students_hint" },
  { kind: "analytics", titleKey: "export_analytics", descriptionKey: "export_analytics_hint" },
  { kind: "content_package", titleKey: "export_content_package", descriptionKey: "export_content_package_hint" },
];

function ExportCenter() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ExportKind>("questions");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [includeTrash, setIncludeTrash] = useState(false);
  const [includeAnswers, setIncludeAnswers] = useState(false);
  const [includeExplanations, setIncludeExplanations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [printLevel, setPrintLevel] = useState("");
  const [printLanguage, setPrintLanguage] = useState("");
  const [printTopicId, setPrintTopicId] = useState("");
  const [printPos, setPrintPos] = useState("");
  const [printSearch, setPrintSearch] = useState("");
  const [printQuestionPage, setPrintQuestionPage] = useState(0);
  const [printSelectedIds, setPrintSelectedIds] = useState<string[]>([]);
  const printable = (kind === "questions" || kind === "vocabulary") &&
    (format === "pdf" || format === "docx");
  const { data: printableTopics = [] } = useQuery({
    queryKey: ["print-topics"],
    queryFn: () => listTopics(),
    enabled: printable,
  });
  const { data: printableQuestions } = useQuery({
    queryKey: ["printable-questions", kind, printQuestionPage, printSearch, printLevel, printLanguage, printTopicId],
    queryFn: () => listQuestions({ data: {
      text: printSearch, type: "", level: printLevel,
      language: printLanguage, topicId: printTopicId || undefined,
      status: "active", page: printQuestionPage,
    }}),
    enabled: printable && kind === "questions",
  });

  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ["exports"],
    queryFn: () => listExports(),
  });

  async function generate() {
    setBusy(true);
    try {
      const result = await createExport({
        data: {
          kind,
          format,
          includeTrash,
          includeAnswers,
          includeExplanations,
          printSelection: printable && (
            printLevel || printLanguage || printTopicId || printPos ||
            printSearch || printSelectedIds.length
          ) ? {
            level: printLevel ? printLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" : undefined,
            language: printLanguage || undefined,
            topicId: printTopicId || undefined,
            partOfSpeech: kind === "vocabulary" ? printPos || undefined : undefined,
            search: printSearch || undefined,
            selectedIds: kind === "questions" && printSelectedIds.length
              ? printSelectedIds : undefined,
          } : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ["exports"] });
      openDownload(result.url, result.filename);
      toast.success(t("export_ready"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    setDownloadingId(id);
    try {
      const result = await getExportDownload({ data: { id } });
      openDownload(result.url, result.filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("export_center")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("export_center_hint")}</p>
      </div>

      <section className="grid gap-5 rounded-md border border-border p-5 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPORT_OPTIONS.map((option) => {
            const selected = kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => {
                  setKind(option.kind);
                  setPrintSelectedIds([]);
                  setPrintQuestionPage(0);
                  if (!EXPORT_FORMATS[option.kind].includes(format)) {
                    setFormat(defaultExportFormat(option.kind));
                  }
                }}
                className={[
                  "rounded-md border p-4 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-muted/40",
                ].join(" ")}
              >
                <div className="font-medium">{t(option.titleKey)}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t(option.descriptionKey)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-4 rounded-md bg-muted/30 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("format")}</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {EXPORT_FORMATS[kind].map((value) => (
                <option key={value} value={value}>
                  {value === "xlsx"
                    ? "Excel (.xlsx)"
                    : value === "json"
                      ? "Portable JSON"
                      : value === "csv"
                        ? "CSV"
                        : value === "docx"
                          ? "Word (.docx)"
                          : value === "pdf" && kind === "analytics"
                            ? "PDF report"
                            : "PDF"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {kind === "readings"
                ? t("export_readings_hint")
                : format === "csv"
                  ? t("csv_primary_table_hint")
                  : format === "pdf"
                    ? kind === "questions"
                      ? t("export_questions_hint")
                      : kind === "vocabulary"
                        ? t("export_vocabulary_hint")
                        : t("pdf_report_hint")
                    : t("full_export_format_hint")}
            </p>
          </div>

          {printable && (
            <div className="space-y-3 rounded-md border border-border bg-background p-3 text-sm">
              <div className="font-semibold">{t("print_builder_filters")}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs">{t("level")}</span>
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={printLevel} onChange={(e) => {
                      setPrintLevel(e.target.value); setPrintQuestionPage(0);
                    }}>
                    <option value="">{t("all")}</option>
                    {["A1","A2","B1","B2","C1","C2"].map((x) => <option value={x} key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs">{t("language")}</span>
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={printLanguage} onChange={(e) => {
                      setPrintLanguage(e.target.value); setPrintQuestionPage(0);
                    }}>
                    <option value="">{t("all")}</option>
                    {["en","az","ru","tr"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
                  </select>
                </label>
                <label className="col-span-2 space-y-1">
                  <span className="text-xs">{t("topics")}</span>
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={printTopicId} onChange={(e) => {
                      setPrintTopicId(e.target.value); setPrintQuestionPage(0);
                    }}>
                    <option value="">{t("all")}</option>
                    {printableTopics.map((topic) => (
                      <option key={topic.id} value={topic.id}>{topic.name}</option>
                    ))}
                  </select>
                </label>
                {kind === "vocabulary" && (
                  <label className="col-span-2 space-y-1">
                    <span className="text-xs">{t("part_of_speech")}</span>
                    <input className="h-9 w-full rounded-md border border-input bg-background px-2"
                      value={printPos} maxLength={50}
                      onChange={(e) => setPrintPos(e.target.value)}
                      placeholder="noun / verb / adjective" />
                  </label>
                )}
                <label className="col-span-2 space-y-1">
                  <span className="text-xs">{t("search")}</span>
                  <input className="h-9 w-full rounded-md border border-input bg-background px-2"
                    value={printSearch} maxLength={100}
                    onChange={(e) => { setPrintSearch(e.target.value); setPrintQuestionPage(0); }}
                    placeholder={t("print_builder_search_hint")} />
                </label>
              </div>
              {kind === "questions" && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold">
                    {t("print_builder_pick_questions")} ({printSelectedIds.length})
                  </div>
                  <p className="text-xs text-muted-foreground">{t("print_builder_empty_selection")}</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {(printableQuestions?.rows ?? []).map((question) => (
                      <label key={question.id} className="flex cursor-pointer items-start gap-2 py-1 text-xs">
                        <Checkbox checked={printSelectedIds.includes(question.id)}
                          onCheckedChange={(checked) => setPrintSelectedIds((old) =>
                            checked ? [...old.filter((id) => id !== question.id), question.id] :
                              old.filter((id) => id !== question.id)
                          )}/>
                        <span>{question.prompt.slice(0, 130)} · {question.level ?? "—"}</span>
                      </label>
                    ))}
                    {!printableQuestions?.rows.length && <p className="text-xs text-muted-foreground">{t("no_results")}</p>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button type="button" size="sm" variant="outline"
                      onClick={() => setPrintSelectedIds([])}>{t("clear")}</Button>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline"
                        disabled={printQuestionPage === 0}
                        onClick={() => setPrintQuestionPage((v) => Math.max(0,v-1))}>←</Button>
                      <span className="text-xs">{printQuestionPage+1}</span>
                      <Button type="button" size="sm" variant="outline"
                        disabled={!printableQuestions ||
                          (printQuestionPage+1)*printableQuestions.pageSize >= printableQuestions.total}
                        onClick={() => setPrintQuestionPage((v) => v+1)}>→</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={includeTrash}
              onCheckedChange={(value) => setIncludeTrash(!!value)}
            />
            <span>
              <span className="block font-medium">{t("include_trash")}</span>
              <span className="text-xs text-muted-foreground">{t("include_trash_hint")}</span>
            </span>
          </label>

          {kind === "questions" && (format === "pdf" || format === "docx") && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={includeAnswers}
                  onCheckedChange={(value) => setIncludeAnswers(!!value)}
                />
                <span>{t("correct_answer")}</span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={includeExplanations}
                  onCheckedChange={(value) => setIncludeExplanations(!!value)}
                />
                <span>{t("explanation")}</span>
              </label>
            </div>
          )}

          <div className="rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
            {t("export_security_hint")}
          </div>

          <Button className="w-full" onClick={generate} disabled={busy}>
            {format === "xlsx" ? (
              <FileSpreadsheet className="h-4 w-4" />
            ) : format === "json" ? (
              <FileJson2 className="h-4 w-4" />
            ) : format === "pdf" || format === "docx" ? (
              <FileText className="h-4 w-4" />
            ) : (
              <FileArchive className="h-4 w-4" />
            )}
            {busy ? t("exporting") : t("create_export")}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("export_history")}</h2>
          <p className="text-sm text-muted-foreground">{t("export_history_hint")}</p>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("type")}</th>
                <th className="px-3 py-2 font-medium">{t("format")}</th>
                <th className="px-3 py-2 font-medium">{t("status")}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("size")}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t("created_at")}</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("expires_at")}</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    {isFetching ? "…" : t("no_exports")}
                  </td>
                </tr>
              )}
              {jobs.map((job) => {
                const expired = new Date(job.expires_at).getTime() <= Date.now();
                return (
                  <tr key={job.id}>
                    <td className="px-3 py-2 font-medium">
                      {t(`export_kind_${job.kind}`)}
                    </td>
                    <td className="px-3 py-2 uppercase">{job.format}</td>
                    <td className="px-3 py-2">
                      {job.status === "failed" ? (
                        <span className="text-destructive">{t("failed")}</span>
                      ) : (
                        t(job.status)
                      )}
                      {job.error && (
                        <div className="max-w-md truncate text-xs text-destructive">
                          {job.error}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      {formatBytes(job.size_bytes)}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {formatDateTime(job.created_at, lang)}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                      {formatDateTime(job.expires_at, lang)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {job.status === "completed" && !expired && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={downloadingId === job.id}
                          onClick={() => download(job.id)}
                        >
                          <Download className="h-4 w-4" />
                          {t("download")}
                        </Button>
                      )}
                      {expired && (
                        <span className="text-xs text-muted-foreground">{t("expired")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function openDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatBytes(value: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
