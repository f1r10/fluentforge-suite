/**
 * The YouTube reference is not a private video file. Only turn records
 * explicitly created as references into trusted YouTube embed destinations.
 * Never render arbitrary stored external URLs in an iframe.
 */
type YouTubeReference = {
  kind?: string | null;
  metadata?: unknown;
};

export function youtubeEmbedUrlForMedia(media: YouTubeReference | null | undefined): string | null {
  if (!media || media.kind !== "other" || !media.metadata || typeof media.metadata !== "object") {
    return null;
  }
  const metadata = media.metadata as Record<string, unknown>;
  if (metadata.source !== "youtube" || metadata.reference_only !== true) return null;
  const id = metadata.youtube_video_id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

export function isYouTubeEmbedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "www.youtube-nocookie.com" &&
      /^\/embed\/[A-Za-z0-9_-]{11}$/.test(parsed.pathname) &&
      !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export function presentedMediaKind(media: YouTubeReference): string {
  return youtubeEmbedUrlForMedia(media) ? "video" : media.kind ?? "other";
}
