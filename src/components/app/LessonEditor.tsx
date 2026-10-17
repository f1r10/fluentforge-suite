import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BookOpenCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getTeacherLesson, publishLessonDraft, saveLessonDraft } from "@/lib/lesson.functions";
import type { LessonStepRule } from "@/lib/lesson-sequencing";
import { useI18n } from "@/lib/i18n";

type CatalogItem = {
  id: string; entity_type: string; title: string;
  status: string; available: boolean;
};
const labels = {
  az: {title:"Ardıcıl dərs", hint:"Mövcud kataloq məzmunundan dərs planı qurun. Dərc edilmiş versiya dəyişmir.", include:"Dərsə daxil et", required:"Məcburi", rule:"Tamamlanma", view:"Baxış", attempt:"Cəhd", pass:"Keçid balı", score:"Minimum bal (%)", save:"Qaralamanı saxla", publish:"Saxla və dərc et", revision:"Dərc versiyası", sequential:"Addımları ardıcıllıqla aç", empty:"Əvvəl kataloqa məzmun əlavə edin.", review:"Dərc etməzdən əvvəl dərsin sırasını və tamamlanma qaydalarını yoxlayın."},
  en: {title:"Sequential lesson", hint:"Build a lesson from existing catalog content. Published revisions remain unchanged.", include:"Include", required:"Required", rule:"Completion", view:"View", attempt:"Attempt", pass:"Pass score", score:"Minimum score (%)", save:"Save draft", publish:"Save and publish", revision:"Published revision", sequential:"Unlock steps sequentially", empty:"Add content to this catalog first.", review:"Review the sequence and rules before publishing."},
  ru: {title:"Последовательный урок", hint:"Создайте урок из материалов каталога. Опубликованные версии неизменяемы.", include:"Включить", required:"Обязательно", rule:"Завершение", view:"Просмотр", attempt:"Попытка", pass:"Проходной балл", score:"Минимальный балл (%)", save:"Сохранить черновик", publish:"Сохранить и опубликовать", revision:"Версия", sequential:"Открывать последовательно", empty:"Сначала добавьте материалы в каталог.", review:"Проверьте порядок и критерии перед публикацией."},
  tr: {title:"Sıralı ders", hint:"Mevcut katalog içeriğinden ders hazırlayın. Yayımlanan sürümler değişmez.", include:"Derse ekle", required:"Zorunlu", rule:"Tamamlama", view:"Görüntüleme", attempt:"Deneme", pass:"Geçme puanı", score:"Minimum puan (%)", save:"Taslağı kaydet", publish:"Kaydet ve yayımla", revision:"Yayın sürümü", sequential:"Adımları sırayla aç", empty:"Önce kataloğa içerik ekleyin.", review:"Yayımlamadan önce sıra ve kuralları kontrol edin."},
} as const;

export function LessonEditor({ catalogId, items }: {
  catalogId: string; items: CatalogItem[];
}) {
  const { lang } = useI18n();
  const t = labels[lang] ?? labels.en;
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["teacher-lesson", catalogId],
    queryFn: () => getTeacherLesson({ data: { catalogId } }),
  });
  const [steps, setSteps] = useState<LessonStepRule[]>([]);
  const [sequential, setSequential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!data || initialized) return;
    const saved = data.draft?.steps ?? data.latest?.steps ?? [];
    setSteps(saved.map((step) => ({
      id: step.id, required: step.required, mode: step.mode,
      minScorePercent: step.minScorePercent,
    })));
    setSequential(data.draft?.sequential ?? data.latest?.sequential ?? true);
    setInitialized(true);
  }, [data, initialized]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const eligible = items.filter((item) => item.available && item.status === "active");
  const selected = steps.filter((step) => itemById.has(step.id));
  const modeDefault = (item: CatalogItem) =>
    item.entity_type === "question" || item.entity_type === "vocabulary" ? "attempt" : "view";
  function toggle(item: CatalogItem, include: boolean) {
    setSteps((old) => include
      ? [...old, { id: item.id, required: true, mode: modeDefault(item) }]
      : old.filter((step) => step.id !== item.id));
  }
  function patch(id: string, values: Partial<LessonStepRule>) {
    setSteps((old) => old.map((step) => step.id === id ? { ...step, ...values } : step));
  }
  function move(id: string, delta: number) {
    setSteps((old) => {
      const next = [...old];
      const index = next.findIndex((step) => step.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= next.length) return old;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  async function persist(publish: boolean) {
    if (!selected.length) { toast.error(t.empty); return; }
    setBusy(true);
    try {
      await saveLessonDraft({ data: { catalogId, sequential, steps: selected } });
      if (publish) {
        await publishLessonDraft({ data: { catalogId } });
      }
      await qc.invalidateQueries({ queryKey: ["teacher-lesson", catalogId] });
      toast.success(publish ? t.publish : t.save);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
  return (
    <section className="space-y-4 rounded-md border border-border p-4" aria-label={t.title}>
      <div className="flex flex-wrap items-start gap-3">
        <BookOpenCheck className="mt-1 h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.hint}</p>
        </div>
        {data?.latest && (
          <span className="rounded-md bg-muted px-2 py-1 text-xs">{t.revision} {data.latest.revision}</span>
        )}
      </div>
      {isLoading && <p className="text-sm">…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{String(error)}</p>}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={sequential} onCheckedChange={(checked) => setSequential(checked === true)} />
        {t.sequential}
      </label>
      <p className="text-xs text-muted-foreground">{t.include}</p>
      <div className="grid max-h-44 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
        {eligible.map((item) => (
          <label key={item.id} className="flex min-w-0 items-center gap-2 rounded border border-border p-2 text-sm">
            <Checkbox checked={steps.some((step) => step.id === item.id)}
              onCheckedChange={(value) => toggle(item, value === true)} />
            <span className="truncate">{item.title}</span>
            <span className="ml-auto text-xs text-muted-foreground">{item.entity_type}</span>
          </label>
        ))}
      </div>
      {!eligible.length && <p className="text-sm text-muted-foreground">{t.empty}</p>}
      <div className="space-y-2">
        {selected.map((step, index) => {
          const item = itemById.get(step.id)!;
          const graded = ["question", "vocabulary"].includes(item.entity_type);
          return (
            <div key={step.id} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[2fr_auto_160px_100px] md:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{index + 1}. {item.title}</div>
                <div className="text-xs text-muted-foreground">{item.entity_type}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" disabled={index === 0}
                  aria-label="Move up" onClick={() => move(step.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" disabled={index === selected.length - 1}
                  aria-label="Move down" onClick={() => move(step.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <label className="flex items-center gap-1 px-2 text-xs">
                  <Checkbox checked={step.required}
                    onCheckedChange={(v) => patch(step.id, { required: v === true })} />
                  {t.required}
                </label>
              </div>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label={t.rule} value={step.mode}
                onChange={(e) => patch(step.id, {
                  mode: e.target.value as LessonStepRule["mode"],
                  minScorePercent: e.target.value === "pass" ? (step.minScorePercent ?? 80) : undefined,
                })}>
                <option value="view">{t.view}</option>
                {graded && <option value="attempt">{t.attempt}</option>}
                {graded && <option value="pass">{t.pass}</option>}
              </select>
              {step.mode === "pass" ? (
                <input type="number" min={0} max={100} value={step.minScorePercent ?? 80}
                  aria-label={t.score} className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  onChange={(e) => patch(step.id, { minScorePercent: Number(e.target.value) })} />
              ) : <span />}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t.review}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !selected.length}
          onClick={() => void persist(false)}>{t.save}</Button>
        <Button disabled={busy || !selected.length || data?.catalog.status !== "active"}
          onClick={() => void persist(true)}>{t.publish}</Button>
      </div>
    </section>
  );
}
