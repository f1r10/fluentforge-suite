import { describe, expect, it } from "vitest";
import { isYouTubeEmbedUrl, presentedMediaKind, youtubeEmbedUrlForMedia } from "@/lib/youtube-media";

describe("YouTube media references", () => {
  const reference = {
    kind: "other",
    external_url: "https://www.youtube.com/watch?v=26PrgjTboVQ",
    metadata: {
      source: "youtube",
      youtube_video_id: "26PrgjTboVQ",
      reference_only: true,
    },
  };

  it("recognizes an existing saved reference as playable embed video", () => {
    expect(youtubeEmbedUrlForMedia(reference)).toBe(
      "https://www.youtube-nocookie.com/embed/26PrgjTboVQ",
    );
    expect(presentedMediaKind(reference)).toBe("video");
    expect(isYouTubeEmbedUrl(youtubeEmbedUrlForMedia(reference))).toBe(true);
  });

  it("does not turn a downloaded video or arbitrary external link into an embed", () => {
    expect(youtubeEmbedUrlForMedia({ ...reference, kind: "video" })).toBeNull();
    expect(youtubeEmbedUrlForMedia({ ...reference, metadata: { source: "youtube" } })).toBeNull();
    expect(youtubeEmbedUrlForMedia({ ...reference, metadata: { source: "other", youtube_video_id: "26PrgjTboVQ", reference_only: true } })).toBeNull();
    expect(youtubeEmbedUrlForMedia({ ...reference, metadata: { source: "youtube", youtube_video_id: "bad<script>", reference_only: true } })).toBeNull();
    expect(isYouTubeEmbedUrl("https://www.youtube-nocookie.com.evil.invalid/embed/26PrgjTboVQ")).toBe(false);
    expect(isYouTubeEmbedUrl("https://www.youtube-nocookie.com/embed/26PrgjTboVQ?autoplay=1")).toBe(false);
    expect(isYouTubeEmbedUrl("javascript:alert(1)")).toBe(false);
    expect(presentedMediaKind({ kind: "image" })).toBe("image");
  });
});
