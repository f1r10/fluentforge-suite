import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime-storage/object")({
  server: {
    handlers: {
      GET: async ({ request }) => serve(request, false),
      HEAD: async ({ request }) => serve(request, true),
    },
  },
});

async function serve(request: Request, headOnly: boolean) {
  if (process.env["RUNTIME_BACKEND"] !== "postgres") {
    return new Response("Not found", { status: 404 });
  }

  try {
    const {
      runtimeObjectInfo,
      validateRuntimeObjectPath,
      verifyStorageCapability,
    } = await import("@/runtime/storage.server");

    const url = new URL(request.url);
    let bucket:
      | "media"
      | "sources"
      | "exports"
      | "backups"
      | "branding";
    let object: string;
    let isPublic = false;

    if (url.searchParams.get("public") === "1") {
      if (url.searchParams.get("bucket") !== "branding") {
        return new Response("Public storage access denied", {
          status: 403,
        });
      }
      bucket = "branding";
      object = validateRuntimeObjectPath(
        url.searchParams.get("path") ?? "",
      );
      isPublic = true;
    } else {
      const capability = verifyStorageCapability(
        url.searchParams.get("token") ?? "",
        "read",
      );
      bucket = capability.bucket;
      object = capability.path;
    }

    const info = await runtimeObjectInfo(bucket, object);
    const size = info.stat.size;
    const range = parseRange(
      request.headers.get("range"),
      size,
    );
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${size}`,
          "accept-ranges": "bytes",
        },
      });
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, size - 1);
    const length = size === 0 ? 0 : end - start + 1;
    const headers = new Headers({
      "accept-ranges": "bytes",
      "content-length": String(length),
      "content-type":
        typeof info.metadata["contentType"] === "string"
          ? info.metadata["contentType"]
          : "application/octet-stream",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": isPublic
        ? "public, max-age=3600"
        : "private, no-store, max-age=0",
    });

    if (range) {
      headers.set(
        "content-range",
        `bytes ${start}-${end}/${size}`,
      );
    }

    if (headOnly || size === 0) {
      return new Response(null, {
        status: range ? 206 : 200,
        headers,
      });
    }

    const stream = createReadStream(info.target, {
      start,
      end,
    });
    return new Response(
      Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      {
        status: range ? 206 : 200,
        headers,
      },
    );
  } catch {
    return new Response("Storage object not found", {
      status: 404,
      headers: {
        "cache-control": "no-store",
      },
    });
  }
}

function parseRange(
  value: string | null,
  size: number,
):
  | { start: number; end: number }
  | "invalid"
  | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return "invalid";

  const left = match[1] ?? "";
  const right = match[2] ?? "";
  if (!left && !right) return "invalid";

  if (!left) {
    const suffix = Number(right);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    const length = Math.min(suffix, size);
    return {
      start: Math.max(0, size - length),
      end: Math.max(0, size - 1),
    };
  }

  const start = Number(left);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return "invalid";
  }

  const requestedEnd = right ? Number(right) : size - 1;
  if (
    !Number.isInteger(requestedEnd) ||
    requestedEnd < start
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}
