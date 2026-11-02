import {createFileRoute} from "@tanstack/react-router";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {listPlatformTeachers,resetPlatformTeacherPassword,archivePlatformTeacher}
 from "@/lib/platform-admin.functions";

export const Route=createFileRoute("/_authenticated/admin/")({component:AdminDashboard});
type Teacher=Awaited<ReturnType<typeof listPlatformTeachers>>[number];
function AdminDashboard(){
 const queryClient=useQueryClient();
 const {data:teachers=[],isFetching}=useQuery({
   queryKey:["platform-teachers"],queryFn:()=>listPlatformTeachers(),
 });
 const [selected,setSelected]=useState<Teacher|null>(null);
 const [reset,setReset]=useState<Teacher|null>(null);
 const [password,setPassword]=useState("");
 const [busy,setBusy]=useState(false);
 async function archive(teacher:Teacher){
   if(!window.confirm(`${teacher.username} müəlliminin hesabı arxivləşdirilsin? Məlumatlar silinməyəcək.`))return;
   try{
     await archivePlatformTeacher({data:{teacherAuthUserId:teacher.authUserId}});
     await queryClient.invalidateQueries({queryKey:["platform-teachers"]});
     toast.success("Müəllim arxivləşdirildi.");
   }catch(e){toast.error(e instanceof Error?e.message:String(e))}
 }
 async function savePassword(){
   if(!reset)return;setBusy(true);
   try{
     await resetPlatformTeacherPassword({data:{
       teacherAuthUserId:reset.authUserId,newPassword:password,
     }});
     toast.success("Şifrə yeniləndi.");setReset(null);setPassword("");
   }catch(e){toast.error(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
 }
 return <div className="space-y-5">
   <div><h1 className="text-2xl font-bold">Müəllimlər</h1>
     <p className="text-sm text-muted-foreground">
       Yalnız müəllim, qrup və tələbə məlumatları göstərilir. Dərs, qiymət və cavablar adminə açılmır.
     </p></div>
   <div className="rounded-md border p-3 text-sm text-muted-foreground">
     Yeni müəllim yaratmaq məlumat izolyasiyası təhlükəsizlik sınaqları tamamlanana qədər deaktivdir.
   </div>
   {isFetching&&<p>Yüklənir…</p>}
   <div className="grid gap-3">
   {teachers.map(t=><section key={t.authUserId} className="rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">{t.displayName??t.username}</h2>
          <p className="text-xs text-muted-foreground">
            @{t.username} · {t.status} · {t.groups.length} qrup · {t.students.length} tələbə
          </p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={()=>setSelected(t)}>Qruplar və tələbələr</Button>
          <Button size="sm" variant="outline" onClick={()=>{setReset(t);setPassword("")}}>Şifrəni dəyiş</Button>
          <Button size="sm" variant="destructive" disabled={t.status==="archived"}
            onClick={()=>archive(t)}>Arxivləşdir</Button>
        </div>
      </div>
    </section>)}
   </div>
   <Dialog open={!!selected} onOpenChange={(open)=>{if(!open)setSelected(null)}}>
     <DialogContent className="max-h-[80vh] overflow-y-auto">
       <DialogHeader><DialogTitle>{selected?.username} · qruplar və tələbələr</DialogTitle></DialogHeader>
       <h3 className="font-semibold">Qruplar</h3>
       {selected?.groups.map(g=><p key={g.id} className="text-sm">
          {g.name} — {g.studentIds.length} tələbə
        </p>)}
       <h3 className="font-semibold">Tələbələr</h3>
       {selected?.students.map(s=><p className="text-sm" key={s.id}>
          {s.name} · @{s.username} · {s.status}
        </p>)}
     </DialogContent>
   </Dialog>
   <Dialog open={!!reset} onOpenChange={(open)=>{if(!open)setReset(null)}}>
     <DialogContent><DialogHeader><DialogTitle>
       {reset?.username} · yeni şifrə
     </DialogTitle></DialogHeader>
     <Label htmlFor="admin-reset-password">Yeni şifrə (ən az 12 simvol)</Label>
     <Input id="admin-reset-password" type="password" value={password}
       autoComplete="new-password" minLength={12}
       onChange={e=>setPassword(e.target.value)}/>
     <Button disabled={busy||password.length<12} onClick={savePassword}>Yadda saxla</Button>
     </DialogContent>
   </Dialog>
 </div>;
}
