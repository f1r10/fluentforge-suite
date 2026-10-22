/** Whether extracted source regions need their original file for later rendering.
 * Imported questions store normalized crops, not complete image bytes.
 * Deleting the PDF/image before crops are materialized is irreversible data loss.
 */
export function sourceNeedsVisualProvenance(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): boolean {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0]?.trim();
  if (mime === "application/pdf" || mime?.startsWith("image/")) return true;
  return /\.(?:pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(filename ?? "");
}
