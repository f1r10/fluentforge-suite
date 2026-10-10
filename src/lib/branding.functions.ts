import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { validateBrandingAssetRequest, verifyBrandingAssetBytes } from "./branding-assets";

const BUCKET = "branding";

const uploadSchema = z.object({
  kind: z.enum(["logo", "favicon", "login_image"]),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255).default(""),
  sizeBytes: z.number().int().min(1),
});

export const beginBrandingAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => uploadSchema.parse(d))
  .handler(async ({ data }) => {
    const spec = validateBrandingAssetRequest(
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
        kind: z.enum(["logo", "favicon", "login_image"]),
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
    const verified = verifyBrandingAssetBytes(data.kind, data.path, bytes);

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
