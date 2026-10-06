export const MEDIA_BUCKET = "media";

type StorageAdmin = {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export type MediaLocation = {
  storage_path?: string | null;
  external_url?: string | null;
};

export async function resolveMediaUrl(
  admin: StorageAdmin,
  media: MediaLocation | null | undefined,
  expiresInSeconds = 3_600,
) {
  if (!media) return null;
  if (media.external_url) return media.external_url;
  if (!media.storage_path) return null;

  const { data, error } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(media.storage_path, expiresInSeconds);

  if (error) throw new Error(error.message);
  return data?.signedUrl ?? null;
}
