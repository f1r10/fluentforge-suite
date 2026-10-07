import { useQuery } from "@tanstack/react-query";
import { FileAudio, ImageIcon, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMediaPreviewUrl, listMedia } from "@/lib/media.functions";
import { useI18n } from "@/lib/i18n";

type MediaKind = "image" | "audio" | "video";

export function QuestionMediaAttachment({
  mediaId,
  mediaLabel,
  allowedKinds = ["image", "audio", "video"],
  onChange,
}: {
  mediaId: string;
  mediaLabel: string;
  allowedKinds?: MediaKind[];
  onChange: (media: { id: string; label: string } | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const { data: preview } = useQuery({
    queryKey: ["question-stimulus-preview", mediaId],
    queryFn: () => getMediaPreviewUrl({ data: { id: mediaId } }),
    enabled: !!mediaId,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <section className="space-y-2">
      <Label>{t("question_media")}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm">
          {mediaId ? (
            <div className="flex items-center gap-2">
              {preview?.kind === "image" ? (
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileAudio className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{mediaLabel || mediaId}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t("no_media")}</span>
          )}
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {mediaId ? t("change_media") : t("choose_media")}
        </Button>
        {mediaId && (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
            {t("clear")}
          </Button>
        )}
      </div>

      {mediaId && preview?.url && (
        preview.kind === "video" ? (
          <video src={preview.url} controls className="max-h-[55vh] w-full rounded-md bg-black" />
        ) : preview.kind === "image" ? (
          <img
            src={preview.url}
            alt=""
            className="mx-auto max-h-[55vh] max-w-full rounded-md border border-border object-contain"
          />
        ) : (
          <audio src={preview.url} controls className="w-full" />
        )
      )}

      {open && (
        <MediaPicker
          allowedKinds={allowedKinds}
          onClose={() => setOpen(false)}
          onChoose={(media) => {
            onChange({
              id: media.id,
              label: media.original_filename ?? media.id,
            });
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function MediaPicker({
  allowedKinds,
  onClose,
  onChoose,
}: {
  allowedKinds: MediaKind[];
  onClose: () => void;
  onChoose: (media: { id: string; original_filename: string | null }) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const kinds: MediaKind[] = allowedKinds.length
    ? allowedKinds
    : ["image", "audio", "video"];
  const [kind, setKind] = useState<MediaKind>(kinds[0]!);
  const [page, setPage] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["question-audio-video-picker", search, kind, page],
    queryFn: () =>
      listMedia({
        data: {
          search,
          kind,
          includeDeleted: false,
          page,
        },
      }),
  });

  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 40)));

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("choose_media")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
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
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setPage(0);
            }}
          >
            {kinds.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_results")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((media) => (
                <li key={media.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {media.original_filename ?? media.id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {media.mime_type ?? t(media.kind)}
                    </div>
                  </div>
                  <Button type="button" size="sm" onClick={() => onChoose(media)}>
                    {t("select")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{page + 1} / {pages}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</Button>
            <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>→</Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
