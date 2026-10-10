import { randomUUID, createHash } from "node:crypto";
import {
  link,
  mkdir,
  rm,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import {
  Readable,
  Transform,
} from "node:stream";
import { pipeline } from "node:stream/promises";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime-storage/upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        if (process.env["RUNTIME_BACKEND"] !== "postgres") {
          return new Response("Not found", { status: 404 });
        }

        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";

        try {
          const {
            runtimeBucketLimit,
            runtimeObjectPath,
            verifyStorageCapability,
            writeRuntimeObjectMetadata,
          } = await import("@/runtime/storage.server");

          const capability = verifyStorageCapability(token, "upload");
          const declaredBucket = request.headers.get(
            "x-runtime-storage-bucket",
          );
          const declaredPath = request.headers.get(
            "x-runtime-storage-path",
          );
          if (
            (declaredBucket && declaredBucket !== capability.bucket) ||
            (declaredPath && declaredPath !== capability.path)
          ) {
            return new Response("Upload capability mismatch", {
              status: 403,
            });
          }

          const limit = runtimeBucketLimit(capability.bucket);
          const contentLength = Number(
            request.headers.get("content-length") ?? 0,
          );
          if (contentLength > limit) {
            return new Response("Storage object too large", {
              status: 413,
            });
          }
          if (!request.body) {
            return new Response("Upload body is required", {
              status: 400,
            });
          }

          const target = runtimeObjectPath(
            capability.bucket,
            capability.path,
          );
          await mkdir(path.dirname(target), { recursive: true });
          const temp = `${target}.upload-${randomUUID()}`;
          let total = 0;
          const digest = createHash("sha256");

          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              const bytes = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
              total += bytes.byteLength;
              if (total > limit) {
                callback(new Error("Storage object too large"));
                return;
              }
              digest.update(bytes);
              callback(null, bytes);
            },
          });

          try {
            await pipeline(
              Readable.fromWeb(request.body as never),
              counter,
              createWriteStream(temp, {
                flags: "wx",
                mode: 0o600,
              }),
            );

            try {
              await link(temp, target);
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "EEXIST"
              ) {
                throw new Error("Storage object already exists.");
              }
              throw error;
            } finally {
              await rm(temp, { force: true });
            }

            await writeRuntimeObjectMetadata(
              capability.bucket,
              capability.path,
              {
                size: total,
                contentType:
                  request.headers.get("content-type") ||
                  "application/octet-stream",
                checksum_sha256: digest.digest("hex"),
              },
            );

            return Response.json(
              {
                path: capability.path,
                size: total,
              },
              {
                status: 201,
                headers: {
                  "cache-control": "no-store",
                },
              },
            );
          } catch (error) {
            await rm(temp, { force: true });
            const message =
              error instanceof Error
                ? error.message
                : "Upload failed.";
            return new Response(message, {
              status: message.includes("too large") ? 413 : 409,
              headers: {
                "cache-control": "no-store",
              },
            });
          }
        } catch {
          return new Response("Invalid or expired upload capability", {
            status: 403,
            headers: {
              "cache-control": "no-store",
            },
          });
        }
      },
    },
  },
});
