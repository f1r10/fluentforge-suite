import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const BUCKET = "branding";

const uploadSchema = z.object({
  kind: z.enum(["logo", "favicon"]),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255).default(""),
  sizeBytes: z.number().int().min(1),
});

export const beginBrandingAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => uploadSchema.parse(d))
  .handler(async ({ data }) => {
    const spec = validateRequestedAsset(
      data.kind,
      data.filename,
      data.mimeType,
      data.sizeBytes,
    );
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const path = `${data.kind}/${crypto.randomUUID()}.${spec.extension}`;
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) {
      throw new Error(error?.message ?? "Could not authorize branding upload.");
    }

    return {
      bucket: BUCKET,
      path,
      token: signed.token,
      contentType: spec.contentType,
    };
  });

export const finalizeBrandingAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["logo", "favicon"]),
        path: z.string().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const expectedPrefix = `${data.kind}/`;
    if (
      !data.path.startsWith(expectedPrefix) ||
      data.path.includes("..") ||
      data.path.includes("\\")
    ) {
      throw new Error("Invalid branding asset path.");
    }

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: file, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(data.path);
    if (downloadError || !file) {
      throw new Error(downloadError?.message ?? "Uploaded branding file was not found.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const verified = verifyUploadedAsset(data.kind, data.path, bytes);

    const { data: currentRow, error: settingsError } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "branding")
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const current =
      currentRow?.value && typeof currentRow.value === "object"
        ? (currentRow.value as Record<string, unknown>)
        : {};
    const oldPathKey = `${data.kind}_storage_path`;
    const oldPath =
      typeof current[oldPathKey] === "string"
        ? (current[oldPathKey] as string)
        : null;

    const { data: publicData } = admin.storage
      .from(BUCKET)
      .getPublicUrl(data.path);
    const publicUrl = publicData.publicUrl;
    const urlKey = `${data.kind}_url`;

    const { error: updateError } = await admin
      .from("system_settings")
      .update({
        value: {
          ...current,
          [urlKey]: publicUrl,
          [oldPathKey]: data.path,
        } as never,
      })
      .eq("key", "branding");
    if (updateError) throw new Error(updateError.message);

    if (oldPath && oldPath !== data.path) {
      await admin.storage.from(BUCKET).remove([oldPath]);
    }

    const folder = data.kind;
    const { data: objects } = await admin.storage
      .from(BUCKET)
      .list(folder, { limit: 100 });
    const stale = (objects ?? [])
      .map((object) => `${folder}/${object.name}`)
      .filter((path) => path !== data.path);
    if (stale.length) {
      await admin.storage.from(BUCKET).remove(stale);
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "branding_asset_uploaded",
      entity_type: "system_setting",
      summary: `${data.kind} branding asset uploaded`,
      details: {
        kind: data.kind,
        storage_path: data.path,
        bytes: bytes.byteLength,
        format: verified,
      },
    });

    return {
      url: publicUrl,
      path: data.path,
      format: verified,
      sizeBytes: bytes.byteLength,
    };
  });

function validateRequestedAsset(
  kind: "logo" | "favicon",
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

function verifyUploadedAsset(
  kind: "logo" | "favicon",
  path: string,
  bytes: Buffer,
) {
  const maxBytes = kind === "logo" ? 5 * 1024 * 1024 : 1024 * 1024;
  if (!bytes.byteLength || bytes.byteLength > maxBytes) {
    throw new Error("Uploaded branding file has an invalid size.");
  }

  const extension = path.toLowerCase().split(".").pop() ?? "";
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
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

  throw new Error("Uploaded file content does not match the allowed image format.");
}
