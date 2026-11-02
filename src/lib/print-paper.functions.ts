import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { examPaperBlocks, renderPrintablePaper, type PaperBlock } from "./printable-paper";

const requestSchema = z.object({
  kind: z.enum(["catalog","exam"]),
  id: z.string().uuid(),
  format: z.enum(["pdf","docx"]),
  includeAnswers: z.boolean().default(false),
  showTranscript: z.boolean().default(false),
  variant: z.string().trim().min(1).max(32).default("A"),
});
const asText=(x:unknown)=>x==null?"":String(x);

export const createPrintablePaper = createServerFn({method:"POST"})
  .middleware([requireTeacher])
  .inputValidator((d)=>requestSchema.parse(d))
  .handler(async ({data,context})=>{
    // Permission-bearing user-scoped client, not the service-role admin:
    // authorization must remain enforced in tenant-aware RLS before V1.1.
    const db=context.supabase;
    let title="";
    let blocks:PaperBlock[]=[];
    if(data.kind==="exam"){
      const {data:exam,error}=await db.from("exams")
        .select("id,title,published_snapshot")
        .eq("id",data.id).is("deleted_at",null).maybeSingle();
      if(error)throw new Error(error.message);
      if(!exam?.published_snapshot)throw new Error("Publish the exam before printing an immutable paper.");
      title=exam.title;
      blocks=examPaperBlocks(exam.published_snapshot,data.variant);
    }else{
      const {data:catalog,error}=await db.from("catalogs").select("id,name")
        .eq("id",data.id).is("deleted_at",null).maybeSingle();
      if(error)throw new Error(error.message);
      if(!catalog)throw new Error("Catalog not found.");
      title=catalog.name;
      const {data:items,error:itemsError}=await db.from("catalog_items")
        .select("entity_type,entity_id,sort_order")
        .eq("catalog_id",catalog.id).order("sort_order").limit(500);
      if(itemsError)throw new Error(itemsError.message);
      if(!items?.length)throw new Error("Catalog is empty.");
      blocks=await catalogPaperBlocks(db,items);
    }
    const html=renderPrintablePaper({
      title,blocks,includeAnswers:data.includeAnswers,
      showTranscript:data.showTranscript,variant:data.kind==="exam"?data.variant:undefined,
    });
    const {getProcessingService}=await import("./processing.service");
    const processing=getProcessingService();
    const bytes=data.format==="pdf" ?
      await processing.renderPdfReport({html}) :
      await processing.renderDocxReport({html});
    if(data.format==="pdf"&&new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")
      throw new Error("PDF render failed.");
    if(data.format==="docx"&&new TextDecoder().decode(bytes.slice(0,2))!=="PK")
      throw new Error("Word render failed.");

    const {adminClient,audit}=await import("./security.server");
    const admin=await adminClient();
    const path=`papers/${context.userId}/${crypto.randomUUID()}.${data.format}`;
    const mime=data.format==="pdf"?"application/pdf":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const {error:uploadError}=await admin.storage.from("exports")
      .upload(path,bytes,{contentType:mime,upsert:false});
    if(uploadError)throw new Error(uploadError.message);
    const {data:signed,error:signedError}=await admin.storage.from("exports")
      .createSignedUrl(path,15*60);
    if(signedError||!signed)throw new Error(signedError?.message??"Could not sign paper");
    await audit(admin,{actor_type:"teacher",actor_id:context.userId,
      action:"paper_printed",entity_type:data.kind,entity_id:data.id,
      summary:"Generated printable paper",details:{format:data.format,
        include_answers:data.includeAnswers,variant:data.variant,block_count:blocks.length}});
    return {url:signed.signedUrl,filename:`fluentforge-${data.kind}-${data.id}.${data.format}`,blocks:blocks.length};
  });

async function catalogPaperBlocks(
  db: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  items: Array<{entity_type:string;entity_id:string}>,
):Promise<PaperBlock[]>{
  const output:PaperBlock[]=[];
  for(const item of items){
    if(item.entity_type==="question"){
      const {data:q,error}=await db.from("questions")
        .select("prompt,instructions,payload,answer_key,explanation,media_id")
        .eq("id",item.entity_id).is("deleted_at",null).maybeSingle();
      if(error||!q)throw new Error(error?.message??"Catalog question is missing.");
      output.push({kind:"question",prompt:asText(q.prompt),instructions:q.instructions,
        payload:q.payload,answer_key:q.answer_key,explanation:q.explanation,media_id:q.media_id});
    } else if(item.entity_type==="vocabulary"){
      const {data:v,error}=await db.from("vocabulary_entries")
        .select("id,word,part_of_speech")
        .eq("id",item.entity_id).is("deleted_at",null).maybeSingle();
      if(error||!v)throw new Error(error?.message??"Catalog word is missing.");
      const {data:trans,error:transError}=await db.from("vocabulary_translations")
        .select("language,value").eq("entry_id",v.id);
      if(transError)throw new Error(transError.message);
      output.push({kind:"word",word:v.word,pos:v.part_of_speech,
        translation:(trans??[]).map((x)=>`${x.language}: ${x.value}`).join(" | ")});
    } else if(item.entity_type==="reading"||item.entity_type==="listening"){
      const reading=item.entity_type==="reading";
      const table=reading?"readings":"listenings";
      const {data:r,error}=await db.from(table)
        .select(reading?"id,title,body":"id,title,transcript")
        .eq("id",item.entity_id).is("deleted_at",null).maybeSingle();
      if(error||!r)throw new Error(error?.message??"Context content is missing.");
      const row=r as Record<string,unknown>;
      output.push(reading ?
        {kind:"text",title:asText(row.title),body:asText(row.body)}:
        {kind:"audio",title:asText(row.title),transcript:asText(row.transcript)});
      const setsTable=reading?"reading_question_sets":"listening_question_sets";
      const foreign=reading?"reading_id":"listening_id";
      const {data:sets,error:setError}=await db.from(setsTable)
        .select("id").eq(foreign,item.entity_id);
      if(setError)throw new Error(setError.message);
      for(const set of sets??[]){
        const setForeign=reading?"reading_question_set_id":"listening_question_set_id";
        const {data:questions,error:questionError}=await db.from("questions")
          .select("prompt,instructions,payload,answer_key,explanation,media_id")
          .eq(setForeign,set.id).is("deleted_at",null).order("context_sort");
        if(questionError)throw new Error(questionError.message);
        for(const q of questions??[]){
          output.push({kind:"question",prompt:asText(q.prompt),
            instructions:q.instructions,payload:q.payload,
            answer_key:q.answer_key,explanation:q.explanation,media_id:q.media_id});
        }
      }
    }else throw new Error("Catalog contains an unsupported item type.");
  }
  return output;
}
