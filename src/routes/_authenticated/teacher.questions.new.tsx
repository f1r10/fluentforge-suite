import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { listTopics } from "@/lib/questions.functions";
import { QuestionEditor } from "@/components/app/QuestionEditor";
import { useI18n } from "@/lib/i18n";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });

export const Route = createFileRoute("/_authenticated/teacher/questions/new")({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  component: NewQuestion,
});

function NewQuestion() {
  const { t } = useI18n();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/teacher/questions" className="text-sm text-muted-foreground hover:underline">← {t("questions_bank")}</Link>
      <h1 className="text-2xl font-bold">{t("add_question")}</h1>
      <QuestionEditor topics={topics} />
    </div>
  );
}
