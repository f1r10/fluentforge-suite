import {createFileRoute,Outlet,redirect,useNavigate} from "@tanstack/react-router";
import {getPlatformAdminProfile} from "@/lib/platform-admin.functions";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";

export const Route=createFileRoute("/_authenticated/admin")({
 beforeLoad:async()=>{
  try{return {me:await getPlatformAdminProfile()}}
  catch{throw redirect({to:"/platform-admin-login"})}
 },
 head:()=>({meta:[{title:"FluentForge — Admin"},{name:"robots",content:"noindex,nofollow"}]}),
 component:AdminLayout,
});
function AdminLayout(){
 const navigate=useNavigate();
 return <div className="min-h-screen bg-background">
   <header className="flex items-center justify-between border-b p-4">
     <div className="font-semibold">FluentForge · Super Admin</div>
     <Button variant="outline" onClick={async()=>{
       await supabase.auth.signOut();navigate({to:"/platform-admin-login",replace:true});
     }}>Çıxış</Button>
   </header>
   <main className="mx-auto max-w-6xl p-5"><Outlet/></main>
 </div>;
}
