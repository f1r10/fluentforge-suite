import {createServerFn} from "@tanstack/react-start";
import {getRequest} from "@tanstack/react-start/server";
import {z} from "zod";
import {timingSafeEqual} from "node:crypto";
import {requirePlatformAdmin} from "./platform-admin-middleware";

const username=z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/);
const password=z.string().min(12).max(200);
function ip(){return getRequest()?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??null;}
function equal(a:string,b:string){
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}

export const getPlatformAdminSetupState=createServerFn({method:"GET"}).handler(async()=>{
  const {privilegedAdminClient}=await import("./security.server");
  const admin=await privilegedAdminClient();
  const {count,error}=await admin.from("platform_admin_users")
    .select("auth_user_id",{count:"exact",head:true});
  if(error)throw new Error(error.message);
  return {needsSetup:(count??0)===0, setupEnabled:!!process.env["PLATFORM_ADMIN_SETUP_TOKEN"]};
});

export const setupPlatformAdmin=createServerFn({method:"POST"})
 .inputValidator((x)=>z.object({username,password,setupToken:z.string().min(16).max(500)}).parse(x))
 .handler(async ({data})=>{
   const {privilegedAdminClient,audit,checkRateLimit,recordAttempt,randomToken}=await import("./security.server");
   const admin=await privilegedAdminClient();
   const clientIp=ip();
   await checkRateLimit(admin,"platform_setup","initial",clientIp);
   const expected=process.env["PLATFORM_ADMIN_SETUP_TOKEN"];
   if(!expected||!equal(expected,data.setupToken)){
      await recordAttempt(admin,"platform_setup","initial",clientIp,false);
      throw new Error("Setup token is invalid.");
   }
   const {count}=await admin.from("platform_admin_users").select("auth_user_id",{count:"exact",head:true});
   if(count)throw new Error("Platform admin already configured.");
   const {data:user,error}=await admin.auth.admin.createUser({
     email:`platform-${randomToken(18).toLowerCase()}@accounts.local`,
     password:data.password,email_confirm:true,
   });
   if(error||!user.user)throw new Error("Could not create admin identity.");
   try{
     const {error:e}=await admin.from("platform_admin_users").insert({
       auth_user_id:user.user.id,username:data.username.toLowerCase(),
     });
     if(e)throw new Error(e.message);
   }catch(error){
     await admin.auth.admin.deleteUser(user.user.id);
     throw error;
   }
   await recordAttempt(admin,"platform_setup","initial",clientIp,true);
   await audit(admin,{actor_type:"system",action:"platform_admin_created",summary:"Initial separate platform administrator established"});
   return {ok:true};
 });

export const platformAdminLogin=createServerFn({method:"POST"})
 .inputValidator((x)=>z.object({username,password:z.string().min(1).max(200)}).parse(x))
 .handler(async ({data})=>{
   const {privilegedAdminClient,publicClient,checkRateLimit,recordAttempt,audit}=await import("./security.server");
   const admin=await privilegedAdminClient();
   const clientIp=ip(),name=data.username.toLowerCase();
   await checkRateLimit(admin,"platform_admin",name,clientIp);
   const {data:row}=await admin.from("platform_admin_users")
     .select("auth_user_id,disabled_at").eq("username",name).maybeSingle();
   const fail=async()=>{
     await recordAttempt(admin,"platform_admin",name,clientIp,false);
     throw new Error("Wrong username or password.");
   };
   if(!row||row.disabled_at)return fail();
   const {data:teacher}=await admin.from("admin_users").select("id")
     .eq("auth_user_id",row.auth_user_id).maybeSingle();
   if(teacher)return fail();
   const {data:user}=await admin.auth.admin.getUserById(row.auth_user_id);
   if(!user.user?.email)return fail();
   const {data:session,error}=await publicClient().auth.signInWithPassword({
     email:user.user.email,password:data.password,
   });
   if(error||!session.session)return fail();
   await recordAttempt(admin,"platform_admin",name,clientIp,true);
   await audit(admin,{actor_type:"platform_admin",actor_id:row.auth_user_id,
     action:"platform_admin_login",summary:"Platform admin signed in",ip:clientIp});
   return {access_token:session.session.access_token,refresh_token:session.session.refresh_token};
 });

export const getPlatformAdminProfile=createServerFn({method:"GET"})
 .middleware([requirePlatformAdmin])
 .handler(async ({context})=>{
  const {privilegedAdminClient}=await import("./security.server");
  const admin=await privilegedAdminClient();
  const {data}=await admin.from("platform_admin_users").select("username")
    .eq("auth_user_id",context.userId).single();
  return {username:data?.username??""};
 });

export const listPlatformTeachers=createServerFn({method:"GET"})
 .middleware([requirePlatformAdmin])
 .handler(async ()=>{
   const {privilegedAdminClient}=await import("./security.server");
   const admin=await privilegedAdminClient();
   const [teachers,memberships]=await Promise.all([
     admin.from("admin_users").select("id,auth_user_id,username,display_name,created_at")
       .order("created_at"),
     admin.from("tenant_teacher_memberships").select("teacher_auth_user_id,workspace_id"),
   ]);
   if(teachers.error)throw new Error(teachers.error.message);
   if(memberships.error)throw new Error(memberships.error.message);
   const map=new Map((memberships.data??[]).map(x=>[x.teacher_auth_user_id,x.workspace_id]));
   const workspaceIds=[...new Set([...map.values()])];
   if(!workspaceIds.length)return [];
   const [spaces,groups,students,members]=await Promise.all([
     admin.from("tenant_workspaces").select("id,status").in("id",workspaceIds),
     admin.from("groups").select("id,name,workspace_id").in("workspace_id",workspaceIds)
       .is("deleted_at",null),
     admin.from("students").select("id,first_name,last_name,username,status,workspace_id")
       .in("workspace_id",workspaceIds).is("deleted_at",null),
     admin.from("group_memberships").select("group_id,student_id,workspace_id")
       .in("workspace_id",workspaceIds),
   ]);
   for(const result of [spaces,groups,students,members])
     if(result.error)throw new Error(result.error.message);
   const states=new Map((spaces.data??[]).map(x=>[x.id,x.status]));
   return (teachers.data??[]).map(teacher=>{
     const workspaceId=map.get(teacher.auth_user_id)??null;
     const g=(groups.data??[]).filter(x=>x.workspace_id===workspaceId);
     const s=(students.data??[]).filter(x=>x.workspace_id===workspaceId);
     const memberMap=new Map(g.map(x=>[x.id,[] as string[]]));
     for(const m of members.data??[]){
       if(memberMap.has(m.group_id))memberMap.get(m.group_id)!.push(m.student_id);
     }
     return {
       authUserId:teacher.auth_user_id,
       username:teacher.username,displayName:teacher.display_name,
       createdAt:teacher.created_at,
       workspaceId,
       status:workspaceId?states.get(workspaceId)??"unknown":"unassigned",
       groups:g.map(x=>({id:x.id,name:x.name,studentIds:memberMap.get(x.id)??[]})),
       students:s.map(x=>({id:x.id,username:x.username,
         name:`${x.first_name} ${x.last_name}`,status:x.status})),
     };
   });
 });

export const resetPlatformTeacherPassword=createServerFn({method:"POST"})
 .middleware([requirePlatformAdmin])
 .inputValidator((x)=>z.object({teacherAuthUserId:z.string().uuid(),newPassword:password}).parse(x))
 .handler(async ({context,data})=>{
   const {privilegedAdminClient,audit}=await import("./security.server");
   const admin=await privilegedAdminClient();
   const {data:teacher}=await admin.from("admin_users").select("id")
     .eq("auth_user_id",data.teacherAuthUserId).maybeSingle();
   if(!teacher)throw new Error("Teacher not found.");
   const {error}=await admin.auth.admin.updateUserById(data.teacherAuthUserId,{
     password:data.newPassword,
   });
   if(error)throw new Error(error.message);
   // A changed password must also invalidate issued runtime refresh sessions:
   // changing the password alone does not revoke already-issued tokens.
   if(process.env["RUNTIME_BACKEND"]==="postgres"){
     const {error:revokeError}=await admin.from("runtime_refresh_tokens")
       .update({revoked_at:new Date().toISOString()})
       .eq("user_id",data.teacherAuthUserId)
       .is("revoked_at",null);
     if(revokeError)throw new Error("Password updated but session revocation failed.");
   }
   await audit(admin,{actor_type:"platform_admin",actor_id:context.userId,
     action:"platform_teacher_password_reset",entity_type:"teacher",
     entity_id:teacher.id,summary:"Teacher password reset; password not logged"});
   return {ok:true};
 });

export const archivePlatformTeacher=createServerFn({method:"POST"})
 .middleware([requirePlatformAdmin])
 .inputValidator((x)=>z.object({teacherAuthUserId:z.string().uuid()}).parse(x))
 .handler(async ({context,data})=>{
   const {privilegedAdminClient,audit}=await import("./security.server");
   const admin=await privilegedAdminClient();
   const {data:membership}=await admin.from("tenant_teacher_memberships")
     .select("workspace_id").eq("teacher_auth_user_id",data.teacherAuthUserId).maybeSingle();
   if(!membership)throw new Error("Teacher workspace not found.");
   const {error}=await admin.from("tenant_workspaces")
     .update({status:"archived"}).eq("id",membership.workspace_id);
   if(error)throw new Error(error.message);
   // Do not delete teacher accounts or cascade to students, questions or grades.
   await audit(admin,{actor_type:"platform_admin",actor_id:context.userId,
     action:"platform_teacher_archived",summary:"Teacher workspace archived, content preserved"});
   return {ok:true};
 });

export const createPlatformTeacher=createServerFn({method:"POST"})
 .middleware([requirePlatformAdmin])
 .inputValidator((x)=>z.object({username,password,displayName:z.string().trim().min(1).max(100)}).parse(x))
 .handler(async ()=>{
   // This must remain disabled until all tenant policies, service-role query
   // scopes, media/storage paths, RPCs and regression gates are proven.
   throw new Error("New teacher creation is disabled until tenant isolation certification passes.");
 });
