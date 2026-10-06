import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getQuestion, listQuestionVersions, listTopics } from "@/lib/questions.functions";
import { QuestionEditor, fromQuestion } from "@/components/app/QuestionEditor";
import { formatDateTime } from "@/components/app/common";
import { useI18n } from "@/lib/i18n";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });
const questionQuery = (id: string) => queryOptions({ queryKey: ["question", id], queryFn: () => getQuestion({ data: { id } }) });

export const Route = createFileRoute("/_authenticated/teacher/questions/$id")({
  loader: ({ context, params }) => Promise.all([context.queryClient.ensureQueryData(topicsQuery), context.queryClient.ensureQueryData(questionQuery(params.id))]),
  component: EditQuestion,
});

function EditQuestion() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const { data: q } = useSuspenseQuery(questionQuery(id));
  const [showVersions, setShowVersions] = useState(false);
  const versions = useQuery({ queryKey: ["versions", id, q.current_version], queryFn: () => listQuestionVersions({ data: { id } }), enabled: showVersions });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/teacher/questions" className="text-sm text-muted-foreground hover:underline">← {t("questions_bank")}</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("edit")} <span className="text-base font-normal text-muted-foreground">· {t("version")} {q.current_version}</span></h1>
        <button className="text-sm text-primary hover:underline" onClick={() => setShowVersions(!showVersions)}>{t("versions")}</button>
      </div>
      {showVersions && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {versions.data?.map((v) => (
            <li key={v.version} className="flex gap-3 px-3 py-2">
              <span className="w-10 shrink-0 font-medium">v{v.version}</span>
              <span className="w-40 shrink-0 text-muted-foreground">{formatDateTime(v.created_at, lang)}</span>
              <span className="line-clamp-2">{v.snapshot.prompt}</span>
            </li>
          ))}
        </ul>
      )}
      <QuestionEditor key={`${id}-${q.current_version}`} id={id} initial={fromQuestion(q)} topics={topics} />
    </div>
  );
}
