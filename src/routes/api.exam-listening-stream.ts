import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/exam-listening-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { streamExamListening } = await import(
          "@/lib/listening-stream.server"
        );
        return streamExamListening(request);
      },
      HEAD: async ({ request }) => {
        const { streamExamListening } = await import(
          "@/lib/listening-stream.server"
        );
        return streamExamListening(request, true);
      },
    },
  },
});
