import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime-auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env["RUNTIME_BACKEND"] !== "postgres") {
          return new Response("Not found", { status: 404 });
        }

        try {
          const body = (await request.json()) as {
            refresh_token?: unknown;
          };
          if (typeof body.refresh_token === "string") {
            const {
              revokeRuntimeRefreshToken,
            } = await import("@/runtime/auth.server");
            const {
              runtimeServiceDataClient,
            } = await import("@/runtime/server-client");

            await revokeRuntimeRefreshToken(
              runtimeServiceDataClient(),
              body.refresh_token,
            );
          }
        } catch {
          // Logout is idempotent. The browser still clears its local session.
        }

        return new Response(null, {
          status: 204,
          headers: {
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
