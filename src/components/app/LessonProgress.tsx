import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getStudentLesson, markLessonStepViewed } from "@/lib/lesson.functions";
import { useI18n } from "@/lib/i18n";

const words = {
  az:["Dərsim","Tamamlanmış addımlar","Tamamlandı","Bağlıdır","Hazırdır","Baxdım","Məşqi aşağıda həll edin","Proqresi yenilə"],
  en:["My lesson","Completed steps","Completed","Locked","Available","Viewed","Complete the practice below","Refresh progress"],
  ru:["Мой урок","Пройдено шагов","Готово","Закрыто","Доступно","Просмотрено","Выполните практику ниже","Обновить"],
  tr:["Dersim","Tamamlanan adımlar","Tamamlandı","Kilitli","Hazır","İnceledim","Aşağıdaki alıştırmayı tamamlayın","Yenile"],
} as const;

export function LessonProgress({catalogId,titles}:{
  catalogId:string;titles:Array<{id:string;title:string}>;
}) {
  const {lang}=useI18n();
  const w=words[lang]??words.en;
  const qc=useQueryClient();
  const query=useQuery({
    queryKey:["lesson-student",catalogId],
    queryFn:()=>getStudentLesson({data:{catalogId}}),
    refetchOnWindowFocus:true,
  });
  if(query.isLoading)return null;
  if(query.error)return <p role="alert" className="mb-4 text-sm text-destructive">{String(query.error)}</p>;
  if(!query.data?.lesson || !query.data.progress)return null;
  const {lesson,progress}=query.data;
  const byId=new Map(titles.map(x=>[x.id,x.title]));
  async function viewed(id:string){
    try{
      await markLessonStepViewed({data:{catalogId,stepId:id}});
      await qc.invalidateQueries({queryKey:["lesson-student",catalogId]});
    }catch(error){toast.error(error instanceof Error?error.message:String(error));}
  }
  return <section aria-label={w[0]} className="mb-6 space-y-3 rounded-md border border-border p-4">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="font-semibold">{w[0]} — {lesson.title}</h2>
        <p className="text-xs text-muted-foreground">{w[1]}: {progress.completedRequired}/{progress.totalRequired}</p>
      </div>
      <Button size="sm" variant="outline" onClick={()=>void qc.invalidateQueries({
        queryKey:["lesson-student",catalogId],
      })}>{w[7]}</Button>
    </div>
    <ol className="space-y-2">
      {progress.steps.map((status,index)=>{
        const source=lesson.steps.find(x=>x.id===status.id);
        const title=byId.get(status.id)??source?.entity_type??status.id;
        const stateText=status.state==="completed"?w[2]:status.state==="locked"?w[3]:w[4];
        return <li key={status.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
          <div className="min-w-0">
            <div className="truncate text-sm">{index+1}. {title}</div>
            <div className="text-xs text-muted-foreground">{stateText}
              {status.mode==="pass"?" · "+status.minScorePercent+"%":""}</div>
          </div>
          {status.state==="available" && status.mode==="view" &&
            <Button size="sm" variant="outline" onClick={()=>void viewed(status.id)}>{w[5]}</Button>}
        </li>;
      })}
    </ol>
    <p className="text-xs text-muted-foreground">{w[6]}</p>
  </section>;
}
