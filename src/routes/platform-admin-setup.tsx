import {createFileRoute, Link,useNavigate} from "@tanstack/react-router";
import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {AuthLayout,ErrorText} from "@/components/app/common";
import {getPlatformAdminSetupState,setupPlatformAdmin} from "@/lib/platform-admin.functions";

export const Route=createFileRoute("/platform-admin-setup")({
 component:AdminSetup,head:()=>({meta:[{name:"robots",content:"noindex,nofollow"}]}),
});
function AdminSetup(){
 const navigate=useNavigate();
 const {data:state}=useQuery({queryKey:["platform-admin-setup"],queryFn:()=>getPlatformAdminSetupState()});
 const [username,setUsername]=useState("");const [password,setPassword]=useState("");
 const [token,setToken]=useState("");const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){
 e.preventDefault();setBusy(true);setError("");
 try{await setupPlatformAdmin({data:{username,password,setupToken:token}});
     navigate({to:"/platform-admin-login"});}
 catch(err){setError(err instanceof Error?err.message:String(err))}
 finally{setBusy(false)}
 }
 return <AuthLayout title="İlk Super Admin hesabı">
 {state&&!state.needsSetup&&<p>Super Admin hesabı artıq yaradılıb.</p>}
 {state&&state.needsSetup&&!state.setupEnabled&&<p>Administrator quraşdırması bu serverdə aktiv deyil.</p>}
 {state?.needsSetup&&state.setupEnabled&&<form onSubmit={submit} className="space-y-4">
   <p className="text-sm text-muted-foreground">Server administratorunun təqdim etdiyi məxfi quraşdırma kodunu daxil edin.</p>
   <div><Label htmlFor="au">İstifadəçi adı</Label><Input id="au" required value={username}
     onChange={e=>setUsername(e.target.value)} /></div>
   <div><Label htmlFor="ap">Şifrə (ən az 12 simvol)</Label><Input id="ap" required type="password"
     minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></div>
   <div><Label htmlFor="at">Quraşdırma kodu</Label><Input id="at" required type="password"
     autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></div>
   <ErrorText>{error}</ErrorText>
   <Button type="submit" disabled={busy}>Admin hesabı yarat</Button>
 </form>}
 <Link to="/platform-admin-login" className="mt-6 block text-sm">Admin girişinə qayıt</Link>
 </AuthLayout>;
}
