export type BrandingAssetKind = "logo" | "favicon";

export function validateBrandingAssetRequest(
  kind: BrandingAssetKind,
  filename: string,
  mimeType: string,
  sizeBytes: number,
) {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const normalizedMime = mimeType.toLowerCase();

  if (kind === "logo") {
    if (sizeBytes > 5 * 1024 * 1024) {
      throw new Error("Logo must be 5 MB or smaller.");
    }
    const allowed: Record<string, string[]> = {
      png: ["image/png"],
      jpg: ["image/jpeg"],
      jpeg: ["image/jpeg"],
      webp: ["image/webp"],
    };
    if (
      !allowed[extension] ||
      !allowed[extension]!.includes(normalizedMime)
    ) {
      throw new Error("Logo must be PNG, JPEG or WebP.");
    }
    return {
      extension: extension === "jpeg" ? "jpg" : extension,
      contentType: normalizedMime,
    };
  }

  if (sizeBytes > 1024 * 1024) {
    throw new Error("Favicon must be 1 MB or smaller.");
  }

  if (extension === "ico") {
    if (
      normalizedMime &&
      ![
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "application/octet-stream",
      ].includes(normalizedMime)
    ) {
      throw new Error("ICO favicon MIME type is not valid.");
    }
    return { extension: "ico", contentType: "image/x-icon" };
  }

  const allowed: Record<string, string> = {
    png: "image/png",
    webp: "image/webp",
  };
  if (!allowed[extension] || allowed[extension] !== normalizedMime) {
    throw new Error("Favicon must be PNG, WebP or ICO.");
  }
  return { extension, contentType: normalizedMime };
}

export function verifyBrandingAssetBytes(
  kind: BrandingAssetKind,
  path: string,
  bytes: Uint8Array,
) {
  const maxBytes = kind === "logo" ? 5 * 1024 * 1024 : 1024 * 1024;
  if (!bytes.byteLength || bytes.byteLength > maxBytes) {
    throw new Error("Uploaded branding file has an invalid size.");
  }

  const extension = path.toLowerCase().split(".").pop() ?? "";
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP";
  const isIco =
    bytes.length >= 6 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00;

  if (extension === "png" && isPng) return "png";
  if (extension === "jpg" && kind === "logo" && isJpeg) return "jpeg";
  if (extension === "webp" && isWebp) return "webp";
  if (extension === "ico" && kind === "favicon" && isIco) return "ico";

  throw new Error(
    "Uploaded file content does not match the allowed image format.",
  );
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
