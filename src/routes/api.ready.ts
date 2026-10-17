import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ready")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { adminClient } = await import("@/lib/security.server");
          const admin = await adminClient();
          const { error } = await admin
            .from("languages")
            .select("code")
            .limit(1);
          if (error) throw new Error(error.message);

          return Response.json(
            {
              status: "ready",
              database: "ok",
            },
            {
              headers: {
                "cache-control": "no-store",
              },
            },
          );
        } catch {
          return Response.json(
            {
              status: "not_ready",
              database: "unavailable",
            },
            {
              status: 503,
              headers: {
                "cache-control": "no-store",
              },
            },
          );
        }
      },
    },
  },
});
