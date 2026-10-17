import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, LockKeyhole, BookOpenCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStudentLesson, markLessonStepViewed } from "@/lib/lesson.functions";
import { useI18n } from "@/lib/i18n";

type ItemTitle = { id: string; title: string };
const labels = {
  az: {title:"Mənim dərsim", hint:"Addımları ardıcıllıqla tamamla. Nəticələr müəllimə görünür.", completed:"Tamamlandı", available:"Hazırdır", locked:"Bağlıdır", view:"Oxudum / baxdım", start:"Tapşırığa keç", progress:"Tamamlanan məcburi addım", done:"Dərs tamamlandı", attempt:"Tapşırığı həll et və nəticəni yenilə"},
  en: {title:"My lesson", hint:"Complete the steps in order. Your teacher can see progress.", completed:"Completed", available:"Available", locked:"Locked", view:"I've viewed this", start:"Go to activity", progress:"Required steps completed", done:"Lesson completed", attempt:"Complete the practice and refresh progress"},
  ru: {title:"Мой урок", hint:"Проходите этапы по порядку. Преподаватель видит прогресс.", completed:"Завершено", available:"Доступно", locked:"Закрыто", view:"Я просмотрел(а)", start:"Перейти к заданию", progress:"Обязательные шаги", done:"Урок завершён", attempt:"Выполните практику и обновите прогресс"},
  tr: {title:"Dersim", hint:"Adımları sırayla tamamlayın. Öğretmeniniz ilerlemeyi görebilir.", completed:"Tamamlandı", available:"Hazır", locked:"Kilitli", view:"İnceledim", start:"Etkinliğe geç", progress:"Tamamlanan zorunlu adım", done:"Ders tamamlandı", attempt:"Alıştırmayı yapıp ilerlemeyi yenileyin"},
} as const;

export function LessonProgress({ catalogId, titles }: {
  catalogId: string; titles: ItemTitle[];
}) {
  const { lang } = useI18n();
  const t = labels[lang] ?? labels.en;
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["student-lesson", catalogId],
    queryFn: () => getStudentLesson({ data: { catalogId } }),
    refetchOnWindowFocus: true,
  });
  if (isLoading) return null;
  if (error) return <p role="alert" className="text-sm text-destructive">{String(error)}</p>;
  if (!data?.lesson || !data.progress) return null;
  const titleMap = new Map(titles.map((item) => [item.id, item.title]));
  const { lesson, progress } = data;

  async function markViewed(stepId: string) {
    try {
      await markLessonStepViewed({ data: { catalogId, stepId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["student-lesson", catalogId] }),
        qc.invalidateQueries({ queryKey: ["student-practice", catalogId] }),
      ]);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }
  function jump(id: string) {
    document.getElementById("lesson-item-" + id)?.scrollIntoView({
      behavior: "smooth", block: "start",
    });
  }
  return (
    <section className="mb-6 space-y-4 rounded-md border border-border p-4" aria-label={t.title}>
      <div className="flex items-start gap-3">
        <BookOpenCheck className="mt-1 h-5 w-5" />
        <div className="flex-1">
          <h2 className="font-semibold">{t.title} — {lesson.title}</h2>
          <p className="text-sm text-muted-foreground">{t.hint}</p>
          {!lesson.enforce_locks && (
            <p className="text-xs text-muted-foreground">
              {lang === "az"
                ? "Adi kataloq məşqləri də əlçatandır; dərs ardıcıllığı ayrıca izlənir."
                : lang === "ru"
                  ? "Обычная практика каталога остаётся доступной."
                  : lang === "tr"
                    ? "Normal katalog alıştırmaları da kullanılabilir."
                    : "Regular catalog practice remains available."}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {t.progress}: {progress.completedRequired}/{progress.totalRequired}
          </p>
        </div>
        <Button size="sm" variant="outline"
          onClick={() => void qc.invalidateQueries({ queryKey: ["student-lesson", catalogId] })}>
          ↻
        </Button>
      </div>
      {progress.complete && (
        <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" />{t.done}</p>
      )}
      <ol className="space-y-2">
        {progress.steps.map((step, i) => (
          <li key={step.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="flex min-w-0 items-center gap-2">
              {step.state === "completed" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> :
                step.state === "locked" ? <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" /> :
                <span className="w-4 shrink-0 text-sm tabular-nums">{i + 1}.</span>}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {titleMap.get(step.id) ?? step.entity_type}
                </div>
                <p className="text-xs text-muted-foreground">
                  {step.state === "completed" ? t.completed : step.state === "locked" ? t.locked : t.available}
                  {step.mode === "pass" ? " · " + step.minScorePercent + "%" : ""}
                </p>
              </div>
            </div>
            {step.state === "available" && (
              step.mode === "view"
                ? <Button size="sm" onClick={() => void markViewed(step.id)}>{t.view}</Button>
                : <Button size="sm" variant="outline" onClick={() => jump(step.id)}>{t.start}</Button>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{t.attempt}</p>
    </section>
  );
}
