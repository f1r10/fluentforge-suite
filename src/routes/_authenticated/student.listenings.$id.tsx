import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getStudentListeningPractice } from "@/lib/student-library.functions";
import { StudentContextSession } from "@/components/app/StudentContextSession";
import type { StudentListeningPractice } from "@/components/app/StudentContextPractice";
import { useI18n } from "@/lib/i18n";

const listeningQuery = (id: string) =>
  queryOptions({
    queryKey: ["student-listening-practice", id],
    queryFn: () => getStudentListeningPractice({ data: { id } }),
  });

export const Route = createFileRoute(
  "/_authenticated/student/listenings/$id",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(listeningQuery(params.id)),
  head: () => ({
    meta: [
      { title: "Listening practice" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentListeningPage,
});

function StudentListeningPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data } = useSuspenseQuery(listeningQuery(id));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Link
        to="/student/listenings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back_to_library")}
      </Link>
      <StudentContextSession
        kind="listening"
        data={data as unknown as StudentListeningPractice}
      />
    </div>
  );
}
