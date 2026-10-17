import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload, WandSparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  autoMapQuestionImportHeaders,
  buildMappedImportRows,
  parseDelimitedText,
  QUESTION_IMPORT_FIELDS,
  QUESTION_IMPORT_FIELD_LABELS,
  type QuestionImportDefaults,
  type QuestionImportField,
} from "@/lib/question-import";
import {
  commitQuestionImport,
  previewQuestionImport,
} from "@/lib/questions.functions";
import { LEVELS, QUESTION_TYPES } from "@/lib/question-types";
import { topicOptions, type TopicRow } from "@/components/app/topics";
import { useI18n } from "@/lib/i18n";

type Sheet = {
  name: string;
  rows: string[][];
};

type Preview = Awaited<ReturnType<typeof previewQuestionImport>>;

const COMMON_FIELDS: QuestionImportField[] = [
  "question_type",
  "prompt",
  "instructions",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "option_f",
  "option_g",
  "option_h",
  "correct",
  "answers",
  "pairs",
  "order",
  "model_answer",
  "learning_language",
  "level",
  "points",
  "partial",
  "negative",
  "tags",
  "explanation",
];

const ADVANCED_FIELDS = QUESTION_IMPORT_FIELDS.filter(
  (field) => !COMMON_FIELDS.includes(field),
);

export function QuestionImportDialog({
  open,
  onClose,
  topics,
}: {
  open: boolean;
  onClose: () => void;
  topics: TopicRow[];
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [paste, setPaste] = useState("");
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<
    Partial<Record<QuestionImportField, string>>
  >({});
  const [advanced, setAdvanced] = useState(false);
  const [defaultTags, setDefaultTags] = useState("");
  const [defaults, setDefaults] = useState<QuestionImportDefaults>({
    question_type: "single_choice",
    learning_language: "en",
    level: null,
    status: "draft",
    topicIds: [],
    tags: [],
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const currentSheet = sheets[sheetIndex] ?? null;
  const headers = currentSheet?.rows[0]?.map((value) => String(value).trim()) ?? [];
  const bodyRows = currentSheet?.rows.slice(1) ?? [];
  const topicOpts = useMemo(() => topicOptions(topics), [topics]);

  function loadSheetSet(nextSheets: Sheet[], filename: string | null) {
    if (!nextSheets.length) {
      toast.error(t("spreadsheet_empty"));
      return;
    }
    const first = nextSheets[0]!;
    if (first.rows.length < 2) {
      toast.error(t("spreadsheet_needs_header"));
      return;
    }
    if (first.rows.length - 1 > 500) {
      toast.error(t("question_import_row_limit"));
      return;
    }

    setSheets(nextSheets);
    setSheetIndex(0);
    setSourceFilename(filename);
    setMapping(autoMapQuestionImportHeaders(first.rows[0] ?? []));
    setPreview(null);
  }

  function parsePaste() {
    const rows = parseDelimitedText(paste);
    loadSheetSet([{ name: t("pasted_table"), rows }], "pasted-table");
  }

  async function parseFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("spreadsheet_file_too_large"));
      return;
    }

    setBusy(true);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
        const text = await file.text();
        loadSheetSet(
          [{ name: file.name, rows: parseDelimitedText(text) }],
          file.name,
        );
        return;
      }

      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        throw new Error(t("unsupported_spreadsheet"));
      }

      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false,
        dense: true,
      });

      const parsedSheets: Sheet[] = workbook.SheetNames.flatMap((name) => {
        const worksheet = workbook.Sheets[name];
        if (!worksheet) return [];
        const matrix = XLSX.utils.sheet_to_json<string[]>(worksheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        });
        const normalized = matrix.map((row) =>
          Array.from(row ?? [], (value) => String(value ?? "")),
        );
        return normalized.some((row) => row.some((cell) => cell.trim()))
          ? [{ name, rows: normalized }]
          : [];
      });

      loadSheetSet(parsedSheets, file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function selectSheet(index: number) {
    const sheet = sheets[index];
    if (!sheet) return;
    if (sheet.rows.length - 1 > 500) {
      toast.error(t("question_import_row_limit"));
      return;
    }
    setSheetIndex(index);
    setMapping(autoMapQuestionImportHeaders(sheet.rows[0] ?? []));
    setPreview(null);
  }

  function mappedRows() {
    if (!currentSheet) return [];
    return buildMappedImportRows(
      headers,
      bodyRows,
      mapping,
      currentSheet.name,
    );
  }

  function requestDefaults(): QuestionImportDefaults {
    return {
      ...defaults,
      tags: defaultTags
        .split(/[;,]+/)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    };
  }

  async function runPreview() {
    if (!currentSheet) return;
    if (!mapping.prompt) {
      toast.error(t("map_prompt_required"));
      return;
    }
    const rows = mappedRows();
    if (!rows.length) {
      toast.error(t("spreadsheet_empty"));
      return;
    }

    setBusy(true);
    try {
      const result = await previewQuestionImport({
        data: {
          rows,
          defaults: requestDefaults(),
          sourceFilename,
        },
      });
      setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!currentSheet || !preview?.summary.valid) return;
    setBusy(true);
    try {
      const result = await commitQuestionImport({
        data: {
          rows: mappedRows(),
          defaults: requestDefaults(),
          sourceFilename,
        },
      });
      await qc.invalidateQueries({ queryKey: ["questions"] });
      toast.success(
        `${t("question_import_complete")}: ${result.imported} · ${t("duplicates")}: ${result.duplicates} · ${t("invalid")}: ${result.invalid}`,
      );
      reset();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPaste("");
    setSourceFilename(null);
    setSheets([]);
    setSheetIndex(0);
    setMapping({});
    setPreview(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("import_questions")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3 rounded-md border border-border p-4">
            <div>
              <h3 className="font-semibold">{t("import_source")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("question_import_source_hint")}
              </p>
            </div>

            <Textarea
              rows={5}
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder={t("paste_spreadsheet_here")}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!paste.trim() || busy}
                onClick={parsePaste}
              >
                <WandSparkles className="h-4 w-4" />
                {t("parse_paste")}
              </Button>

              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void parseFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {t("choose_spreadsheet")}
              </Button>
            </div>
          </section>

          {currentSheet && (
            <>
              <section className="space-y-3 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t("column_mapping")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("column_mapping_hint")}
                    </p>
                  </div>

                  {sheets.length > 1 && (
                    <div className="space-y-1">
                      <Label>{t("sheet")}</Label>
                      <select
                        value={sheetIndex}
                        onChange={(event) =>
                          selectSheet(Number(event.target.value))
                        }
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {sheets.map((sheet, index) => (
                          <option key={sheet.name} value={index}>
                            {sheet.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  {sourceFilename ?? "—"} · {bodyRows.length} {t("rows")} ·{" "}
                  {headers.length} {t("columns")}
                </div>

                <MappingGrid
                  fields={COMMON_FIELDS}
                  headers={headers}
                  mapping={mapping}
                  onChange={(field, header) => {
                    setMapping({ ...mapping, [field]: header || undefined });
                    setPreview(null);
                  }}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdvanced((value) => !value)}
                >
                  {advanced ? t("hide_advanced") : t("show_advanced")}
                </Button>

                {advanced && (
                  <MappingGrid
                    fields={ADVANCED_FIELDS}
                    headers={headers}
                    mapping={mapping}
                    onChange={(field, header) => {
                      setMapping({ ...mapping, [field]: header || undefined });
                      setPreview(null);
                    }}
                  />
                )}
              </section>

              <section className="space-y-4 rounded-md border border-border p-4">
                <div>
                  <h3 className="font-semibold">{t("import_defaults")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("import_defaults_hint")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={t("type")}>
                    <select
                      value={defaults.question_type}
                      onChange={(event) => {
                        setDefaults({
                          ...defaults,
                          question_type: event.target.value,
                        });
                        setPreview(null);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("language")}>
                    <select
                      value={defaults.learning_language ?? ""}
                      onChange={(event) => {
                        setDefaults({
                          ...defaults,
                          learning_language: event.target.value || null,
                        });
                        setPreview(null);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">—</option>
                      <option value="en">English</option>
                      <option value="az">Azərbaycanca</option>
                      <option value="ru">Русский</option>
                      <option value="tr">Türkçe</option>
                    </select>
                  </Field>

                  <Field label={t("level")}>
                    <select
                      value={defaults.level ?? ""}
                      onChange={(event) => {
                        setDefaults({
                          ...defaults,
                          level: event.target.value || null,
                        });
                        setPreview(null);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">—</option>
                      {LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("status")}>
                    <select
                      value={defaults.status}
                      onChange={(event) => {
                        setDefaults({
                          ...defaults,
                          status: event.target.value as QuestionImportDefaults["status"],
                        });
                        setPreview(null);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="draft">{t("draft")}</option>
                      <option value="active">{t("active")}</option>
                      <option value="archived">{t("archived")}</option>
                    </select>
                  </Field>
                </div>

                <Field label={t("tags")}>
                  <Input
                    value={defaultTags}
                    placeholder="grammar, unit-1"
                    onChange={(event) => {
                      setDefaultTags(event.target.value);
                      setPreview(null);
                    }}
                  />
                </Field>

                <div className="space-y-2">
                  <Label>{t("topics")}</Label>
                  {topicOpts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2">
                      {topicOpts.map((topic) => (
                        <label
                          key={topic.id}
                          className="flex items-center gap-2 py-1 text-sm"
                          style={{ paddingLeft: topic.depth * 16 }}
                        >
                          <Checkbox
                            checked={defaults.topicIds.includes(topic.id)}
                            onCheckedChange={(checked) => {
                              setDefaults({
                                ...defaults,
                                topicIds: checked
                                  ? [...defaults.topicIds, topic.id]
                                  : defaults.topicIds.filter(
                                      (id) => id !== topic.id,
                                    ),
                              });
                              setPreview(null);
                            }}
                          />
                          {topic.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  {t("question_import_answer_format_hint")}
                </div>

                <Button type="button" onClick={runPreview} disabled={busy}>
                  <FileSpreadsheet className="h-4 w-4" />
                  {t("validate_preview")}
                </Button>
              </section>
            </>
          )}

          {preview && (
            <section className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{t("import_preview")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("import_preview_hint")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge>
                    {t("valid")}: {preview.summary.valid}
                  </Badge>
                  <Badge>
                    {t("duplicates")}: {preview.summary.duplicates}
                  </Badge>
                  <Badge>
                    {t("invalid")}: {preview.summary.invalid}
                  </Badge>
                </div>
              </div>

              <div className="max-h-[42vh] overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">{t("status")}</th>
                      <th className="px-3 py-2 font-medium">{t("type")}</th>
                      <th className="px-3 py-2 font-medium">{t("prompt")}</th>
                      <th className="px-3 py-2 font-medium">{t("details")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.rows.map((row) => (
                      <tr key={`${row.sourceSheet ?? ""}:${row.rowNumber}`}>
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              row.status === "valid"
                                ? "font-medium text-success"
                                : row.status === "duplicate"
                                  ? "font-medium text-muted-foreground"
                                  : "font-medium text-destructive"
                            }
                          >
                            {t(row.status)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.question_type}
                        </td>
                        <td className="max-w-xl px-3 py-2">
                          <div className="line-clamp-2">{row.prompt || "—"}</div>
                        </td>
                        <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">
                          {row.reason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("close")}
          </Button>
          <Button
            type="button"
            disabled={busy || !preview?.summary.valid}
            onClick={commit}
          >
            {t("import_valid_questions")}
            {preview?.summary.valid ? ` (${preview.summary.valid})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingGrid({
  fields,
  headers,
  mapping,
  onChange,
}: {
  fields: QuestionImportField[];
  headers: string[];
  mapping: Partial<Record<QuestionImportField, string>>;
  onChange: (field: QuestionImportField, header: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => (
        <div key={field} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2">
          <div className="truncate text-xs text-muted-foreground" title={field}>
            {localizedImportFieldLabel(field, t)}
          </div>
          <select
            value={mapping[field] ?? ""}
            onChange={(event) => onChange(field, event.target.value)}
            className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">—</option>
            {headers.map((header, index) => (
              <option key={`${header}:${index}`} value={header}>
                {header || `Column ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function localizedImportFieldLabel(
  field: QuestionImportField,
  t: (key: string) => string,
) {
  if (/^option_[a-h]$/.test(field)) {
    return `${t("options")} ${field.slice(-1).toUpperCase()}`;
  }

  const keys: Partial<Record<QuestionImportField, string>> = {
    question_type: "type",
    prompt: "prompt",
    instructions: "instructions",
    correct: "correct_answer",
    answers: "accepted_answers",
    pairs: "pairs",
    order: "order_items",
    model_answer: "model_answer",
    learning_language: "language",
    level: "level",
    difficulty: "difficulty",
    points: "points",
    partial: "partial_scoring",
    negative: "negative_marking",
    grading_mode: "grading",
    status: "status",
    tags: "tags",
    topic_ids: "topics",
    media_id: "media",
    explanation: "explanation",
    teacher_notes: "teacher_notes",
    case_sensitive: "case_sensitive",
    ignore_punctuation: "ignore_punctuation",
    ignore_diacritics: "ignore_diacritics",
  };

  const key = keys[field];
  return key ? t(key) : QUESTION_IMPORT_FIELD_LABELS[field];
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border px-2 py-1">
      {children}
    </span>
  );
}
