import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText, setTokens } from "@/components/app/common";
import { platformAdminLogin } from "@/lib/platform-admin.functions";

export const Route = createFileRoute("/platform-admin-login")({
  component: PlatformAdminLogin,
  head:()=>({meta:[{title:"FluentForge — Platform administrator"},
    {name:"robots",content:"noindex,nofollow"}]}),
});
function PlatformAdminLogin(){
 const navigate=useNavigate();
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){
   e.preventDefault();setBusy(true);setError("");
   try{
     await setTokens(await platformAdminLogin({data:{username,password}}));
     navigate({to:"/admin"});
   }catch(err){setError(err instanceof Error?err.message:String(err))}
   finally{setBusy(false)}
 }
 return <AuthLayout title="Platform administrator">
   <form onSubmit={submit} className="space-y-4">
     <div className="space-y-2"><Label htmlFor="pa-user">İstifadəçi adı</Label>
       <Input id="pa-user" value={username} onChange={e=>setUsername(e.target.value)}
         autoCapitalize="off" autoComplete="username" required /></div>
     <div className="space-y-2"><Label htmlFor="pa-pass">Şifrə</Label>
       <Input id="pa-pass" value={password} type="password" autoComplete="current-password"
         onChange={e=>setPassword(e.target.value)} required /></div>
     <ErrorText>{error}</ErrorText>
     <Button type="submit" disabled={busy} className="w-full">Daxil ol</Button>
   </form>
   <Link to="/" className="mt-5 block text-sm text-muted-foreground">Tələbə girişinə qayıt</Link>
 </AuthLayout>;
}
