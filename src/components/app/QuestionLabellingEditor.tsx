import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMediaPreviewUrl, listMedia } from "@/lib/media.functions";
import { useI18n } from "@/lib/i18n";

export type SpatialLabel = {
  id: string;
  x: number;
  y: number;
};

export type SpatialPair = {
  left: string;
  right: string;
};

export function QuestionLabellingEditor({
  mediaId,
  mediaLabel,
  labels,
  pairs,
  onChange,
}: {
  mediaId: string;
  mediaLabel: string;
  labels: SpatialLabel[];
  pairs: SpatialPair[];
  onChange: (value: {
    mediaId: string;
    mediaLabel: string;
    labels: SpatialLabel[];
    pairs: SpatialPair[];
  }) => void;
}) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: preview } = useQuery({
    queryKey: ["question-media-preview", mediaId],
    queryFn: () => getMediaPreviewUrl({ data: { id: mediaId } }),
    enabled: !!mediaId,
    staleTime: 10 * 60 * 1000,
  });

  function addLabel(event: React.MouseEvent<HTMLDivElement>) {
    if (!mediaId || !preview?.url) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
    const id = crypto.randomUUID();

    onChange({
      mediaId,
      mediaLabel,
      labels: [...labels, { id, x: round2(x), y: round2(y) }],
      pairs: [...pairs, { left: id, right: "" }],
    });
  }

  function removeLabel(id: string) {
    onChange({
      mediaId,
      mediaLabel,
      labels: labels.filter((label) => label.id !== id),
      pairs: pairs.filter((pair) => pair.left !== id),
    });
  }

  function setAnswer(id: string, answer: string) {
    const current = pairs.find((pair) => pair.left === id);
    onChange({
      mediaId,
      mediaLabel,
      labels,
      pairs: current
        ? pairs.map((pair) => (pair.left === id ? { ...pair, right: answer } : pair))
        : [...pairs, { left: id, right: answer }],
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>{t("question_media")}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{t("labelling_editor_hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
            <ImagePlus className="h-4 w-4" />
            {mediaId ? t("change_image") : t("choose_image")}
          </Button>
          {mediaId && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  mediaId: "",
                  mediaLabel: "",
                  labels: [],
                  pairs: [],
                })
              }
            >
              <X className="h-4 w-4" />
              {t("clear")}
            </Button>
          )}
        </div>
      </div>

      {!mediaId ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-40 w-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/30"
        >
          <span className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            {t("choose_image")}
          </span>
        </button>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {mediaLabel || mediaId}
          </div>

          {preview?.url ? (
            <div
              className="relative mx-auto w-fit max-w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-muted"
              onClick={addLabel}
              title={t("click_image_to_add_label")}
            >
              <img
                src={preview.url}
                alt=""
                className="block h-auto max-h-[65vh] w-auto max-w-full object-contain"
                draggable={false}
              />
              {labels.map((label, index) => (
                <button
                  key={label.id}
                  type="button"
                  className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-foreground text-xs font-bold text-background shadow"
                  style={{ left: `${label.x}%`, top: `${label.y}%` }}
                  onClick={(event) => {
                    event.stopPropagation();
                    document
                      .getElementById(`label-answer-${label.id}`)
                      ?.focus();
                  }}
                  title={`${t("label")} ${index + 1}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              {t("loading_preview")}
            </div>
          )}
        </>
      )}

      {labels.length > 0 && (
        <div className="space-y-2">
          <Label>{t("label_answers")}</Label>
          {labels.map((label, index) => {
            const answer = pairs.find((pair) => pair.left === label.id)?.right ?? "";
            return (
              <div
                key={label.id}
                className="grid items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[42px_1fr_120px_auto]"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                  {index + 1}
                </div>
                <Input
                  id={`label-answer-${label.id}`}
                  value={answer}
                  placeholder={t("correct_answer")}
                  onChange={(event) => setAnswer(label.id, event.target.value)}
                />
                <div className="text-xs text-muted-foreground">
                  {label.x.toFixed(1)}%, {label.y.toFixed(1)}%
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => removeLabel(label.id)}
                  aria-label={t("delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <ImageMediaPicker
          onClose={() => setPickerOpen(false)}
          onChoose={(media) => {
            onChange({
              mediaId: media.id,
              mediaLabel: media.original_filename ?? media.id,
              labels: [],
              pairs: [],
            });
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}

function ImageMediaPicker({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (media: { id: string; original_filename: string | null }) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["question-image-picker", search, page],
    queryFn: () =>
      listMedia({
        data: {
          search,
          kind: "image",
          includeDeleted: false,
          page,
        },
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 40)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("choose_image")}</DialogTitle>
        </DialogHeader>

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

        <div className="max-h-[58vh] overflow-y-auto rounded-md border border-border">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_results")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((media) => (
                <li
                  key={media.id}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {media.original_filename ?? media.id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {media.width && media.height
                        ? `${media.width}×${media.height}`
                        : media.mime_type ?? t("image")}
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
          <span className="text-muted-foreground">
            {page + 1} / {pages}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              ←
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              →
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
