import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/scheduled-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configured = process.env["SCHEDULED_JOB_SECRET"]?.trim();
        if (!configured) {
          return Response.json(
            { status: "unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }

        const authorization = request.headers.get("authorization") ?? "";
        const supplied = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : "";

        if (!secureEqual(configured, supplied)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: { "cache-control": "no-store" } },
          );
        }

        try {
          const { runScheduledBackupIfDue } = await import(
            "@/lib/backup.functions"
          );
          const result = await runScheduledBackupIfDue();
          return Response.json(result, {
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          return Response.json(
            {
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Scheduled backup failed",
            },
            {
              status: 500,
              headers: { "cache-control": "no-store" },
            },
          );
        }
      },
    },
  },
});

function secureEqual(expected: string, supplied: string) {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
