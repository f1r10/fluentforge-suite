import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getTeacherLesson, publishLessonDraft, saveLessonDraft } from "@/lib/lesson.functions";
import type { LessonStepRule } from "@/lib/lesson-sequencing";
import { useI18n } from "@/lib/i18n";

type Item = {id:string;title:string;entity_type:string;status:string;available:boolean};
const words = {
  az: ["Dərs ardıcıllığı","Mövcud kataloq məzmunundan dərs yaradın.","Addımlar ardıcıl açılsın",
    "Məcburi","Şərt","Baxış","Cəhd","Keçid balı","Minimum bal %",
    "Qaralamanı saxla","Yoxla və dərc et","Dərc versiyası","Əvvəl kataloqa aktiv məzmun əlavə edin."],
  en: ["Lesson sequence","Build a lesson from existing catalog content.","Unlock sequentially",
    "Required","Rule","View","Attempt","Pass","Minimum score %",
    "Save draft","Review and publish","Published revision","Add active catalog content first."],
  ru: ["Этапы урока","Создайте урок из материалов каталога.","Открывать по порядку",
    "Обязательно","Критерий","Просмотр","Попытка","Сдать","Минимальный балл %",
    "Сохранить","Проверить и опубликовать","Версия","Сначала добавьте материалы."],
  tr: ["Ders sırası","Katalog içeriğinden ders hazırlayın.","Sırayla aç",
    "Zorunlu","Koşul","Görüntüle","Deneme","Geçme","Minimum puan %",
    "Taslağı kaydet","Kontrol et ve yayımla","Yayın sürümü","Önce katalog içeriği ekleyin."],
} as const;

export function LessonEditor({catalogId,items}: {catalogId:string;items:Item[]}) {
  const {lang}=useI18n();
  const w=words[lang]??words.en;
  const qc=useQueryClient();
  const query=useQuery({queryKey:["lesson-teacher",catalogId],
    queryFn:()=>getTeacherLesson({data:{catalogId}})});
  const [initialized,setInitialized]=useState(false);
  const [sequential,setSequential]=useState(true);
  const [steps,setSteps]=useState<LessonStepRule[]>([]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(initialized||!query.data)return;
    const initial=query.data.draft??query.data.latest;
    setSteps((initial?.steps??[]).map(step=>({
      id:step.id,required:step.required,mode:step.mode,
      minScorePercent:step.minScorePercent,
    })));
    setSequential(initial?.sequential??true);
    setInitialized(true);
  },[query.data,initialized]);
  const selected=steps.filter(step=>items.some(item=>item.id===step.id));
  function toggle(item:Item,yes:boolean){
    setSteps(old=>yes
      ? [...old,{id:item.id,required:true,mode:
          ["question","vocabulary"].includes(item.entity_type)?"attempt":"view"}]
      :old.filter(step=>step.id!==item.id));
  }
  function change(id:string,partial:Partial<LessonStepRule>){
    setSteps(old=>old.map(step=>step.id===id?{...step,...partial}:step));
  }
  function move(id:string,delta:number){
    setSteps(old=>{
      const values=[...old],i=values.findIndex(step=>step.id===id),n=i+delta;
      if(i<0||n<0||n>=values.length)return old;
      [values[i],values[n]]=[values[n]!,values[i]!];
      return values;
    });
  }
  async function save(publish:boolean){
    if(!selected.length){toast.error(w[12]);return;}
    setBusy(true);
    try{
      await saveLessonDraft({data:{catalogId,sequential,steps:selected}});
      if(publish)await publishLessonDraft({data:{catalogId}});
      await qc.invalidateQueries({queryKey:["lesson-teacher",catalogId]});
      toast.success(publish?w[10]:w[9]);
    }catch(e){toast.error(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section aria-label={w[0]} className="space-y-3 rounded-md border border-border p-4">
    <div>
      <h2 className="font-semibold">{w[0]}</h2>
      <p className="text-sm text-muted-foreground">{w[1]}</p>
      {query.data?.latest&&<p className="text-xs text-muted-foreground">{w[11]}: {query.data.latest.revision}</p>}
    </div>
    {query.error&&<p role="alert" className="text-sm text-destructive">{String(query.error)}</p>}
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={sequential} onCheckedChange={v=>setSequential(v===true)}/>
      {w[2]}
    </label>
    <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
      {items.filter(item=>item.status==="active"&&item.available).map(item=><label
        key={item.id} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm">
        <Checkbox checked={steps.some(step=>step.id===item.id)}
          onCheckedChange={v=>toggle(item,v===true)}/>
        <span className="truncate">{item.title}</span>
      </label>)}
    </div>
    {selected.map((rule,index)=>{
      const item=items.find(x=>x.id===rule.id)!;
      const graded=["question","vocabulary"].includes(item.entity_type);
      return <div key={rule.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_auto_160px_100px] sm:items-center">
        <div className="min-w-0 truncate text-sm">{index+1}. {item.title}</div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={index===0} onClick={()=>move(rule.id,-1)} aria-label="Move up">↑</Button>
          <Button size="sm" variant="outline" disabled={index===selected.length-1} onClick={()=>move(rule.id,1)} aria-label="Move down">↓</Button>
          <label className="flex items-center gap-1 text-xs">
            <Checkbox checked={rule.required} onCheckedChange={v=>change(rule.id,{required:v===true})}/>{w[3]}
          </label>
        </div>
        <select aria-label={w[4]} value={rule.mode}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={e=>change(rule.id,{
            mode:e.target.value as LessonStepRule["mode"],
            minScorePercent:e.target.value==="pass"?(rule.minScorePercent??80):undefined,
          })}>
          <option value="view">{w[5]}</option>
          {graded&&<option value="attempt">{w[6]}</option>}
          {graded&&<option value="pass">{w[7]}</option>}
        </select>
        {rule.mode==="pass"?<input aria-label={w[8]} type="number" min={0} max={100}
          value={rule.minScorePercent??80} onChange={e=>change(rule.id,{minScorePercent:Number(e.target.value)})}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"/>:<span/>}
      </div>;
    })}
    {!items.length&&<p className="text-sm text-muted-foreground">{w[12]}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy||!selected.length} onClick={()=>void save(false)}>{w[9]}</Button>
      <Button disabled={busy||!selected.length||query.data?.catalog.status!=="active"}
        onClick={()=>void save(true)}>{w[10]}</Button>
    </div>
  </section>;
}
