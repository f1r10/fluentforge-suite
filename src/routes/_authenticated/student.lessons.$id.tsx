import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getWhoAmI } from "@/lib/teacher.functions";
import { getStudentLesson, markLessonTheoryViewed } from "@/lib/lesson-mode.functions";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { lessonText } from "@/lib/lesson-copy";

export const Route = createFileRoute("/_authenticated/student/lessons/$id")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
  },
  component: StudentLesson,
  head: () => ({ meta: [{ title: "My lesson | FluentForge" }] }),
});

function StudentLesson() {
  const { lang } = useI18n();
  const l = (key: string) => lessonText(lang, key);
  const { id } = Route.useParams();
  const { data: lesson, isPending, error, refetch } = useQuery({
    queryKey: ["student-lesson", id],
    queryFn: () => getStudentLesson({ data: { catalogId: id } }),
  });
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const markViewed = async (revisionId: string, stepId: string, isActivity = false) => {
    setBusyStepId(stepId);
    try {
      await markLessonTheoryViewed({ data: {
        catalogId: id, revisionId, stepId,
      }});
      await refetch();
      toast.success(l(isActivity ? "Activity viewed." : "Theory completed."));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : l("Could not save progress."));
    } finally {
      setBusyStepId(null);
    }
  };

  if (isPending) return <div className="p-6 text-sm text-muted-foreground">{l("Loading lesson…")}</div>;
  if (error) return <div role="alert" className="p-6 text-sm">{error.message}</div>;
  if (!lesson) return <div className="p-6 text-sm">{l("No published lesson is assigned to this catalog.")}</div>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link to="/student/catalogs/$id" params={{ id }}
        className="text-sm text-muted-foreground underline">← {l("Back to catalog")}</Link>
      <div>
        <h1 className="text-2xl font-semibold">{lesson.title}</h1>
        {lesson.description && <p className="mt-2 text-sm">{lesson.description}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {l("Revision")} {lesson.revision} · {lesson.completedRequired} {l("of")} {lesson.totalRequired} {l("required steps completed")}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-md bg-muted" aria-label={l("Lesson progress")}>
        <div className="h-full bg-primary" style={{
          width: lesson.totalRequired
            ? `${Math.round(100 * lesson.completedRequired / lesson.totalRequired)}%`
            : "100%",
        }} />
      </div>
      {lesson.steps.map((step, index) => (
        <section key={step.id} className="space-y-3 rounded-md border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                {index + 1}. {step.title}
              </h2>
              <p className="text-xs text-muted-foreground">
                {l(step.kind === "theory" ? "Theory" : "Activity")} ·
                {l(step.required ? "Required" : "Optional")} · {l(step.state)}
              </p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs">{l(step.state)}</span>
          </div>
          {step.state === "locked" && (
            <p className="text-sm text-muted-foreground">
              {l("Complete the previous required activities to unlock this step.")}
            </p>
          )}
          {step.kind === "theory" && step.state !== "locked" && (
            <>
              <div className="whitespace-pre-wrap text-sm">{step.body}</div>
              {step.state !== "completed" && (
                <Button onClick={() => markViewed(lesson.id, step.id)}
                  disabled={busyStepId !== null}>
                  {l(busyStepId === step.id ? "Saving…" : "I have read this")}
                </Button>
              )}
            </>
          )}
          {step.kind === "activity" && step.state === "available" && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/student/catalogs/$id" params={{ id }}>
                  {l("Open this catalog activity")}
                </Link>
              </Button>
              {step.mode === "view" && (
                <Button onClick={() => markViewed(lesson.id, step.id, true)}
                  disabled={busyStepId !== null}>
                  {l(busyStepId === step.id ? "Saving…" : "I viewed or listened")}
                </Button>
              )}
            </div>
          )}
        </section>
      ))}
      {lesson.complete && (
        <p className="rounded-md border p-4 text-sm font-medium">
          {l("Lesson complete. Your results are preserved for this revision.")}
        </p>
      )}
    </main>
  );
}
