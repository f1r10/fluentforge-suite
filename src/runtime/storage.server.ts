import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const RUNTIME_BUCKETS = [
  "media",
  "sources",
  "exports",
  "backups",
  "branding",
] as const;
export type RuntimeBucket = (typeof RUNTIME_BUCKETS)[number];

type Capability = {
  op: "upload" | "read";
  bucket: RuntimeBucket;
  path: string;
  exp: number;
};

const LIMITS: Record<RuntimeBucket, number> = {
  media: 2_500 * 1024 * 1024,
  sources: 1024 * 1024 * 1024,
  exports: 1024 * 1024 * 1024,
  backups: 512 * 1024 * 1024,
  branding: 5 * 1024 * 1024,
};

function storageRoot() {
  return path.resolve(
    process.env["LOCAL_STORAGE_ROOT"]?.trim() || "/data/storage",
  );
}

function signingSecret() {
  const value =
    process.env["APP_STORAGE_SECRET"]?.trim() ||
    process.env["APP_JWT_SECRET"]?.trim() ||
    "";
  if (value.length < 32) {
    throw new Error(
      "APP_STORAGE_SECRET or APP_JWT_SECRET must contain at least 32 characters in postgres runtime.",
    );
  }
  return value;
}

export function validateRuntimeBucket(value: string): RuntimeBucket {
  if (!(RUNTIME_BUCKETS as readonly string[]).includes(value)) {
    throw new Error("Unknown storage bucket.");
  }
  return value as RuntimeBucket;
}

export function validateRuntimeObjectPath(value: string) {
  if (
    !value ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Unsafe storage path.");
  }
  return value;
}

function objectPath(bucket: RuntimeBucket, object: string) {
  const safe = validateRuntimeObjectPath(object);
  const root = path.resolve(storageRoot(), bucket);
  const resolved = path.resolve(root, safe);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Unsafe storage path.");
  }
  return resolved;
}

function metadataPath(bucket: RuntimeBucket, object: string) {
  const safe = validateRuntimeObjectPath(object);
  const root = path.resolve(storageRoot(), ".metadata", bucket);
  const resolved = path.resolve(root, safe + ".json");
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Unsafe metadata path.");
  }
  return resolved;
}

export function runtimeBucketLimit(bucket: RuntimeBucket) {
  return LIMITS[bucket];
}

function encodeCapability(value: Capability) {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", signingSecret())
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyStorageCapability(
  token: string,
  expectedOp: Capability["op"],
) {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) {
    throw new Error("Invalid storage capability.");
  }

  const expected = createHmac("sha256", signingSecret())
    .update(payload, "utf8")
    .digest("base64url");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  if (
    left.length !== right.length ||
    !timingSafeEqual(left, right)
  ) {
    throw new Error("Invalid storage capability.");
  }

  let value: Capability;
  try {
    value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Capability;
  } catch {
    throw new Error("Invalid storage capability.");
  }

  const bucket = validateRuntimeBucket(value.bucket);
  const object = validateRuntimeObjectPath(value.path);
  if (value.op !== expectedOp) {
    throw new Error("Storage capability operation mismatch.");
  }
  if (!Number.isFinite(value.exp) || value.exp <= Date.now()) {
    throw new Error("Storage capability expired.");
  }

  return {
    op: value.op,
    bucket,
    path: object,
    exp: value.exp,
  };
}

export function createStorageCapability(
  op: Capability["op"],
  bucket: RuntimeBucket,
  object: string,
  expiresSeconds: number,
) {
  return encodeCapability({
    op,
    bucket,
    path: validateRuntimeObjectPath(object),
    exp: Date.now() + Math.max(30, expiresSeconds) * 1000,
  });
}

async function readMetadata(
  bucket: RuntimeBucket,
  object: string,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(
      await readFile(metadataPath(bucket, object), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function writeRuntimeObjectMetadata(
  bucket: RuntimeBucket,
  object: string,
  metadata: Record<string, unknown>,
) {
  const target = metadataPath(bucket, object);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(metadata), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function runtimeObjectInfo(
  bucket: RuntimeBucket,
  object: string,
) {
  const target = objectPath(bucket, object);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) throw new Error("Storage object is not a file.");
  const metadata = await readMetadata(bucket, object);
  return {
    target,
    stat: fileStat,
    metadata,
  };
}

async function toBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  throw new Error("Unsupported storage upload payload.");
}

function storageError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function mimeFromPath(object: string) {
  const extension = object.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "ico") return "image/x-icon";
  if (extension === "pdf") return "application/pdf";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "json" || extension === "ffbackup") {
    return "application/octet-stream";
  }
  return "application/octet-stream";
}

export function createRuntimeStorageServer() {
  return {
    from(bucketValue: string) {
      const bucket = validateRuntimeBucket(bucketValue);

      return {
        async createSignedUploadUrl(object: string) {
          try {
            const safe = validateRuntimeObjectPath(object);
            const token = createStorageCapability(
              "upload",
              bucket,
              safe,
              30 * 60,
            );
            return {
              data: {
                path: safe,
                token,
                signedUrl: `/api/runtime-storage/upload?token=${encodeURIComponent(
                  token,
                )}`,
              },
              error: null,
            };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },

        async createSignedUrl(object: string, expiresSeconds: number) {
          try {
            const token = createStorageCapability(
              "read",
              bucket,
              object,
              expiresSeconds,
            );
            return {
              data: {
                signedUrl: `/api/runtime-storage/object?token=${encodeURIComponent(
                  token,
                )}`,
              },
              error: null,
            };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },

        getPublicUrl(object: string) {
          try {
            const safe = validateRuntimeObjectPath(object);
            if (bucket !== "branding") {
              throw new Error("Only branding assets are public.");
            }
            return {
              data: {
                publicUrl:
                  `/api/runtime-storage/object?public=1&bucket=branding&path=${encodeURIComponent(
                    safe,
                  )}`,
              },
            };
          } catch {
            return { data: { publicUrl: "" } };
          }
        },

        async upload(
          object: string,
          value: unknown,
          options?: {
            contentType?: string;
            upsert?: boolean;
          },
        ) {
          try {
            const safe = validateRuntimeObjectPath(object);
            const target = objectPath(bucket, safe);
            const bytes = await toBuffer(value);
            if (bytes.byteLength > runtimeBucketLimit(bucket)) {
              throw new Error("Storage object exceeds bucket size limit.");
            }

            if (!options?.upsert) {
              try {
                await stat(target);
                throw new Error("Storage object already exists.");
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message === "Storage object already exists."
                ) {
                  throw error;
                }
              }
            }

            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, bytes, { mode: 0o600 });
            await writeRuntimeObjectMetadata(bucket, safe, {
              size: bytes.byteLength,
              contentType:
                options?.contentType || mimeFromPath(safe),
              checksum_sha256: createHash("sha256")
                .update(bytes)
                .digest("hex"),
            });

            return {
              data: { path: safe, fullPath: safe },
              error: null,
            };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },

        async download(object: string) {
          try {
            const safe = validateRuntimeObjectPath(object);
            const bytes = await readFile(objectPath(bucket, safe));
            const metadata = await readMetadata(bucket, safe);
            return {
              data: new Blob([bytes], {
                type:
                  typeof metadata["contentType"] === "string"
                    ? metadata["contentType"]
                    : mimeFromPath(safe),
              }),
              error: null,
            };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },

        async remove(objects: string[]) {
          try {
            for (const object of objects) {
              const safe = validateRuntimeObjectPath(object);
              await rm(objectPath(bucket, safe), { force: true });
              await rm(metadataPath(bucket, safe), { force: true });
            }
            return { data: objects.map((name) => ({ name })), error: null };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },

        async list(
          folder = "",
          options?: { search?: string; limit?: number },
        ) {
          try {
            const normalizedFolder = folder
              ? validateRuntimeObjectPath(folder)
              : "";
            const directory = normalizedFolder
              ? objectPath(bucket, normalizedFolder)
              : path.resolve(storageRoot(), bucket);

            let entries: Awaited<ReturnType<typeof readdir>>;
            try {
              entries = await readdir(directory);
            } catch {
              return { data: [], error: null };
            }

            const search = options?.search?.toLowerCase() ?? "";
            const limit = Math.max(
              1,
              Math.min(options?.limit ?? 100, 1_000),
            );
            const out = [];

            for (const name of entries
              .filter((entry) =>
                search ? entry.toLowerCase().includes(search) : true,
              )
              .slice(0, limit)) {
              const object = normalizedFolder
                ? `${normalizedFolder}/${name}`
                : name;
              try {
                const info = await runtimeObjectInfo(bucket, object);
                out.push({
                  name,
                  id: null,
                  updated_at: info.stat.mtime.toISOString(),
                  created_at: info.stat.birthtime.toISOString(),
                  last_accessed_at: info.stat.atime.toISOString(),
                  metadata: {
                    ...info.metadata,
                    size: info.stat.size,
                  },
                });
              } catch {
                // Directories are not returned as objects.
              }
            }

            return { data: out, error: null };
          } catch (error) {
            return { data: null, error: storageError(error) };
          }
        },
      };
    },
  };
}
