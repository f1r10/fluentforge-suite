/** Render teacher-selected catalog/exam content into a paper. */
export type PaperBlock =
  | { kind: "section"; title: string }
  | { kind: "text"; title: string; body: string }
  | { kind: "question"; prompt: string; instructions?: string | null; payload?: unknown; answer_key?: unknown; explanation?: string | null; media_id?: string | null }
  | { kind: "word"; word: string; pos?: string | null; translation?: string }
  | { kind: "audio"; title: string; transcript: string };

export function paperEscape(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function object(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
}
function text(x: unknown) {
  return x == null ? "" : typeof x === "string" ? x : JSON.stringify(x);
}
function options(x: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(x)) return [];
  return x.map((option, index) => {
    if (typeof option === "string") return { id: String.fromCharCode(65+index), text: option };
    const row = object(option);
    return { id: text(row.id || row.key || String.fromCharCode(65+index)),
      text: text(row.text ?? row.label ?? row.value) };
  });
}
function answerText(answer: unknown, opts: Array<{id:string;text:string}>) {
  const row=object(answer);
  if(Array.isArray(row.correct)){
    const map=new Map(opts.map(x=>[x.id.toLocaleLowerCase(),x.text]));
    return row.correct.map((k)=>{
      const id=text(k);
      return map.has(id.toLocaleLowerCase()) ?
        `${id}: ${map.get(id.toLocaleLowerCase())}` : id;
    }).join("; ");
  }
  if(Array.isArray(row.blanks))return row.blanks.map((v,i)=>
    `${i+1}: ${Array.isArray(v)?v.map(text).join(" / "):text(v)}`).join("; ");
  if(Array.isArray(row.pairs))return row.pairs.map((v)=>{
    const pair=object(v);return `${text(pair.left)} → ${text(pair.right)}`;
  }).join("; ");
  if(Array.isArray(row.order))return row.order.map(text).join(" → ");
  for(const k of ["model_answer","answer","text"])
    if(typeof row[k]==="string")return row[k] as string;
  return text(answer);
}

export function renderPrintablePaper(input: {
  title: string; blocks: PaperBlock[]; includeAnswers: boolean;
  showTranscript?: boolean; variant?: string;
}) {
  if (!input.blocks.length) throw new Error("Paper has no content.");
  let questionCount = 0;
  const body = input.blocks.map((block) => {
    if (block.kind === "section") return `<h2>${paperEscape(block.title)}</h2>`;
    if (block.kind === "text") return `<section><h3>${paperEscape(block.title)}</h3><p class="body">${paperEscape(block.body)}</p></section>`;
    if (block.kind === "audio") return `<section><h3>${paperEscape(block.title)} (Listening)</h3>
      <p class="muted">The recording is provided separately.</p>
      ${input.showTranscript ? `<p class="body">${paperEscape(block.transcript)}</p>` : ""}</section>`;
    if (block.kind === "word") return `<article><b>${paperEscape(block.word)}</b> ${paperEscape(block.pos)}
      ${input.includeAnswers ? `— ${paperEscape(block.translation)}` : ""}</article>`;
    questionCount++;
    if (block.media_id) throw new Error("Question includes image/media. Attach its printable image before exporting; it cannot be silently omitted.");
    const opts = options(object(block.payload).options);
    const items = opts.length ? `<ol type="A">${opts.map(x=>`<li>${paperEscape(x.text)}</li>`).join("")}</ol>`:"";
    return `<article><b>${questionCount}. </b>${paperEscape(block.prompt)}
      ${block.instructions ? `<p class="muted">${paperEscape(block.instructions)}</p>` : ""}
      ${items}
      ${input.includeAnswers ? `<p class="answer"><b>Answer:</b> ${paperEscape(answerText(block.answer_key,opts))}</p>` : ""}
      ${input.includeAnswers && block.explanation ? `<p class="answer">${paperEscape(block.explanation)}</p>` : ""}</article>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${paperEscape(input.title)}</title>
  <style>@page{size:A4;margin:17mm}body{font-family:"DejaVu Sans",Arial,sans-serif;color:#161616;font-size:11pt;line-height:1.5}
  h1{font-size:18pt;border-bottom:2px solid #333;padding-bottom:5mm}h2{font-size:14pt;margin-top:8mm}
  h3{font-size:12pt}section,article{margin:5mm 0;break-inside:avoid}
  .body{white-space:pre-wrap}.muted{color:#555;font-size:9pt}ol{margin:2mm 0 3mm 9mm}
  li{padding:1mm}.answer{border-left:2px solid #777;padding:2mm 4mm;background:#f1f1f1}
  </style></head><body><h1>${paperEscape(input.title)}</h1>
  ${input.variant ? `<p class="muted">Variant: ${paperEscape(input.variant)}</p>` : ""}
  ${body}</body></html>`;
}

/** Snapshot format is stored at exam publish time. Do not read live question
 * bank when reproducing a published paper. */
export function examPaperBlocks(published: unknown, variant = "A"): PaperBlock[] {
  const snap = object(published);
  const sections = Array.isArray(snap.sections) ? snap.sections : [];
  const result: PaperBlock[] = [];
  for (const sectionValue of sections) {
    const section = object(sectionValue);
    result.push({kind:"section", title:text(section.title || "Section")});
    const fixed = Array.isArray(section.fixed_items) ? section.fixed_items : [];
    for (const wrapper of fixed) {
      addSnapshot(object(wrapper).snapshot, result);
    }
    const pools = Array.isArray(section.pools) ? section.pools : [];
    for (const poolValue of pools) {
      const pool = object(poolValue);
      const candidates = Array.isArray(pool.candidates) ? pool.candidates : [];
      const count = Number(pool.count);
      if (!Number.isInteger(count) || count < 0 || count > candidates.length) {
        throw new Error("Published exam pool is invalid.");
      }
      // Stable variant order. No random sources are used in document exports.
      const sorted = candidates.map((c) => ({
        value:c, key: stableHash(variant+"|"+text(object(c).question_id))
      })).sort((a,b)=>a.key-b.key);
      for (const item of sorted.slice(0,count)) addSnapshot(item.value,result);
    }
  }
  if (!result.some(x=>x.kind!=="section")) throw new Error("Published exam is empty.");
  return result;
}
function stableHash(x: string) { let h=2166136261; for (let i=0;i<x.length;i++) {h=Math.imul(h^x.charCodeAt(i),16777619)} return h>>>0; }
function addSnapshot(value: unknown, out: PaperBlock[]) {
  const snap=object(value), kind=text(snap.kind);
  if(kind==="question"){
    const q=object(snap.snapshot);
    out.push({kind:"question",prompt:text(q.prompt), instructions:text(q.instructions),
      payload:q.payload,answer_key:q.answer_key,explanation:text(q.explanation),
      media_id:text(object(snap.metadata).media_id)||null});
    return;
  }
  if(kind==="catalog"){
    const cat=object(snap.catalog);
    out.push({kind:"section",title:text(cat.name)});
    for(const item of Array.isArray(snap.items)?snap.items:[]) addSnapshot(item,out);
    if(Array.isArray(snap.skipped)&&snap.skipped.length) {
      throw new Error("Published catalog contains non-printable entries. Print must not omit content.");
    }
    return;
  }
  if(kind==="reading"){
    const reading=object(snap.reading);
    out.push({kind:"text",title:text(reading.title),body:text(reading.body)});
    for (const set of Array.isArray(snap.question_sets)?snap.question_sets:[])
      for(const q of Array.isArray(object(set).questions)?object(set).questions as unknown[]:[])addSnapshot(q,out);
    return;
  }
  if(kind==="listening"){
    const listening=object(snap.listening);
    out.push({kind:"audio",title:text(listening.title),transcript:text(listening.transcript)});
    for (const set of Array.isArray(snap.question_sets)?snap.question_sets:[])
      for(const q of Array.isArray(object(set).questions)?object(set).questions as unknown[]:[])addSnapshot(q,out);
    return;
  }
  throw new Error("Unrecognized published exam snapshot content cannot be printed safely.");
}
