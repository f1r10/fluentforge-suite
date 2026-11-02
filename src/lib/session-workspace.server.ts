/** Authentication-context tenant gate. This is additional protection; all
 * content data access still requires tenant-scoped RLS and service queries.
 */
export async function assertActiveWorkspaceSession(userId:string,sessionId?:string){
 const {privilegedAdminClient}=await import("./security.server");
 const admin=await privilegedAdminClient();
 const {data:teacher,error:teacherError}=await admin
   .from("tenant_teacher_memberships")
   .select("workspace_id").eq("teacher_auth_user_id",userId).maybeSingle();
 if(teacherError)throw new Error("Session authorization unavailable.");
 let workspaceId=teacher?.workspace_id??null;
 if(teacher&&process.env["RUNTIME_BACKEND"]==="postgres"){
   if(!sessionId)throw new Error("Teacher session is invalid.");
   const {data:session,error}=await admin.from("runtime_refresh_tokens")
     .select("id").eq("user_id",userId).eq("session_id",sessionId)
     .is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
   if(error||!session)throw new Error("Teacher session has expired or was revoked.");
 }
 if(!workspaceId){
   const {data:student,error}=await admin.from("students")
     .select("workspace_id").eq("auth_user_id",userId)
     .is("deleted_at",null).maybeSingle();
   if(error)throw new Error("Session authorization unavailable.");
   workspaceId=student?.workspace_id??null;
 }
 if(workspaceId){
   const {data:workspace,error}=await admin.from("tenant_workspaces")
     .select("status").eq("id",workspaceId).maybeSingle();
   if(error||!workspace||workspace.status!=="active")
     throw new Error("This teacher workspace is no longer active.");
 }
}
