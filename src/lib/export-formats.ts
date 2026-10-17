export const EXPORT_KINDS = [
  "questions",
  "vocabulary",
  "readings",
  "listenings",
  "catalogs",
  "exams",
  "activity",
  "results",
  "students",
  "analytics",
  "content_package",
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];
export type ExportFormat = "json" | "xlsx" | "csv" | "pdf" | "docx";

export const EXPORT_FORMATS: Record<ExportKind, readonly ExportFormat[]> = {
  questions: ["xlsx", "pdf", "json", "csv"],
  vocabulary: ["xlsx", "pdf", "json", "csv"],
  readings: ["pdf", "docx"],
  listenings: ["xlsx", "json", "csv"],
  catalogs: ["xlsx", "json", "csv"],
  exams: ["xlsx", "json", "csv"],
  activity: ["xlsx", "json", "csv"],
  results: ["xlsx", "json", "csv"],
  students: ["xlsx", "json", "csv"],
  analytics: ["xlsx", "pdf", "json", "csv"],
  content_package: ["json"],
};

export function isExportFormatAllowed(
  kind: ExportKind,
  format: ExportFormat,
) {
  return EXPORT_FORMATS[kind].includes(format);
}

export function defaultExportFormat(kind: ExportKind): ExportFormat {
  return EXPORT_FORMATS[kind][0] ?? "json";
}
