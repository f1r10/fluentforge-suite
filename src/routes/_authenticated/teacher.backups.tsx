import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseBackup,
  Download,
  Eye,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  beginBackupUpload,
  createApplicationBackup,
  deleteBackup,
  finalizeBackupUpload,
  getBackupDownload,
  getRestorePreview,
  listBackups,
  restoreApplicationBackup,
} from "@/lib/backup.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/backups")({
  component: BackupsPage,
});

type BackupRow = Awaited<ReturnType<typeof listBackups>>[number];
type RestorePreview = Awaited<ReturnType<typeof getRestorePreview>>;

function BackupsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const { data: backups = [], isFetching } = useQuery({
    queryKey: ["backups"],
    queryFn: () => listBackups(),
  });

  async function createBackup() {
    setCreating(true);
    try {
      const result = await createApplicationBackup();
      await qc.invalidateQueries({ queryKey: ["backups"] });
      openDownload(result.url, result.filename);
      toast.success(t("backup_created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }

  async function uploadBackup(file: File) {
    setUploading(true);
    try {
      const started = await beginBackupUpload({
        data: {
          filename: file.name,
          sizeBytes: file.size,
        },
      });

      const { error: uploadError } = await supabase.storage
        .from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, {
          contentType: file.type || "application/gzip",
        });
      if (uploadError) throw new Error(uploadError.message);

      await finalizeBackupUpload({ data: { id: started.id } });
      await qc.invalidateQueries({ queryKey: ["backups"] });
      setRestoreId(started.id);
      toast.success(t("backup_uploaded_validated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(row: BackupRow) {
    setDownloading(row.id);
    try {
      const result = await getBackupDownload({ data: { id: row.id } });
      openDownload(result.url, result.filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(null);
    }
  }

  async function remove(row: BackupRow) {
    if (!confirm(t("delete_backup_confirm"))) return;
    setDeleting(row.id);
    try {
      await deleteBackup({ data: { id: row.id } });
      await qc.invalidateQueries({ queryKey: ["backups"] });
      toast.success(t("backup_deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("backup_restore")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("backup_restore_hint")}
        </p>
      </div>

      <section className="grid gap-4 rounded-md border border-border p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <DatabaseBackup className="h-5 w-5" />
            {t("create_application_backup")}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("create_application_backup_hint")}
          </p>
          <div className="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            {t("backup_security_note")}
          </div>
          <Button onClick={createBackup} disabled={creating}>
            <DatabaseBackup className="h-4 w-4" />
            {creating ? t("creating_backup") : t("create_backup")}
          </Button>
        </div>

        <div className="space-y-3 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="flex items-center gap-2 font-semibold">
            <Upload className="h-5 w-5" />
            {t("upload_restore_package")}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("upload_restore_package_hint")}
          </p>
          <div className="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            {t("restore_empty_only_note")}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".ffbackup,application/gzip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadBackup(file);
            }}
          />
          <Button
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {uploading ? t("uploading_validating") : t("choose_backup_file")}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("backup_history")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("backup_history_hint")}
          </p>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("type")}</th>
                <th className="px-3 py-2 font-medium">{t("status")}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">
                  {t("size")}
                </th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">
                  {t("created_at")}
                </th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">
                  {t("backup_contents")}
                </th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {backups.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    {isFetching ? "…" : t("no_backups")}
                  </td>
                </tr>
              )}
              {backups.map((row) => {
                const manifest = readManifest(row.manifest);
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium">
                      {row.kind === "uploaded"
                        ? t("uploaded_backup")
                        : t("manual_backup")}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "failed" ? (
                        <span className="text-destructive">{t("failed")}</span>
                      ) : (
                        t(row.status)
                      )}
                      {row.error && (
                        <div className="max-w-sm truncate text-xs text-destructive">
                          {row.error}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      {formatBytes(row.size_bytes)}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {formatDateTime(row.created_at, lang)}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                      {manifest
                        ? `${sumCounts(manifest.row_counts)} ${t("records")} · ${manifest.storage_objects} ${t("files")}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        {row.status === "completed" && row.storage_path && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => download(row)}
                              disabled={downloading === row.id}
                              aria-label={t("download")}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRestoreId(row.id)}
                              aria-label={t("restore_preview")}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(row)}
                          disabled={deleting === row.id}
                          aria-label={t("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {restoreId && (
        <RestoreDialog
          backupId={restoreId}
          onClose={() => setRestoreId(null)}
          onRestored={async () => {
            await qc.invalidateQueries();
            setRestoreId(null);
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  backupId,
  onClose,
  onRestored,
}: {
  backupId: string;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState("");
  const [restoring, setRestoring] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["restore-preview", backupId],
    queryFn: () => getRestorePreview({ data: { id: backupId } }),
  });

  async function restore() {
    if (confirmation !== "RESTORE EMPTY INSTALLATION") return;
    setRestoring(true);
    try {
      await restoreApplicationBackup({
        data: {
          id: backupId,
          confirmation: "RESTORE EMPTY INSTALLATION",
        },
      });
      toast.success(t("restore_complete"));
      await onRestored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("restore_preview")}</DialogTitle>
        </DialogHeader>

        {isLoading && <div className="py-8 text-center">…</div>}
        {error && (
          <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {data && <RestorePreviewContent data={data} />}

        {data?.canRestore && (
          <div className="space-y-2 rounded-md border border-destructive/40 p-4">
            <div className="font-medium text-destructive">
              {data.resumable ? t("resume_restore") : t("confirm_restore")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("restore_confirmation_hint")}
            </p>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="RESTORE EMPTY INSTALLATION"
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          {data?.canRestore && (
            <Button
              variant="destructive"
              disabled={
                restoring || confirmation !== "RESTORE EMPTY INSTALLATION"
              }
              onClick={restore}
            >
              <RotateCcw className="h-4 w-4" />
              {restoring
                ? t("restoring")
                : data.resumable
                  ? t("resume_restore")
                  : t("restore_backup")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestorePreviewContent({ data }: { data: RestorePreview }) {
  const { t } = useI18n();
  const manifest = data.backup.manifest;
  const targetEntries = Object.entries(data.target);
  const existing = targetEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md bg-muted/40 p-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">{t("records")}</div>
          <div className="font-semibold">{sumCounts(manifest.row_counts)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("files")}</div>
          <div className="font-semibold">{manifest.storage_objects}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            {t("storage_payload")}
          </div>
          <div className="font-semibold">
            {formatBytes(manifest.storage_bytes)}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="font-medium">{t("restore_target_check")}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {data.canRestore
            ? data.resumable
              ? t("restore_can_resume")
              : t("restore_target_empty")
            : t("restore_target_not_empty")}
        </div>
        <div className="mt-3 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
          {targetEntries.map(([table, count]) => (
            <div
              key={table}
              className="flex justify-between bg-background px-3 py-2 text-xs"
            >
              <span>{table}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
        {!data.canRestore && (
          <div className="mt-3 text-sm font-medium text-destructive">
            {t("restore_blocked_existing_data")} ({existing})
          </div>
        )}
      </div>

      <div className="rounded-md border border-border p-4 text-xs leading-5 text-muted-foreground">
        <strong className="text-foreground">{t("not_in_backup")}:</strong>{" "}
        {data.backup.security.excluded.join(", ")}
      </div>
    </div>
  );
}

function readManifest(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !row["row_counts"] ||
    typeof row["row_counts"] !== "object" ||
    typeof row["storage_objects"] !== "number" ||
    typeof row["storage_bytes"] !== "number"
  ) {
    return null;
  }
  return {
    row_counts: row["row_counts"] as Record<string, number>,
    storage_objects: row["storage_objects"],
    storage_bytes: row["storage_bytes"],
  };
}

function sumCounts(counts: Record<string, number>) {
  return Object.values(counts).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
}

function formatBytes(value: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
