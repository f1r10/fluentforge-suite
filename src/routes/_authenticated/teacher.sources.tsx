import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  approveAllReadyItems,
  approveHighConfidenceItems,
  commitDocumentImport,
  createSourceUploadSession,
  finalizeSourceUpload,
  getDocumentImport,
  getSourcePreviewUrl,
  listDocumentImports,
  listImportProfiles,
  saveImportProfile,
  startDocumentImport,
  syncDocumentImport,
  updateImportItem,
} from "@/lib/document-import.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

const importTargetSchema = z.enum([
  "auto",
  "questions",
  "vocabulary",
  "readings",
  "listenings",
  "mixed",
]);
type ImportTarget = z.infer<typeof importTargetSchema>;

export const Route = createFileRoute("/_authenticated/teacher/sources")({
  validateSearch: (search) =>
    z
      .object({ target: importTargetSchema.optional() })
      .parse(search),
  component: SourcesPage,
});

type ImportRow = Awaited<ReturnType<typeof listDocumentImports>>[number];
type ImportDetail = Awaited<ReturnType<typeof getDocumentImport>>;

function SourcesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { target: routeTarget } = Route.useSearch();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [expectedContent, setExpectedContent] = useState<ImportTarget>(
    routeTarget ?? "auto",
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickLearningLanguage, setQuickLearningLanguage] = useState("en");
  const [quickTranslationLanguage, setQuickTranslationLanguage] = useState(
    lang === "en" ? "az" : lang,
  );
  const [autoEnrichVocabulary, setAutoEnrichVocabulary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<ImportRow | null>(null);

  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ["document-imports"],
    queryFn: () => listDocumentImports(),
    refetchInterval: 5_000,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["document-import-profiles"],
    queryFn: () => listImportProfiles(),
  });

  useEffect(() => {
    if (routeTarget) setExpectedContent(routeTarget);
  }, [routeTarget]);

  const activeIds = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "queued" || job.status === "processing")
        .map((job) => job.id),
    [jobs],
  );

  useEffect(() => {
    if (!activeIds.length) return;
    let cancelled = false;

    const run = async () => {
      for (const jobId of activeIds) {
        if (cancelled) return;
        try {
          await syncDocumentImport({ data: { jobId } });
        } catch {
          // Persisted error state will appear on the next poll.
        }
      }
      if (!cancelled) {
        await qc.invalidateQueries({ queryKey: ["document-imports"] });
      }
    };

    void run();
    const timer = window.setInterval(run, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeIds.join("|"), qc]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const session = await createSourceUploadSession({
        data: {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          keepOriginal,
        },
      });

      const { error } = await supabase.storage
        .from(session.bucket)
        .uploadToSignedUrl(session.path, session.token, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (error) throw error;

      const finalized = await finalizeSourceUpload({
        data: { sessionId: session.sessionId },
      });
      const started = await startDocumentImport({
        data: {
          sourceFileId: finalized.sourceFileId,
          mode: "review",
          profileId: profileId || null,
          expectedContent,
          learningLanguage:
            expectedContent === "vocabulary" && !profileId
              ? quickLearningLanguage
              : null,
          translationLanguage:
            expectedContent === "vocabulary" && !profileId
              ? quickTranslationLanguage
              : null,
          autoEnrichVocabulary:
            expectedContent === "vocabulary" && !profileId
              ? autoEnrichVocabulary
              : false,
        },
      });

      await qc.invalidateQueries({ queryKey: ["document-imports"] });
      toast.success(t("document_import_started"));
      const fresh = await listDocumentImports();
      const row = fresh.find((item) => item.id === started.jobId);
      if (row) setSelected(row);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("sources_imports")}</h1>
          <p className="text-sm text-muted-foreground">{t("sources_imports_hint")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm"
            value={expectedContent}
            onChange={(event) =>
              setExpectedContent(event.target.value as ImportTarget)
            }
            aria-label={t("import_target")}
          >
            <option value="auto">{t("import_target_auto")}</option>
            <option value="questions">{t("questions")}</option>
            <option value="readings">{t("readings")}</option>
            <option value="listenings">{t("listenings")}</option>
            <option value="vocabulary">{t("vocabulary")}</option>
            <option value="mixed">{t("mixed")}</option>
          </select>
          <select
            className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">{t("no_import_profile")}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={() => setProfileOpen(true)}>
            {t("new_import_profile")}
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={keepOriginal}
              onCheckedChange={(checked) => setKeepOriginal(!!checked)}
            />
            {t("keep_original")}
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.rtf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            disabled={
              uploading ||
              (expectedContent === "vocabulary" &&
                !profileId &&
                quickLearningLanguage === quickTranslationLanguage)
            }
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {uploading ? t("uploading") : t("upload_source")}
          </Button>
        </div>
      </div>

      {expectedContent === "vocabulary" && !profileId && (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div>
            <div className="text-sm font-medium">{t("vocabulary_pair_language")}</div>
            <p className="text-xs text-muted-foreground">
              {t("vocabulary_pair_language_hint")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t("learning_language")}</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={quickLearningLanguage}
                onChange={(event) => setQuickLearningLanguage(event.target.value)}
              >
                <option value="en">English</option>
                <option value="az">Azərbaycanca</option>
                <option value="ru">Русский</option>
                <option value="tr">Türkçe</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t("translations")}</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={quickTranslationLanguage}
                onChange={(event) => setQuickTranslationLanguage(event.target.value)}
              >
                <option value="az">Azərbaycanca</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="tr">Türkçe</option>
              </select>
            </label>
          </div>
          {quickLearningLanguage === quickTranslationLanguage && (
            <p className="text-xs text-destructive">
              Learning and translation languages must be different.
            </p>
          )}
          <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={autoEnrichVocabulary}
              onCheckedChange={(checked) =>
                setAutoEnrichVocabulary(!!checked)
              }
            />
            <span>
              <span className="block font-medium">
                {t("auto_enrich_vocabulary_import")}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {t("auto_enrich_vocabulary_import_hint")}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        {t("document_import_pipeline_hint")}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("file")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("progress")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("method")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("created_at")}</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {isFetching ? "…" : t("no_import_jobs")}
                </td>
              </tr>
            )}
            {jobs.map((job) => {
              const source = job.source_files as unknown as {
                id: string;
                original_filename: string;
                mime_type: string | null;
                size_bytes: number | null;
                keep_original: boolean;
              } | null;
              return (
                <tr key={job.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{source?.original_filename ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {source?.mime_type ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Status value={job.status} />
                    {job.error && (
                      <div className="mt-1 max-w-sm truncate text-xs text-destructive">
                        {job.error}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{job.progress}%</td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    {job.extraction_method ?? "—"}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                    {formatDateTime(job.created_at, lang)}
                  </td>
                  <td className="px-2 py-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelected(job)}
                      aria-label={t("review")}
                    >
                      <FileSearch className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && <ImportReviewDialog job={selected} onClose={() => setSelected(null)} />}

      {profileOpen && (
        <ImportProfileDialog
          onClose={() => setProfileOpen(false)}
          onSaved={async (id) => {
            setProfileId(id);
            await qc.invalidateQueries({ queryKey: ["document-import-profiles"] });
            setProfileOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ImportProfileDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [expectedContent, setExpectedContent] = useState<ImportTarget>("auto");
  const [language, setLanguage] = useState("");
  const [translationLanguage, setTranslationLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [confidence, setConfidence] = useState(0.95);
  const [autoEnrichVocabulary, setAutoEnrichVocabulary] = useState(false);
  const [mappingEnabled, setMappingEnabled] = useState(false);
  const [mapping, setMapping] = useState({
    include_sheets: "",
    header_row: 1,
    first_data_row: "",
    sheet_as_section: false,
    multi_value_separator: "|",
    columns: {
      prompt: "",
      question_type: "",
      correct_answer: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      option_e: "",
      option_f: "",
      option_g: "",
      option_h: "",
      instructions: "",
      explanation: "",
      points: "",
      difficulty: "",
      learning_language: "",
      level: "",
      tags: "",
      section: "",
    },
  });
  const [busy, setBusy] = useState(false);

  function setMappingValue(
    key: "include_sheets" | "header_row" | "first_data_row" | "multi_value_separator",
    value: string | number,
  ) {
    setMapping((previous) => ({ ...previous, [key]: value }));
  }

  function setColumn(key: keyof typeof mapping.columns, value: string) {
    setMapping((previous) => ({
      ...previous,
      columns: { ...previous.columns, [key]: value },
    }));
  }

  async function save() {
    if (!name.trim()) return;
    if (
      mappingEnabled &&
      ["auto", "questions", "mixed"].includes(expectedContent) &&
      !mapping.columns.prompt.trim()
    ) {
      toast.error(t("mapping_prompt_required"));
      return;
    }

    setBusy(true);
    try {
      const firstDataRow = mapping.first_data_row.trim()
        ? Number(mapping.first_data_row)
        : null;
      const result = await saveImportProfile({
        data: {
          name: name.trim(),
          config: {
            expected_content: expectedContent,
            learning_language: language || null,
            translation_language:
              expectedContent === "vocabulary"
                ? translationLanguage || null
                : null,
            level: level || null,
            status,
            auto_approve_confidence: confidence,
            auto_enrich_vocabulary:
              expectedContent === "vocabulary"
                ? autoEnrichVocabulary
                : false,
            spreadsheet_mapping:
              mappingEnabled &&
              ["auto", "questions", "mixed"].includes(expectedContent)
              ? {
                  include_sheets: mapping.include_sheets
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  header_row: Number(mapping.header_row),
                  first_data_row: firstDataRow,
                  sheet_as_section: mapping.sheet_as_section,
                  multi_value_separator:
                    mapping.multi_value_separator.trim() || "|",
                  columns: Object.fromEntries(
                    Object.entries(mapping.columns).map(([key, value]) => [
                      key,
                      value.trim(),
                    ]),
                  ) as typeof mapping.columns,
                }
              : null,
          },
        },
      });
      await onSaved(result.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const columnFields: Array<
    [keyof typeof mapping.columns, string]
  > = [
    ["prompt", "mapping_col_prompt"],
    ["question_type", "mapping_col_type"],
    ["correct_answer", "mapping_col_answer"],
    ["instructions", "mapping_col_instructions"],
    ["explanation", "mapping_col_explanation"],
    ["points", "mapping_col_points"],
    ["difficulty", "mapping_col_difficulty"],
    ["learning_language", "mapping_col_language"],
    ["level", "mapping_col_level"],
    ["tags", "mapping_col_tags"],
    ["section", "mapping_col_section"],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("new_import_profile")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <input
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("profile_name")}
          />
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={expectedContent}
            onChange={(event) =>
              setExpectedContent(event.target.value as typeof expectedContent)
            }
          >
            <option value="auto">{t("auto")}</option>
            <option value="questions">{t("questions")}</option>
            <option value="vocabulary">{t("vocabulary")}</option>
            <option value="readings">{t("readings")}</option>
            <option value="listenings">{t("listenings")}</option>
            <option value="mixed">{t("mixed")}</option>
          </select>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="">{t("learning_language")}: —</option>
              <option value="en">English</option>
              <option value="az">Azərbaycanca</option>
              <option value="ru">Русский</option>
              <option value="tr">Türkçe</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="">{t("level")}: —</option>
              {["A1", "A2", "B1", "B2", "C1", "C2"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          {expectedContent === "vocabulary" && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="text-sm font-medium">
                {t("vocabulary_pair_language")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("vocabulary_pair_language_hint")}
              </p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={translationLanguage}
                onChange={(event) =>
                  setTranslationLanguage(event.target.value)
                }
              >
                <option value="">
                  {t("treat_second_column_as_definition")}
                </option>
                <option value="az">Azərbaycanca</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="tr">Türkçe</option>
              </select>
              <label className="flex items-start gap-2 rounded-md bg-muted/30 p-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={autoEnrichVocabulary}
                  onCheckedChange={(checked) =>
                    setAutoEnrichVocabulary(!!checked)
                  }
                />
                <span>
                  <span className="block font-medium">
                    {t("auto_enrich_vocabulary_import")}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {t("auto_enrich_vocabulary_import_hint")}
                  </span>
                </span>
              </label>
            </div>
          )}

          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as typeof status)
            }
          >
            <option value="draft">{t("draft")}</option>
            <option value="active">{t("active")}</option>
          </select>

          <label className="block text-sm">
            <span className="text-muted-foreground">
              {t("auto_approve_confidence")}: {Math.round(confidence * 100)}%
            </span>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.01"
              value={confidence}
              onChange={(event) => setConfidence(Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>

          {["auto", "questions", "mixed"].includes(expectedContent) && (
          <section className="space-y-4 rounded-md border border-border p-4">
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={mappingEnabled}
                onCheckedChange={(checked) => setMappingEnabled(!!checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t("advanced_spreadsheet_mapping")}
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  {t("advanced_spreadsheet_mapping_hint")}
                </span>
              </span>
            </label>

            {mappingEnabled && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MappingField
                    label={t("mapping_header_row")}
                    value={String(mapping.header_row)}
                    type="number"
                    onChange={(value) =>
                      setMappingValue(
                        "header_row",
                        Math.max(1, Number(value) || 1),
                      )
                    }
                  />
                  <MappingField
                    label={t("mapping_first_data_row")}
                    value={mapping.first_data_row}
                    type="number"
                    placeholder={t("automatic")}
                    onChange={(value) =>
                      setMappingValue("first_data_row", value)
                    }
                  />
                  <MappingField
                    label={t("mapping_sheet_allowlist")}
                    value={mapping.include_sheets}
                    placeholder="Sheet1, Questions"
                    onChange={(value) =>
                      setMappingValue("include_sheets", value)
                    }
                  />
                  <MappingField
                    label={t("mapping_separator")}
                    value={mapping.multi_value_separator}
                    onChange={(value) =>
                      setMappingValue("multi_value_separator", value)
                    }
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={mapping.sheet_as_section}
                    onCheckedChange={(checked) =>
                      setMapping((previous) => ({
                        ...previous,
                        sheet_as_section: !!checked,
                      }))
                    }
                  />
                  {t("mapping_sheet_as_section")}
                </label>

                <div>
                  <div className="text-sm font-medium">
                    {t("mapping_columns")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("mapping_columns_hint")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {columnFields.map(([key, label]) => (
                    <MappingField
                      key={key}
                      label={t(label)}
                      value={mapping.columns[key]}
                      required={key === "prompt"}
                      onChange={(value) => setColumn(key, value)}
                    />
                  ))}
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium">
                    {t("mapping_option_columns")}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {(
                      [
                        "option_a",
                        "option_b",
                        "option_c",
                        "option_d",
                        "option_e",
                        "option_f",
                        "option_g",
                        "option_h",
                      ] as const
                    ).map((key) => (
                      <MappingField
                        key={key}
                        label={key.replace("_", " ").toUpperCase()}
                        value={mapping.columns[key]}
                        onChange={(value) => setColumn(key, value)}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                  {t("mapping_section_hint")}
                </div>
              </div>
            )}
          </section>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              onClick={save}
              disabled={
                busy ||
                !name.trim() ||
                (mappingEnabled && !mapping.columns.prompt.trim())
              }
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MappingField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        min={type === "number" ? 1 : undefined}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ImportReviewDialog({ job, onClose }: { job: ImportRow; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["document-import", job.id],
    queryFn: () => getDocumentImport({ data: { jobId: job.id } }),
    refetchInterval: job.status === "queued" || job.status === "processing" ? 3_000 : false,
  });

  const { data: preview } = useQuery({
    queryKey: ["source-preview", job.id],
    queryFn: () => getSourcePreviewUrl({ data: { jobId: job.id } }),
    staleTime: 10 * 60 * 1000,
  });

  async function sync() {
    setBusy(true);
    try {
      await syncDocumentImport({ data: { jobId: job.id } });
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ["document-imports"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approveHighConfidence() {
    setBusy(true);
    try {
      await approveHighConfidenceItems({ data: { jobId: job.id, threshold: 0.9 } });
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approveAllReady() {
    setBusy(true);
    try {
      const result = await approveAllReadyItems({ data: { jobId: job.id } });
      toast.success(
        result.skipped
          ? `${t("approved")}: ${result.approved} · ${t("needs_review")}: ${result.skipped}`
          : `${t("approved")}: ${result.approved}`,
      );
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      let totalImported = 0;
      let result = await commitDocumentImport({ data: { jobId: job.id } });
      totalImported += result.imported;

      // Large vocabulary files are intentionally committed in bounded server
      // batches. Continue those batches here instead of making the teacher
      // click Import repeatedly or holding one request open for thousands of
      // database writes.
      let batches = 1;
      while (
        !result.completed &&
        (result.remainingApproved ?? 0) > 0 &&
        (result.remainingPending ?? 0) === 0 &&
        batches < 20
      ) {
        result = await commitDocumentImport({ data: { jobId: job.id } });
        totalImported += result.imported;
        batches += 1;
      }

      toast.success(
        result.completed
          ? `${t("imported")}: ${totalImported}`
          : `${t("imported")}: ${totalImported} · ${t("needs_review")}: ${result.remainingPending}`,
      );
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ["document-imports"] }),
        qc.invalidateQueries({ queryKey: ["questions"] }),
        qc.invalidateQueries({ queryKey: ["vocabulary"] }),
        qc.invalidateQueries({ queryKey: ["readings"] }),
        qc.invalidateQueries({ queryKey: ["listenings"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] max-w-[96vw] flex-col overflow-hidden xl:max-w-7xl">
        <DialogHeader className="shrink-0"><DialogTitle>{t("document_import_review")}</DialogTitle></DialogHeader>
        {isLoading || !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">…</div>
        ) : (
          <ReviewWorkspace
            data={data}
            preview={preview ?? null}
            busy={busy}
            onRefresh={sync}
            onApproveHigh={approveHighConfidence}
            onApproveAll={approveAllReady}
            onCommit={commit}
            onChanged={refetch}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewWorkspace({
  data,
  preview,
  busy,
  onRefresh,
  onApproveHigh,
  onApproveAll,
  onCommit,
  onChanged,
}: {
  data: ImportDetail;
  preview: { url: string | null; mimeType: string | null; filename: string } | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onApproveHigh: () => Promise<void>;
  onApproveAll: () => Promise<void>;
  onCommit: () => Promise<void>;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<
    "all" | "pending" | "needs_fix" | "ready" | "rejected"
  >(() => {
    if (data.items.some((item) => item.decision === "pending")) return "pending";
    if (data.items.some((item) => item.validation.state === "needs_fix")) {
      return "needs_fix";
    }
    return "all";
  });
  const pending = data.items.filter((item) => item.decision === "pending").length;
  const approved = data.items.filter((item) => item.decision === "approved").length;
  const duplicates = data.items.filter((item) => item.duplicate_of).length;
  const needsFix = data.items.filter(
    (item) => item.validation.state === "needs_fix",
  ).length;
  const ready = data.items.filter(
    (item) =>
      item.decision === "approved" &&
      item.validation.state === "ready" &&
      !item.created_entity_id,
  ).length;
  const rejected = data.items.filter((item) => item.decision === "rejected").length;
  const extractedPreviewText = data.items
    .map((item) => {
      const payload = item.payload as Record<string, unknown>;
      if (typeof payload["text"] === "string") return payload["text"];
      if (typeof payload["body"] === "string") return payload["body"];
      if (typeof payload["transcript"] === "string" && payload["transcript"]) {
        return payload["transcript"];
      }
      if (typeof payload["prompt"] === "string") return payload["prompt"];
      if (typeof payload["word"] === "string") return payload["word"];
      if (typeof payload["title"] === "string") return payload["title"];
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 200_000);

  const visibleItems = data.items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "pending") return item.decision === "pending";
    if (filter === "needs_fix") return item.validation.state === "needs_fix";
    if (filter === "ready") {
      return (
        item.decision === "approved" &&
        item.validation.state === "ready" &&
        !item.created_entity_id
      );
    }
    return item.decision === "rejected";
  });

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[1fr_1.2fr]">
      <section className="min-h-0 overflow-hidden rounded-md border border-border">
        <div className="border-b border-border p-3">
          <div className="font-medium">{preview?.filename ?? t("source")}</div>
          <div className="text-xs text-muted-foreground">{preview?.mimeType ?? "—"}</div>
        </div>
        <div className="h-full min-h-0 overflow-auto bg-muted/20 p-2">
          <SourcePreview
            preview={preview}
            fallbackText={extractedPreviewText}
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span>{t("status")}: <strong>{data.job.status}</strong></span>
            <span>{t("progress")}: <strong>{data.job.progress}%</strong></span>
            <span>{t("pending")}: <strong>{pending}</strong></span>
            <span>{t("needs_review")}: <strong>{needsFix}</strong></span>
            <span>{t("approved")}: <strong>{approved}</strong></span>
            <span>{t("duplicates")}: <strong>{duplicates}</strong></span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(data.job.status === "queued" || data.job.status === "processing") && (
              <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
                {t("refresh")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || pending === 0}
              onClick={onApproveAll}
            >
              {t("approve_all_ready")} ({pending - needsFix})
            </Button>
            <Button size="sm" variant="outline" disabled={busy || data.items.length === 0} onClick={onApproveHigh}>
              {t("approve_high_confidence")}
            </Button>
            <Button size="sm" disabled={busy || ready === 0} onClick={onCommit}>
              {t("import_approved")} ({ready})
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          {[
            ["all", t("all"), data.items.length],
            ["pending", t("pending"), pending],
            ["needs_fix", t("needs_review"), needsFix],
            ["ready", t("approved"), ready],
            ["rejected", t("rejected"), rejected],
          ].map(([value, label, count]) => (
            <Button
              key={String(value)}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() =>
                setFilter(
                  value as
                    | "all"
                    | "pending"
                    | "needs_fix"
                    | "ready"
                    | "rejected",
                )
              }
            >
              {String(label)} ({String(count)})
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto pr-1">
          {data.items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {data.job.status === "queued" || data.job.status === "processing"
                ? t("processing")
                : t("no_extracted_items")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {t("no_results")}
                </div>
              ) : (
                visibleItems.map((item) => (
                  <ImportItemCard key={item.id} item={item} onChanged={onChanged} />
                ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ImportItemCard({
  item,
  onChanged,
}: {
  item: ImportDetail["items"][number];
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(
    () => structuredClone(item.payload as Record<string, unknown>),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(structuredClone(item.payload as Record<string, unknown>));
    }
  }, [item.payload, editing]);

  const payload = item.payload as Record<string, unknown>;
  const questionPayload =
    payload["payload"] && typeof payload["payload"] === "object"
      ? (payload["payload"] as Record<string, unknown>)
      : null;
  const answerKey =
    payload["answer_key"] && typeof payload["answer_key"] === "object"
      ? (payload["answer_key"] as Record<string, unknown>)
      : null;
  const options = Array.isArray(questionPayload?.["options"])
    ? (questionPayload["options"] as Array<unknown>)
        .map((option) =>
          option && typeof option === "object"
            ? {
                id: String((option as Record<string, unknown>)["id"] ?? ""),
                text: String((option as Record<string, unknown>)["text"] ?? ""),
              }
            : null,
        )
        .filter(
          (option): option is { id: string; text: string } =>
            !!option?.id && !!option.text,
        )
    : [];
  const correct = Array.isArray(answerKey?.["correct"])
    ? (answerKey["correct"] as unknown[]).map(String).filter(Boolean)
    : [];
  const multiple = payload["question_type"] === "multiple_choice";
  const title =
    item.item_type === "question" && typeof payload["prompt"] === "string"
      ? payload["prompt"]
      : item.item_type === "vocabulary" && typeof payload["word"] === "string"
        ? payload["word"]
        : (item.item_type === "reading" || item.item_type === "listening") &&
            typeof payload["title"] === "string"
          ? payload["title"]
          : item.item_type === "raw_text" && typeof payload["text"] === "string"
            ? payload["text"].slice(0, 160)
            : item.item_type;

  async function update(
    decision: "pending" | "approved" | "rejected",
    nextPayload?: Record<string, unknown>,
  ) {
    setBusy(true);
    try {
      await updateImportItem({
        data: { id: item.id, decision, payload: nextPayload },
      });
      await onChanged();
      if (decision === "approved") toast.success(t("approved"));
      if (decision === "rejected") toast.success(t("rejected"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function setCorrectAnswer(optionId: string, checked: boolean) {
    const current = new Set(correct);
    if (multiple) {
      if (checked) current.add(optionId);
      else current.delete(optionId);
    } else {
      current.clear();
      if (checked) current.add(optionId);
    }
    const nextPayload = {
      ...payload,
      answer_key: {
        ...(answerKey ?? {}),
        correct: [...current],
      },
    };
    await update("pending", nextPayload);
  }

  async function saveSimpleEdit() {
    await update("pending", draft);
    setEditing(false);
  }

  function patchDraft(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function patchQuestionOption(index: number, text: string) {
    setDraft((current) => {
      const nested =
        current["payload"] && typeof current["payload"] === "object"
          ? { ...(current["payload"] as Record<string, unknown>) }
          : {};
      const nextOptions = Array.isArray(nested["options"])
        ? [...(nested["options"] as Array<Record<string, unknown>>)]
        : [];
      nextOptions[index] = { ...(nextOptions[index] ?? {}), text };
      nested["options"] = nextOptions;
      return { ...current, payload: nested };
    });
  }

  return (
    <article className="space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <strong className="text-foreground">{item.item_type}</strong>
            {item.page != null && <span>{t("page")} {item.page}</span>}
            {item.sheet && <span>{item.sheet}</span>}
            {item.confidence != null && (
              <span>{t("confidence")}: {Math.round(Number(item.confidence) * 100)}%</span>
            )}
            {item.duplicate_kind && (
              <span className="font-medium text-destructive">
                {t("duplicate")}: {item.duplicate_kind}
              </span>
            )}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm font-medium">
            {String(title ?? "—")}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Status value={item.decision} />
          <Status value={item.validation.state} />
        </div>
      </div>

      {item.validation.state === "needs_fix" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {item.item_type === "question" && options.length > 0 && correct.length === 0
            ? t("select_correct_answer_before_approve")
            : item.validation.message}
        </div>
      )}

      {item.item_type === "question" && options.length > 0 && !editing && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="text-xs font-medium text-muted-foreground">
            {multiple
              ? t("select_all_correct_answers")
              : t("select_correct_answer")}
          </div>
          {options.map((option) => {
            const checked = correct.includes(option.id);
            return (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-background"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  disabled={busy}
                  onCheckedChange={(value) =>
                    void setCorrectAnswer(option.id, !!value)
                  }
                />
                <strong className="w-6 shrink-0 uppercase">{option.id})</strong>
                <span className="flex-1">{option.text}</span>
                {checked && (
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {t("correct_answer")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {editing ? (
        <SimpleImportItemEditor
          itemType={item.item_type}
          draft={draft}
          onPatch={patchDraft}
          onPatchQuestionOption={patchQuestionOption}
        />
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-2">
        {!editing ? (
          <>
            <Button
              size="sm"
              variant={item.decision === "approved" ? "default" : "outline"}
              disabled={
                busy ||
                !!item.duplicate_of ||
                !!item.created_entity_id ||
                item.validation.state !== "ready"
              }
              onClick={() => update("approved")}
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant={item.decision === "rejected" ? "default" : "outline"}
              disabled={busy || !!item.created_entity_id}
              onClick={() => update("rejected")}
            >
              {t("reject")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !!item.created_entity_id}
              onClick={() => setEditing(true)}
            >
              {t("edit")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={saveSimpleEdit}>
              {t("save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft(
                  structuredClone(item.payload as Record<string, unknown>),
                );
                setEditing(false);
              }}
            >
              {t("cancel")}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function SimpleImportItemEditor({
  itemType,
  draft,
  onPatch,
  onPatchQuestionOption,
}: {
  itemType: string;
  draft: Record<string, unknown>;
  onPatch: (key: string, value: unknown) => void;
  onPatchQuestionOption: (index: number, text: string) => void;
}) {
  const { t } = useI18n();
  const inputClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const areaClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  if (itemType === "question") {
    const nested =
      draft["payload"] && typeof draft["payload"] === "object"
        ? (draft["payload"] as Record<string, unknown>)
        : {};
    const options = Array.isArray(nested["options"])
      ? (nested["options"] as Array<Record<string, unknown>>)
      : [];
    return (
      <div className="space-y-3 rounded-md border border-border bg-background p-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t("question")}</span>
          <Textarea
            rows={3}
            value={String(draft["prompt"] ?? "")}
            onChange={(event) => onPatch("prompt", event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t("instructions")}</span>
          <Textarea
            rows={2}
            value={String(draft["instructions"] ?? "")}
            onChange={(event) =>
              onPatch("instructions", event.target.value || null)
            }
          />
        </label>
        {options.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium">{t("options")}</div>
            {options.map((option, index) => (
              <label key={String(option["id"] ?? index)} className="grid grid-cols-[32px_1fr] items-center gap-2">
                <strong className="text-sm uppercase">
                  {String(option["id"] ?? index + 1)}
                </strong>
                <input
                  className={inputClass}
                  value={String(option["text"] ?? "")}
                  onChange={(event) =>
                    onPatchQuestionOption(index, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t("explanation")}</span>
          <Textarea
            rows={2}
            value={String(draft["explanation"] ?? "")}
            onChange={(event) =>
              onPatch("explanation", event.target.value || null)
            }
          />
        </label>
      </div>
    );
  }

  if (itemType === "vocabulary") {
    return (
      <div className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2">
        <SimpleField label={t("word")}>
          <input
            className={inputClass}
            value={String(draft["word"] ?? "")}
            onChange={(event) => onPatch("word", event.target.value)}
          />
        </SimpleField>
        <SimpleField label={t("part_of_speech")}>
          <input
            className={inputClass}
            value={String(draft["part_of_speech"] ?? "")}
            onChange={(event) =>
              onPatch("part_of_speech", event.target.value || null)
            }
          />
        </SimpleField>
        <div className="sm:col-span-2">
          <SimpleField label={t("definition")}>
            <Textarea
              rows={3}
              value={String(draft["definition"] ?? "")}
              onChange={(event) =>
                onPatch("definition", event.target.value || null)
              }
            />
          </SimpleField>
        </div>
      </div>
    );
  }

  if (itemType === "reading") {
    return (
      <div className="space-y-3 rounded-md border border-border bg-background p-3">
        <SimpleField label={t("title")}>
          <input
            className={inputClass}
            value={String(draft["title"] ?? "")}
            onChange={(event) => onPatch("title", event.target.value)}
          />
        </SimpleField>
        <SimpleField label={t("passage")}>
          <textarea
            className={areaClass}
            rows={10}
            value={String(draft["body"] ?? "")}
            onChange={(event) => onPatch("body", event.target.value)}
          />
        </SimpleField>
      </div>
    );
  }

  if (itemType === "listening") {
    return (
      <div className="space-y-3 rounded-md border border-border bg-background p-3">
        <SimpleField label={t("title")}>
          <input
            className={inputClass}
            value={String(draft["title"] ?? "")}
            onChange={(event) => onPatch("title", event.target.value)}
          />
        </SimpleField>
        <SimpleField label={t("transcript")}>
          <textarea
            className={areaClass}
            rows={10}
            value={String(draft["transcript"] ?? "")}
            onChange={(event) => onPatch("transcript", event.target.value)}
          />
        </SimpleField>
      </div>
    );
  }

  if (itemType === "raw_text") {
    return (
      <SimpleField label={t("text")}>
        <textarea
          className={areaClass}
          rows={10}
          value={String(draft["text"] ?? "")}
          onChange={(event) => onPatch("text", event.target.value)}
        />
      </SimpleField>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
      {t("simple_editor_not_available")}
    </div>
  );
}

function SimpleField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function SourcePreview({
  preview,
  fallbackText,
}: {
  preview: { url: string | null; mimeType: string | null; filename: string } | null;
  fallbackText: string;
}) {
  const { t } = useI18n();
  if (!preview) return <div className="p-8 text-center text-sm text-muted-foreground">…</div>;
  if (!preview.url) return <div className="p-8 text-center text-sm text-muted-foreground">{t("source_preview_not_available")}</div>;

  if (preview.mimeType === "application/pdf" || preview.filename.toLowerCase().endsWith(".pdf")) {
    return <iframe src={preview.url} title={preview.filename} className="h-full min-h-[60vh] w-full rounded bg-background" />;
  }
  if (preview.mimeType?.startsWith("image/")) {
    return <img src={preview.url} alt="" className="mx-auto max-h-[60vh] max-w-full object-contain" />;
  }
  if (fallbackText.trim()) {
    return (
      <div className="min-h-full rounded bg-background p-4">
        <div className="mb-3 text-xs font-medium text-muted-foreground">
          {t("extracted_text_preview")}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6">
          {fallbackText}
        </div>
      </div>
    );
  }
  return <div className="p-8 text-center text-sm text-muted-foreground">{t("source_preview_not_available")}</div>;
}

function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs">
      {value.replaceAll("_", " ")}
    </span>
  );
}
