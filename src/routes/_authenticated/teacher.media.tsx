import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Eye, FileUp, Image as ImageIcon, RotateCcw, Search, Trash2, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createMediaUploadSession,
  finalizeMediaUpload,
  getMediaPreviewUrl,
  listMedia,
  listYouTubeImports,
  restoreMedia,
  saveYouTubeReference,
  startYouTubeImport,
  syncYouTubeImport,
  trashMedia,
} from "@/lib/media.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

type MediaRow = Awaited<ReturnType<typeof listMedia>>["rows"][number];

export const Route = createFileRoute("/_authenticated/teacher/media")({
  component: MediaLibraryPage,
});

function MediaLibraryPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "audio" | "video" | "document" | "other">("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<MediaRow | null>(null);
  const [youtubeOpen, setYoutubeOpen] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["media-library", search, kind, includeDeleted, page],
    queryFn: () =>
      listMedia({
        data: {
          search,
          kind,
          includeDeleted,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const { data: youtubeImports = [] } = useQuery({
    queryKey: ["youtube-media-imports"],
    queryFn: async () => {
      let imports = await listYouTubeImports();
      const active = imports.filter(
        (job) => job.status === "queued" || job.status === "processing",
      );
      if (active.length) {
        await Promise.allSettled(
          active.map((job) =>
            syncYouTubeImport({ data: { id: job.id } }),
          ),
        );
        imports = await listYouTubeImports();
        if (imports.some((job) => job.status === "completed")) {
          await qc.invalidateQueries({ queryKey: ["media-library"] });
        }
      }
      return imports;
    },
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (job) => job.status === "queued" || job.status === "processing",
      )
        ? 3_000
        : 15_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function upload(file: File) {
    setUploading(true);
    try {
      const session = await createMediaUploadSession({
        data: {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      });

      const { error } = await supabase.storage
        .from(session.bucket)
        .uploadToSignedUrl(session.path, session.token, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (error) throw error;

      const metadata = await inspectFile(file, session.kind);
      const checksum =
        file.size <= 50 * 1024 * 1024
          ? await sha256File(file).catch(() => null)
          : null;

      const result = await finalizeMediaUpload({
        data: {
          sessionId: session.sessionId,
          checksum,
          durationSeconds: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        },
      });

      await qc.invalidateQueries({ queryKey: ["media-library"] });
      toast.success(result.deduplicated ? t("duplicate_media_reused") : t("upload_complete"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(row: MediaRow) {
    if (!confirm(t("delete_media_confirm"))) return;
    try {
      await trashMedia({ data: { id: row.id } });
      await qc.invalidateQueries({ queryKey: ["media-library"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function restore(row: MediaRow) {
    try {
      await restoreMedia({ data: { id: row.id } });
      await qc.invalidateQueries({ queryKey: ["media-library"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("media_library")}</h1>
          <p className="text-sm text-muted-foreground">{t("media_library_hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button
            variant="outline"
            onClick={() => setYoutubeOpen(true)}
          >
            <Youtube className="h-4 w-4" />
            {t("import_youtube")}
          </Button>
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            <FileUp className="h-4 w-4" />
            {uploading ? t("uploading") : t("upload_media")}
          </Button>
        </div>
      </div>

      {youtubeImports.length > 0 && (
        <section className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            {t("youtube_import_history")}
          </div>
          <div className="divide-y divide-border">
            {youtubeImports.slice(0, 5).map((job) => (
              <div
                key={job.id}
                className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate">{job.source_url}</div>
                  {job.error && (
                    <div className="text-xs text-destructive">
                      {job.error}
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(job.status)} · {job.progress}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            placeholder={t("search")}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setPage(0);
          }}
        >
          <option value="all">{t("all")}</option>
          <option value="image">{t("image")}</option>
          <option value="audio">{t("audio")}</option>
          <option value="video">{t("video")}</option>
          <option value="document">{t("document")}</option>
          <option value="other">{t("other")}</option>
        </select>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <Checkbox
            checked={includeDeleted}
            onCheckedChange={(checked) => {
              setIncludeDeleted(!!checked);
              setPage(0);
            }}
          />
          {t("show_trash")}
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("file")}</th>
              <th className="px-3 py-2 font-medium">{t("type")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("size")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("duration")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("uploaded_at")}</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {isFetching ? "…" : t("no_results")}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className={row.deleted_at ? "bg-muted/30 opacity-70" : "hover:bg-muted/30"}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="max-w-xl truncate font-medium">{row.original_filename ?? row.id}</div>
                      <div className="text-xs text-muted-foreground">{row.mime_type ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">{t(row.kind)}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{formatBytes(row.size_bytes)}</td>
                <td className="hidden px-3 py-2 md:table-cell">
                  {row.duration_seconds == null ? "—" : formatDuration(Number(row.duration_seconds))}
                </td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
                  {formatDateTime(row.created_at, lang)}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    {!row.deleted_at && (
                      <Button variant="ghost" size="icon" onClick={() => setPreview(row)} aria-label={t("preview")}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {row.deleted_at ? (
                      <Button variant="ghost" size="icon" onClick={() => restore(row)} aria-label={t("restore")}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => remove(row)}
                        aria-label={t("delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page + 1} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>←</Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>→</Button>
        </div>
      </div>

      {preview && <PreviewDialog media={preview} onClose={() => setPreview(null)} />}
      {youtubeOpen && (
        <YouTubeImportDialog
          onClose={() => setYoutubeOpen(false)}
          onChanged={async () => {
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["youtube-media-imports"] }),
              qc.invalidateQueries({ queryKey: ["media-library"] }),
            ]);
          }}
        />
      )}
    </div>
  );
}

function PreviewDialog({ media, onClose }: { media: MediaRow; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["media-preview-url", media.id],
    queryFn: () => getMediaPreviewUrl({ data: { id: media.id } }),
    staleTime: 10 * 60 * 1000,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{media.original_filename ?? t("preview")}</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">…</div>
        ) : isYouTubeReference(media) ? (
          <iframe
            src={youtubeEmbedUrl(media)}
            title={media.original_filename ?? "YouTube"}
            className="aspect-video w-full rounded-md border border-border"
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : media.kind === "image" ? (
          <img src={data.url} alt="" className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain" />
        ) : media.kind === "video" ? (
          <video src={data.url} controls className="max-h-[70vh] w-full rounded-md bg-black" />
        ) : media.kind === "audio" ? (
          <audio src={data.url} controls className="w-full" />
        ) : media.kind === "document" && media.mime_type === "application/pdf" ? (
          <iframe src={data.url} title={media.original_filename ?? "PDF"} className="h-[70vh] w-full rounded-md border border-border" />
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("preview_not_available")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function YouTubeImportDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"download" | "reference">("download");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [preferredHeight, setPreferredHeight] = useState(1080);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "download" && !rightsConfirmed) {
      toast.error(t("youtube_rights_required"));
      return;
    }

    setBusy(true);
    try {
      if (mode === "reference") {
        await saveYouTubeReference({ data: { url } });
        toast.success(t("youtube_reference_saved"));
      } else {
        await startYouTubeImport({
          data: {
            url,
            rightsConfirmed: true,
            preferredHeight,
          },
        });
        toast.success(t("youtube_import_started"));
      }
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("import_youtube")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              YouTube URL
            </label>
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              required
            />
          </div>

          <div className="grid gap-2">
            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="youtube-mode"
                checked={mode === "download"}
                onChange={() => setMode("download")}
                className="mt-1"
              />
              <span>
                <strong className="block">{t("youtube_download_mode")}</strong>
                <span className="text-xs text-muted-foreground">
                  {t("youtube_download_mode_hint")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="youtube-mode"
                checked={mode === "reference"}
                onChange={() => setMode("reference")}
                className="mt-1"
              />
              <span>
                <strong className="block">{t("youtube_reference_mode")}</strong>
                <span className="text-xs text-muted-foreground">
                  {t("youtube_reference_mode_hint")}
                </span>
              </span>
            </label>
          </div>

          {mode === "download" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("preferred_resolution")}
                </label>
                <select
                  value={preferredHeight}
                  onChange={(event) =>
                    setPreferredHeight(Number(event.target.value))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                  <option value={1440}>1440p</option>
                  <option value={2160}>2160p</option>
                </select>
              </div>

              <label className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-sm">
                <Checkbox
                  checked={rightsConfirmed}
                  onCheckedChange={(checked) =>
                    setRightsConfirmed(!!checked)
                  }
                  className="mt-0.5"
                />
                <span>{t("youtube_rights_confirmation")}</span>
              </label>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !url.trim() ||
                (mode === "download" && !rightsConfirmed)
              }
            >
              {busy ? t("processing") : t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isYouTubeReference(media: MediaRow) {
  if (!media.metadata || typeof media.metadata !== "object") return false;
  const metadata = media.metadata as Record<string, unknown>;
  return (
    metadata["source"] === "youtube" &&
    metadata["reference_only"] === true
  );
}

function youtubeEmbedUrl(media: MediaRow) {
  if (!media.metadata || typeof media.metadata !== "object") return "";
  const metadata = media.metadata as Record<string, unknown>;
  return typeof metadata["embed_url"] === "string"
    ? metadata["embed_url"]
    : "";
}

async function sha256File(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function inspectFile(file: File, kind: string) {
  if (kind === "image") {
    return await new Promise<{ width: number | null; height: number | null; duration: number | null }>((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null, duration: null });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        resolve({ width: null, height: null, duration: null });
        URL.revokeObjectURL(url);
      };
      image.src = url;
    });
  }

  if (kind === "audio" || kind === "video") {
    return await new Promise<{ width: number | null; height: number | null; duration: number | null }>((resolve) => {
      const url = URL.createObjectURL(file);
      const element = document.createElement(kind === "video" ? "video" : "audio");
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        const video = element instanceof HTMLVideoElement ? element : null;
        resolve({
          width: video?.videoWidth || null,
          height: video?.videoHeight || null,
          duration: Number.isFinite(element.duration) ? element.duration : null,
        });
        URL.revokeObjectURL(url);
      };
      element.onerror = () => {
        resolve({ width: null, height: null, duration: null });
        URL.revokeObjectURL(url);
      };
      element.src = url;
    });
  }

  return { width: null, height: null, duration: null };
}

function formatBytes(value: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}
