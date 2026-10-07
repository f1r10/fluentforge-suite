import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { saveQuestion, type QuestionInput } from "@/lib/questions.functions";
import { LEVELS, QUESTION_TYPES, TYPE_BY_ID } from "@/lib/question-types";
import { topicOptions, type TopicRow } from "@/components/app/topics";
import { QuestionLabellingEditor, type SpatialLabel } from "@/components/app/QuestionLabellingEditor";
import { QuestionMediaAttachment } from "@/components/app/QuestionMediaAttachment";
import { useI18n } from "@/lib/i18n";
import { useContentLanguages } from "@/lib/content-languages";

type Opt = { id: string; text: string };
type Pair = { left: string; right: string };
type Form = {
  question_type: string; prompt: string; instructions: string; explanation: string; teacher_notes: string;
  level: string; learning_language: string; status: "active" | "draft" | "archived";
  difficulty: number | null; reusable_independently: boolean;
  grading_mode: "automatic" | "manual" | "ai_assisted"; points: number; partial: boolean; negative: number;
  case_sensitive: boolean; trim_whitespace: boolean; ignore_punctuation: boolean; ignore_diacritics: boolean;
  options: Opt[]; correct: string[]; blanks: string[]; pairs: Pair[]; order: string[]; model_answer: string;
  media_id: string; media_label: string; labels: SpatialLabel[];
  topicIds: string[]; tags: string;
};

const uid = () => Math.random().toString(36).slice(2, 9);
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function empty(type = "single_choice"): Form {
  return {
    question_type: type, prompt: "", instructions: "", explanation: "", teacher_notes: "", level: "", learning_language: "", status: "active",
    difficulty: null, reusable_independently: false,
    grading_mode: TYPE_BY_ID[type]?.defaultGrading ?? "automatic", points: 1, partial: false, negative: 0,
    case_sensitive: false, trim_whitespace: true, ignore_punctuation: false, ignore_diacritics: false,
    options: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }], correct: [], blanks: [""],
    pairs: [{ left: "", right: "" }, { left: "", right: "" }], order: ["", "", ""], model_answer: "",
    media_id: "", media_label: "", labels: [], topicIds: [], tags: "",
  };
}

export function fromQuestion(q: QuestionInput & { topicIds?: string[]; tags?: string[] }): Form {
  const f = empty(q.question_type);
  const p = (q.payload ?? {}) as Record<string, unknown>;
  const k = (q.answer_key ?? {}) as Record<string, unknown>;
  const s = (q.scoring ?? {}) as Record<string, unknown>;
  const n = (q.normalization ?? {}) as Record<string, boolean>;
  return {
    ...f, prompt: q.prompt ?? "", instructions: q.instructions ?? "", explanation: q.explanation ?? "", teacher_notes: q.teacher_notes ?? "",
    level: q.level ?? "", learning_language: q.learning_language ?? "", status: q.status ?? "active",
    difficulty: q.difficulty ?? null,
    reusable_independently: q.reusable_independently ?? false,
    grading_mode: q.grading_mode ?? "automatic",
    points: Number(s["points"] ?? 1), partial: !!s["partial"], negative: Number(s["negative"] ?? 0),
    case_sensitive: !!n["case_sensitive"],
    trim_whitespace: n["trim_whitespace"] !== false,
    ignore_punctuation: !!n["ignore_punctuation"], ignore_diacritics: !!n["ignore_diacritics"],
    options: (p["options"] as Opt[]) ?? f.options, correct: (k["correct"] as string[]) ?? [],
    blanks: ((k["blanks"] as string[][]) ?? [[]]).map((b) => b.join(" | ")),
    pairs: (k["pairs"] as Pair[]) ?? f.pairs, order: (k["order"] as string[]) ?? f.order, model_answer: String(k["model_answer"] ?? ""),
    media_id: typeof p["media_id"] === "string" ? p["media_id"] : "",
    media_label: "",
    labels: Array.isArray(p["labels"]) ? (p["labels"] as SpatialLabel[]) : [],
    topicIds: q.topicIds ?? [], tags: (q.tags ?? []).join(", "),
  };
}

function toInput(f: Form, id?: string): QuestionInput {
  const def = TYPE_BY_ID[f.question_type]!;
  let payload: Record<string, unknown> = {};
  let answer_key: Record<string, unknown> = {};
  switch (def.editor) {
    case "choice": {
      const opts = f.options.filter((o) => o.text.trim());
      payload = { options: opts };
      answer_key = { correct: f.correct.filter((c) => opts.some((o) => o.id === c)) };
      break;
    }
    case "fixed_choice": payload = { options: def.fixedOptions }; answer_key = { correct: f.correct }; break;
    case "text":
      answer_key = {
        blanks: f.blanks.map((b) =>
          b
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      };
      payload = {
        blank_count: f.blanks.length,
      };
      break;
    case "open": answer_key = f.model_answer ? { model_answer: f.model_answer } : {}; break;
    case "matching":
      if (isSpatialLabelling(f.question_type)) {
        payload = {
          media_id: f.media_id || null,
          labels: f.labels,
          allow_reuse: false,
        };
        answer_key = {
          pairs: f.labels.map((label) => ({
            left: label.id,
            right: f.pairs.find((pair) => pair.left === label.id)?.right.trim() ?? "",
          })),
        };
      } else {
        answer_key = { pairs: f.pairs.filter((p) => p.left.trim() || p.right.trim()) };
      }
      break;
    case "ordering": answer_key = { order: f.order.filter((x) => x.trim()) }; break;
  }
  if (!isSpatialLabelling(f.question_type) && f.media_id) {
    payload = { ...payload, media_id: f.media_id };
  }
  return {
    id, question_type: f.question_type, prompt: f.prompt, instructions: f.instructions || null, payload, answer_key,
    scoring: { points: f.points, partial: f.partial, negative: f.negative || 0 },
    normalization: { case_sensitive: f.case_sensitive, trim_whitespace: f.trim_whitespace, ignore_punctuation: f.ignore_punctuation, ignore_diacritics: f.ignore_diacritics },
    explanation: f.explanation || null, teacher_notes: f.teacher_notes || null, level: f.level || null, learning_language: f.learning_language || null,
    difficulty: f.difficulty,
    reusable_independently: f.reusable_independently,
    grading_mode: def.editor === "open" ? f.grading_mode : "automatic", status: f.status,
    topicIds: f.topicIds, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean),
  };
}

function validate(f: Form): string | null {
  const def = TYPE_BY_ID[f.question_type]!;
  if (!f.prompt.trim()) return "Question text is required.";
  if ((def.editor === "choice" || def.editor === "fixed_choice") && f.correct.length === 0) return "Mark the correct answer.";
  if (def.editor === "choice" && !def.multiple && f.correct.length > 1) return "Only one correct answer is allowed.";
  if (def.editor === "text" && f.blanks.every((b) => !b.trim())) return "Enter at least one accepted answer.";
  if (isAudioTextQuestion(f.question_type) && !f.media_id) {
    return "Choose audio or video media for this question.";
  }
  if (isSpatialLabelling(f.question_type)) {
    if (!f.media_id) return "Choose an image for this labelling question.";
    if (!f.labels.length) return "Add at least one label position on the image.";
    if (f.labels.some((label) => !(f.pairs.find((pair) => pair.left === label.id)?.right ?? "").trim())) {
      return "Every label position needs a correct answer.";
    }
  }
  return null;
}

export function QuestionEditor({
  id,
  initial,
  topics,
  onSaved,
}: {
  id?: string;
  initial?: Form;
  topics: TopicRow[];
  onSaved?: (
    questionId: string,
    options: { next: boolean },
  ) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const languages = useContentLanguages();
  const [f, setF] = useState<Form>(initial ?? empty());
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const def = TYPE_BY_ID[f.question_type]!;
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });

  useEffect(() => {
    if (id || initial || f.learning_language) return;
    setF((current) =>
      current.learning_language
        ? current
        : {
            ...current,
            learning_language: languages.defaultLearningCode,
          },
    );
  }, [
    id,
    initial,
    f.learning_language,
    languages.defaultLearningCode,
  ]);

  async function save(next: boolean, force = false) {
    const err = validate(f);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const r = await saveQuestion({ data: { ...toInput(f, id), force } });
      if (r.duplicateOf) { setDup(r.duplicateOf); return; }
      setDup(null);
      qc.invalidateQueries({ queryKey: ["questions"] });
      toast.success(t("save"));

      if (onSaved && r.id) {
        await onSaved(r.id, { next });
        if (next) {
          const keep = empty(f.question_type);
          setF({
            ...keep,
            level: f.level,
            learning_language: f.learning_language,
            topicIds: f.topicIds,
            tags: f.tags,
          });
          setTimeout(() => document.getElementById("prompt")?.focus(), 0);
        }
        return;
      }

      if (next) {
        const keep = empty(f.question_type);
        setF({ ...keep, level: f.level, learning_language: f.learning_language, topicIds: f.topicIds, tags: f.tags });
        if (id) navigate({ to: "/teacher/questions/new" });
        setTimeout(() => document.getElementById("prompt")?.focus(), 0);
      } else if (!id) navigate({ to: "/teacher/questions/$id", params: { id: r.id! } });
      else qc.invalidateQueries({ queryKey: ["question", id] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => { e.preventDefault(); save(false); }}
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(true); } }}
    >
      <div className="max-w-xl">
        <div className="space-y-2">
          <Label>{t("type")}</Label>
          <select value={f.question_type} onChange={(e) => set({ question_type: e.target.value, correct: [], grading_mode: TYPE_BY_ID[e.target.value]?.defaultGrading ?? "automatic" })} className={sel}>
            {QUESTION_TYPES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </div>

      </div>

      <div className="space-y-2">
        <Label htmlFor="prompt">{t("prompt")}</Label>
        <Textarea id="prompt" rows={3} value={f.prompt} onChange={(e) => set({ prompt: e.target.value })} autoFocus />
        {def.editor === "text" && <p className="text-xs text-muted-foreground">{t("blanks_hint")}</p>}
      </div>

      {/* Answers */}
      <section className="space-y-3">
        {def.editor === "choice" && (
          <>
            <Label>{t("options")} — {t("correct")}</Label>
            {f.options.map((o, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <Checkbox
                  className="h-5 w-5"
                  checked={f.correct.includes(o.id)}
                  onCheckedChange={(c) => set({ correct: c ? (def.multiple ? [...f.correct, o.id] : [o.id]) : f.correct.filter((x) => x !== o.id) })}
                  aria-label={t("correct")}
                />
                <span className="w-5 text-sm text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                <Input value={o.text} onChange={(e) => set({ options: f.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} />
                <Button type="button" variant="ghost" size="icon" onClick={() => set({ options: f.options.filter((x) => x.id !== o.id), correct: f.correct.filter((x) => x !== o.id) })} aria-label={t("delete")}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set({ options: [...f.options, { id: uid(), text: "" }] })}><Plus className="h-4 w-4" />{t("add")}</Button>
          </>
        )}
        {def.editor === "fixed_choice" && (
          <div className="flex flex-wrap gap-2">
            {def.fixedOptions!.map((o) => (
              <Button key={o} type="button" variant={f.correct[0] === o ? "default" : "outline"} onClick={() => set({ correct: [o] })}>{o}</Button>
            ))}
          </div>
        )}
        {!isSpatialLabelling(f.question_type) && (
          <QuestionMediaAttachment
            mediaId={f.media_id}
            mediaLabel={f.media_label}
            allowedKinds={
              isAudioTextQuestion(f.question_type)
                ? ["audio", "video"]
                : ["image", "audio", "video"]
            }
            onChange={(media) =>
              set({
                media_id: media?.id ?? "",
                media_label: media?.label ?? "",
              })
            }
          />
        )}
        {def.editor === "text" && (
          <>
            <Label>{t("accepted_answers")}</Label>
            {f.blanks.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                <Input value={b} placeholder="color | colour" onChange={(e) => set({ blanks: f.blanks.map((x, j) => (j === i ? e.target.value : x)) })} />
                {f.blanks.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => set({ blanks: f.blanks.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set({ blanks: [...f.blanks, ""] })}><Plus className="h-4 w-4" />{t("add")}</Button>
            <div className="flex flex-wrap gap-4 pt-2 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={f.case_sensitive} onCheckedChange={(c) => set({ case_sensitive: !!c })} />{t("case_sensitive")}</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.trim_whitespace} onCheckedChange={(c) => set({ trim_whitespace: !!c })} />{t("trim_whitespace")}</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.ignore_punctuation} onCheckedChange={(c) => set({ ignore_punctuation: !!c })} />{t("ignore_punctuation")}</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.ignore_diacritics} onCheckedChange={(c) => set({ ignore_diacritics: !!c })} />{t("ignore_diacritics")}</label>
            </div>
          </>
        )}
        {def.editor === "open" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("grading")}</Label>
              <select value={f.grading_mode} onChange={(e) => set({ grading_mode: e.target.value as Form["grading_mode"] })} className={sel}>
                {(["manual", "ai_assisted", "automatic"] as const).map((g) => <option key={g} value={g}>{t(g)}</option>)}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2"><Label>Model answer (optional)</Label><Textarea value={f.model_answer} onChange={(e) => set({ model_answer: e.target.value })} /></div>
          </div>
        )}
        {def.editor === "matching" && isSpatialLabelling(f.question_type) && (
          <QuestionLabellingEditor
            mediaId={f.media_id}
            mediaLabel={f.media_label}
            labels={f.labels}
            pairs={f.pairs}
            onChange={(value) =>
              set({
                media_id: value.mediaId,
                media_label: value.mediaLabel,
                labels: value.labels,
                pairs: value.pairs,
              })
            }
          />
        )}
        {def.editor === "matching" && !isSpatialLabelling(f.question_type) && (
          <>
            <Label>{t("pairs")}</Label>
            {f.pairs.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={p.left} onChange={(e) => set({ pairs: f.pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })} />
                <span className="text-muted-foreground">→</span>
                <Input value={p.right} onChange={(e) => set({ pairs: f.pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })} />
                <Button type="button" variant="ghost" size="icon" onClick={() => set({ pairs: f.pairs.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set({ pairs: [...f.pairs, { left: "", right: "" }] })}><Plus className="h-4 w-4" />{t("add")}</Button>
          </>
        )}
        {def.editor === "ordering" && (
          <>
            <Label>{t("order_items")}</Label>
            {f.order.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                <Input value={x} onChange={(e) => set({ order: f.order.map((y, j) => (j === i ? e.target.value : y)) })} />
                <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => { const o = [...f.order]; [o[i - 1], o[i]] = [o[i]!, o[i - 1]!]; set({ order: o }); }}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" disabled={i === f.order.length - 1} onClick={() => { const o = [...f.order]; [o[i + 1], o[i]] = [o[i]!, o[i + 1]!]; set({ order: o }); }}><ArrowDown className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => set({ order: f.order.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set({ order: [...f.order, ""] })}><Plus className="h-4 w-4" />{t("add")}</Button>
          </>
        )}
      </section>

      <details className="rounded-md border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium">
          {t("advanced")}
        </summary>
        <div className="mt-4 space-y-5">
        <div className="space-y-2">
          <Label>{t("status")}</Label>
          <select value={f.status} onChange={(e) => set({ status: e.target.value as Form["status"] })} className={sel}>
            {(["active", "draft", "archived"] as const).map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
        </div>
      {/* Scoring & metadata */}
      <div className="grid gap-4 sm:grid-cols-5">
        <div className="space-y-2"><Label>{t("points")}</Label><Input type="number" min={0} step={0.5} value={f.points} onChange={(e) => set({ points: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>{t("negative_marking")}</Label><Input type="number" min={0} step={0.25} value={f.negative} onChange={(e) => set({ negative: Number(e.target.value) })} /></div>
        <div className="space-y-2">
          <Label>{t("difficulty")}</Label>
          <select
            value={f.difficulty ?? ""}
            onChange={(e) => set({ difficulty: e.target.value ? Number(e.target.value) : null })}
            className={sel}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label>{t("level")}</Label>
          <select value={f.level} onChange={(e) => set({ level: e.target.value })} className={sel}><option value="">—</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        </div>
        <div className="space-y-2">
          <Label>{t("language")}</Label>
          <select value={f.learning_language} onChange={(e) => set({ learning_language: e.target.value })} className={sel}>
            <option value="">—</option>
            {f.learning_language &&
              !languages.learning.some(
                (language) => language.code === f.learning_language,
              ) && (
                <option value={f.learning_language}>
                  {f.learning_language}
                </option>
              )}
            {languages.learning.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(def.multiple || def.editor === "text" || def.editor === "matching" || def.editor === "ordering") && (
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.partial} onCheckedChange={(c) => set({ partial: !!c })} />{t("partial_scoring")}</label>
      )}

      <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={f.reusable_independently}
          onCheckedChange={(checked) => set({ reusable_independently: !!checked })}
        />
        <span>
          <span className="block font-medium">{t("reusable_independently")}</span>
          <span className="block text-xs text-muted-foreground">{t("independent_reuse_hint")}</span>
        </span>
      </label>

      <div className="space-y-2">
        <Label>{t("topics")}</Label>
        <TopicPicker topics={topics} value={f.topicIds} onChange={(v) => set({ topicIds: v })} />
      </div>
      <div className="space-y-2"><Label>Tags</Label><Input value={f.tags} placeholder="grammar, exam-2026" onChange={(e) => set({ tags: e.target.value })} /></div>
      <div className="space-y-2"><Label>{t("explanation")}</Label><Textarea value={f.explanation} onChange={(e) => set({ explanation: e.target.value })} /></div>
      <div className="space-y-2"><Label>{t("teacher_notes")}</Label><Textarea value={f.teacher_notes} onChange={(e) => set({ teacher_notes: e.target.value })} /></div>
        </div>
      </details>

      {dup && (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
          <p>{t("duplicate_found")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate({ to: "/teacher/questions/$id", params: { id: dup } })}>{t("edit")}</Button>
            <Button type="button" size="sm" onClick={() => save(false, true)}>{t("save_anyway")}</Button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border bg-background py-3">
        <Button type="submit" disabled={busy}>{t("save")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => save(true)} title="Ctrl+Enter">{t("save_next")}</Button>
      </div>
    </form>
  );
}

function isSpatialLabelling(type: string) {
  return ["image_labelling", "diagram_labelling", "map_labelling"].includes(type);
}

function isAudioTextQuestion(type: string) {
  return ["dictation", "listening_transcription"].includes(type);
}

function TopicPicker({ topics, value, onChange }: { topics: TopicRow[]; value: string[]; onChange: (v: string[]) => void }) {
  const opts = topicOptions(topics);
  if (!opts.length) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
      {opts.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: o.depth * 16 }}>
          <Checkbox checked={value.includes(o.id)} onCheckedChange={(c) => onChange(c ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}
        </label>
      ))}
    </div>
  );
}
