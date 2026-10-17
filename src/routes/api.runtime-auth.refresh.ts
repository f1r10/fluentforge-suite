import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime-auth/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env["RUNTIME_BACKEND"] !== "postgres") {
          return new Response("Not found", { status: 404 });
        }

        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > 4096) {
          return new Response("Request too large", { status: 413 });
        }

        try {
          const body = (await request.json()) as {
            refresh_token?: unknown;
          };
          if (
            typeof body.refresh_token !== "string" ||
            body.refresh_token.length < 20 ||
            body.refresh_token.length > 500
          ) {
            return new Response("Invalid refresh token", { status: 400 });
          }

          const {
            refreshRuntimeSession,
          } = await import("@/runtime/auth.server");
          const {
            runtimeServiceDataClient,
          } = await import("@/runtime/server-client");

          const session = await refreshRuntimeSession(
            runtimeServiceDataClient(),
            body.refresh_token,
          );

          return Response.json(session, {
            headers: {
              "cache-control": "no-store",
              pragma: "no-cache",
            },
          });
        } catch {
          return Response.json(
            { error: "Refresh token is not valid." },
            {
              status: 401,
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
