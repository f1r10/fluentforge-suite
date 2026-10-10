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


export async function hydrateQuestionMedia<
  T extends { payload: unknown }
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  questions: T[],
  expiresInSeconds = 3_600,
): Promise<T[]> {
  const mediaIds = [
    ...new Set(
      questions
        .map((question) => {
          const payload =
            question.payload && typeof question.payload === "object"
              ? (question.payload as Record<string, unknown>)
              : {};
          return typeof payload["media_id"] === "string"
            ? payload["media_id"]
            : null;
        })
        .filter((value): value is string => !!value),
    ),
  ];

  if (!mediaIds.length) {
    return questions.map((question) => ({
      ...question,
      payload:
        question.payload && typeof question.payload === "object"
          ? { ...(question.payload as Record<string, unknown>) }
          : {},
    }));
  }

  const { data: mediaRows, error } = await admin
    .from("media_assets")
    .select(
      "id,kind,storage_path,external_url,original_filename,mime_type,width,height,duration_seconds",
    )
    .in("id", mediaIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const resolved = new Map<
    string,
    {
      id: string;
      kind: string;
      external_url: string | null;
      original_filename: string | null;
      mime_type: string | null;
      width: number | null;
      height: number | null;
      duration_seconds: number | null;
    }
  >();

  await Promise.all(
    (mediaRows ?? []).map(async (media: {
      id: string;
      kind: string;
      storage_path: string | null;
      external_url: string | null;
      original_filename: string | null;
      mime_type: string | null;
      width: number | null;
      height: number | null;
      duration_seconds: number | null;
    }) => {
      resolved.set(media.id, {
        id: media.id,
        kind: media.kind,
        external_url: await resolveMediaUrl(admin, media, expiresInSeconds),
        original_filename: media.original_filename,
        mime_type: media.mime_type,
        width: media.width,
        height: media.height,
        duration_seconds: media.duration_seconds,
      });
    }),
  );

  return questions.map((question) => {
    const payload =
      question.payload && typeof question.payload === "object"
        ? { ...(question.payload as Record<string, unknown>) }
        : {};
    const mediaId =
      typeof payload["media_id"] === "string"
        ? payload["media_id"]
        : null;
    payload["media"] = mediaId ? resolved.get(mediaId) ?? null : null;
    return { ...question, payload } as T;
  });
}
