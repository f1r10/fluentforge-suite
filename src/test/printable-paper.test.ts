import { describe, it, expect } from "vitest";
import { examPaperBlocks, renderPrintablePaper } from "@/lib/printable-paper";
describe("published exam print fidelity",()=>{
 it("renders stored immutable answer and all section content",()=>{
  const snapshot={sections:[{title:"Nouns",fixed_items:[{snapshot:{kind:"question",snapshot:{
   prompt:"Choose an animal <cat>",payload:{options:["cat","book"]},
   answer_key:{answer:"cat"}, explanation:"Animal"}}}],pools:[]}]};
  const html=renderPrintablePaper({title:"Exam A",blocks:examPaperBlocks(snapshot),includeAnswers:false});
  expect(html).toContain("&lt;cat&gt;");expect(html).not.toContain("Animal");
  expect(renderPrintablePaper({title:"Exam A",blocks:examPaperBlocks(snapshot),includeAnswers:true})).toContain("Animal");
 });
 it("deterministically locks pool version",()=>{
  const snapshot={sections:[{title:"S",fixed_items:[],pools:[{count:1,candidates:[
   {kind:"question",question_id:"a",snapshot:{prompt:"one"}},
   {kind:"question",question_id:"b",snapshot:{prompt:"two"}}]}]}]};
  expect(examPaperBlocks(snapshot,"A")).toEqual(examPaperBlocks(snapshot,"A"));
 });
 it("refuses to silently omit unsupported content or images",()=>{
  expect(()=>examPaperBlocks({sections:[{fixed_items:[{snapshot:{kind:"bad"}}]}]})).toThrow();
  expect(()=>renderPrintablePaper({title:"X",blocks:[{kind:"question",prompt:"image",media_id:"x"}],includeAnswers:false})).toThrow();
 });
});
