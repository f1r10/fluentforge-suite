import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createMediaUploadSession,
  finalizeMediaUpload,
} from "@/lib/media.functions";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

export type InlineMediaKind = "image" | "audio" | "video";

export function MediaUploadButton({
  allowedKinds,
  onUploaded,
  variant = "outline",
  size = "sm",
}: {
  allowedKinds: InlineMediaKind[];
  onUploaded: (media: {
    id: string;
    label: string;
    kind: InlineMediaKind;
  }) => void | Promise<void>;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    const detected = detectKind(file);
    if (!detected || !allowedKinds.includes(detected)) {
      toast.error(
        allowedKinds.length === 1
          ? `Only ${allowedKinds[0]} files are allowed here.`
          : `Choose one of: ${allowedKinds.join(", ")}.`,
      );
      return;
    }

    setUploading(true);
    try {
      const session = await createMediaUploadSession({
        data: {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      });

      if (
        session.kind !== "image" &&
        session.kind !== "audio" &&
        session.kind !== "video"
      ) {
        throw new Error("This file is not a supported question/listening media type.");
      }
      if (!allowedKinds.includes(session.kind)) {
        throw new Error(`This ${session.kind} file is not allowed here.`);
      }

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

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["media-library"] }),
        qc.invalidateQueries({ queryKey: ["question-audio-video-picker"] }),
        qc.invalidateQueries({ queryKey: ["listening-media-picker"] }),
      ]);

      await onUploaded({
        id: result.id,
        label: file.name,
        kind: session.kind,
      });
      toast.success(t("upload_complete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptFor(allowedKinds)}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="h-4 w-4" />
        {uploading ? t("uploading") : t("upload_media")}
      </Button>
    </>
  );
}

function acceptFor(kinds: InlineMediaKind[]) {
  return kinds.map((kind) => `${kind}/*`).join(",");
}

function detectKind(file: File): InlineMediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (
    ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic"].includes(
      extension,
    )
  ) {
    return "image";
  }
  if (
    ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "weba"].includes(
      extension,
    )
  ) {
    return "audio";
  }
  if (["mp4", "webm", "mov", "m4v", "mkv", "avi"].includes(extension)) {
    return "video";
  }
  return null;
}

async function sha256File(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function inspectFile(file: File, kind: InlineMediaKind) {
  if (kind === "image") {
    return await new Promise<{
      width: number | null;
      height: number | null;
      duration: number | null;
    }>((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.naturalWidth || null,
          height: image.naturalHeight || null,
          duration: null,
        });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        resolve({ width: null, height: null, duration: null });
        URL.revokeObjectURL(url);
      };
      image.src = url;
    });
  }

  return await new Promise<{
    width: number | null;
    height: number | null;
    duration: number | null;
  }>((resolve) => {
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
