export type NormalizedSourceCrop = { x: number; y: number; width: number; height: number };

/** Build one bounded PDF clip around the teacher-visible associated image(s).
 * Decorative repeated art is removed by the upstream PDF extractor.
 * Invalid geometry is a review failure, not permission to silently drop art.
 */
export function importedQuestionImageCrop(context: unknown): NormalizedSourceCrop | null {
  if (!context || typeof context !== "object") return null;
  const assets = (context as Record<string, unknown>)["assets"];
  if (!Array.isArray(assets)) return null;
  const images = assets.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" &&
    (item as Record<string, unknown>)["kind"] === "image_region",
  );
  // A table can carry the information required to answer a question even
  // when the PDF contains no raster images. Prefer explicit diagram images
  // over nearby tables to avoid clipping an unrelated whole-page grid.
  const regions = images.length ? images : assets.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" &&
    (item as Record<string, unknown>)["kind"] === "table",
  );
  if (!regions.length) return null;
  if (regions.length > 8) throw new Error("Too many source images for one question.");
  const crops = regions.map((image) => {
    const value = image["crop"];
    if (!value || typeof value !== "object") {
      throw new Error("Source image region has no PDF coordinates.");
    }
    const box = value as Record<string, unknown>;
    const x = Number(box["x"]), y = Number(box["y"]);
    const width = Number(box["width"]), height = Number(box["height"]);
    if (![x, y, width, height].every(Number.isFinite) ||
        x < 0 || y < 0 || width <= 0 || height <= 0 ||
        x + width > 1.00001 || y + height > 1.00001) {
      throw new Error("Source image coordinates are not valid.");
    }
    return { x, y, width, height };
  });
  const pad = 0.008;
  const left = Math.max(0, Math.min(...crops.map(c => c.x)) - pad);
  const top = Math.max(0, Math.min(...crops.map(c => c.y)) - pad);
  const right = Math.min(1, Math.max(...crops.map(c => c.x + c.width)) + pad);
  const bottom = Math.min(1, Math.max(...crops.map(c => c.y + c.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
