import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  approveHighConfidenceItems,
  commitDocumentImport,
  createSourceUploadSession,
  finalizeSourceUpload,
  getDocumentImport,
  getSourcePreviewUrl,
  listDocumentImports,
  startDocumentImport,
  syncDocumentImport,
  updateImportItem,
} from "@/lib/document-import.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/sources")({
  component: SourcesPage,
});

type ImportRow = Awaited<ReturnType<typeof listDocumentImports>>[number];
type ImportDetail = Awaited<ReturnType<typeof getDocumentImport>>;

function SourcesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<ImportRow | null>(null);

  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ["document-imports"],
    queryFn: () => listDocumentImports(),
    refetchInterval: 5_000,
  });

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
          profileId: null,
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
          <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" />
            {uploading ? t("uploading") : t("upload_source")}
          </Button>
        </div>
      </div>

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
    </div>
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

  async function commit() {
    setBusy(true);
    try {
      const result = await commitDocumentImport({ data: { jobId: job.id } });
      toast.success(t("imported") + ": " + result.imported);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ["document-imports"] }),
        qc.invalidateQueries({ queryKey: ["questions"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[95vh] max-w-[96vw] overflow-hidden xl:max-w-7xl">
        <DialogHeader><DialogTitle>{t("document_import_review")}</DialogTitle></DialogHeader>
        {isLoading || !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">…</div>
        ) : (
          <ReviewWorkspace
            data={data}
            preview={preview ?? null}
            busy={busy}
            onRefresh={sync}
            onApproveHigh={approveHighConfidence}
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
  onCommit,
  onChanged,
}: {
  data: ImportDetail;
  preview: { url: string | null; mimeType: string | null; filename: string } | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onApproveHigh: () => Promise<void>;
  onCommit: () => Promise<void>;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const pending = data.items.filter((item) => item.decision === "pending").length;
  const approved = data.items.filter((item) => item.decision === "approved").length;
  const duplicates = data.items.filter((item) => item.duplicate_of).length;

  return (
    <div className="grid min-h-[70vh] gap-4 overflow-hidden lg:grid-cols-[1fr_1.2fr]">
      <section className="min-h-0 overflow-hidden rounded-md border border-border">
        <div className="border-b border-border p-3">
          <div className="font-medium">{preview?.filename ?? t("source")}</div>
          <div className="text-xs text-muted-foreground">{preview?.mimeType ?? "—"}</div>
        </div>
        <div className="h-[64vh] overflow-auto bg-muted/20 p-2">
          <SourcePreview preview={preview} />
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span>{t("status")}: <strong>{data.job.status}</strong></span>
            <span>{t("progress")}: <strong>{data.job.progress}%</strong></span>
            <span>{t("pending")}: <strong>{pending}</strong></span>
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
            <Button size="sm" variant="outline" disabled={busy || data.items.length === 0} onClick={onApproveHigh}>
              {t("approve_high_confidence")}
            </Button>
            <Button size="sm" disabled={busy || approved === 0} onClick={onCommit}>
              {t("import_approved")}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {data.items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {data.job.status === "queued" || data.job.status === "processing"
                ? t("processing")
                : t("no_extracted_items")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.items.map((item) => (
                <ImportItemCard key={item.id} item={item} onChanged={onChanged} />
              ))}
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
  const [json, setJson] = useState(() => JSON.stringify(item.payload, null, 2));
  const [busy, setBusy] = useState(false);

  const payload = item.payload as Record<string, unknown>;
  const title =
    item.item_type === "question" && typeof payload["prompt"] === "string"
      ? payload["prompt"]
      : item.item_type === "raw_text" && typeof payload["text"] === "string"
        ? payload["text"].slice(0, 160)
        : item.item_type;

  async function update(
    decision: "pending" | "approved" | "rejected",
    nextPayload?: Record<string, unknown>,
  ) {
    setBusy(true);
    try {
      await updateImportItem({ data: { id: item.id, decision, payload: nextPayload } });
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveJson() {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      await update(item.decision as "pending" | "approved" | "rejected", parsed);
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("invalid_json"));
    }
  }

  return (
    <article className="space-y-2 p-3">
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
          <div className="mt-1 line-clamp-3 text-sm">{String(title ?? "—")}</div>
        </div>
        <Status value={item.decision} />
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea rows={12} className="font-mono text-xs" value={json} onChange={(event) => setJson(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={saveJson}>{t("save")}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>{t("cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={item.decision === "approved" ? "default" : "outline"}
            disabled={busy || !!item.duplicate_of}
            onClick={() => update("approved")}
          >
            {t("approve")}
          </Button>
          <Button
            size="sm"
            variant={item.decision === "rejected" ? "default" : "outline"}
            disabled={busy}
            onClick={() => update("rejected")}
          >
            {t("reject")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
            {t("edit")}
          </Button>
        </div>
      )}
    </article>
  );
}

function SourcePreview({
  preview,
}: {
  preview: { url: string | null; mimeType: string | null; filename: string } | null;
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
  return <div className="p-8 text-center text-sm text-muted-foreground">{t("source_preview_not_available")}</div>;
}

function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs">
      {value.replaceAll("_", " ")}
    </span>
  );
}
