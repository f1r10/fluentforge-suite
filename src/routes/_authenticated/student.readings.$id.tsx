import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getStudentReadingPractice } from "@/lib/student-library.functions";
import { StudentContextSession } from "@/components/app/StudentContextSession";
import type { StudentReadingPractice } from "@/components/app/StudentContextPractice";
import { useI18n } from "@/lib/i18n";

const readingQuery = (id: string) =>
  queryOptions({
    queryKey: ["student-reading-practice", id],
    queryFn: () => getStudentReadingPractice({ data: { id } }),
  });

export const Route = createFileRoute(
  "/_authenticated/student/readings/$id",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(readingQuery(params.id)),
  head: () => ({
    meta: [
      { title: "Reading practice" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentReadingPage,
});

function StudentReadingPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data } = useSuspenseQuery(readingQuery(id));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Link
        to="/student/readings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back_to_library")}
      </Link>
      <StudentContextSession
        kind="reading"
        data={data as unknown as StudentReadingPractice}
      />
    </div>
  );
}
