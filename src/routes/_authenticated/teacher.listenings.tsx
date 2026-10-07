import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FileAudio, FileUp, Pencil, Plus, Search, Trash2, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listTopics } from "@/lib/questions.functions";
import {
  deleteContextQuestionSet,
  deleteListeningSection,
  getListening,
  listListenings,
  saveListening,
  saveListeningQuestionSet,
  saveListeningSection,
} from "@/lib/context-content.functions";
import { LEVELS } from "@/lib/question-types";
import { trashContextContent } from "@/lib/trash.functions";
import { topicOptions } from "@/components/app/topics";
import { listMedia } from "@/lib/media.functions";
import {
  getListeningTranscriptionJob,
  startListeningTranscription,
  syncTranscriptionJob,
} from "@/lib/transcription.functions";
import { useI18n } from "@/lib/i18n";
import { useContentLanguages } from "@/lib/content-languages";
import { ContextQuestionSetManager } from "@/components/app/ContextQuestionSetManager";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

type Status = "active" | "draft" | "archived" | "all";
type Section = {
  id?: string;
  title: string;
  start_seconds: string;
  end_seconds: string;
};
type QuestionSet = {
  id?: string;
  section_id: string;
  title: string;
  instructions: string;
};
type EditorState = {
  id?: string;
  title: string;
  media_id: string;
  media_label: string;
  transcript: string;
  transcript_source: "none" | "manual" | "imported" | "auto" | "local_whisper";
  learning_language: string;
  level: string;
  status: "active" | "draft" | "archived";
  max_plays: string;
  allow_pause: boolean;
  allow_seek: boolean;
  allow_rewind: boolean;
  show_transcript: boolean;
  topicIds: string[];
  tags: string;
  sections: Section[];
  questionSets: QuestionSet[];
};

const emptyEditor = (learningLanguage = ""): EditorState => ({
  title: "",
  media_id: "",
  media_label: "",
  transcript: "",
  transcript_source: "none",
  learning_language: learningLanguage,
  level: "",
  status: "active",
  max_plays: "",
  allow_pause: true,
  allow_seek: true,
  allow_rewind: true,
  show_transcript: false,
  topicIds: [],
  tags: "",
  sections: [],
  questionSets: [],
});

export const Route = createFileRoute("/_authenticated/teacher/listenings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  component: ListeningsPage,
});

function ListeningsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const languages = useContentLanguages();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const topicOpts = topicOptions(topics);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [transcriptionJobId, setTranscriptionJobId] = useState<string | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["listenings", search, language, level, status, page],
    queryFn: () => listListenings({ data: { search, language, level, status, page } }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 40;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function openEdit(id: string) {
    try {
      const [row, transcriptionJob] = await Promise.all([
        getListening({ data: { id } }),
        getListeningTranscriptionJob({ data: { listeningId: id } }),
      ]);
      const rules = row.playback_rules ?? {};
      if (
        transcriptionJob &&
        (transcriptionJob.status === "queued" ||
          transcriptionJob.status === "processing")
      ) {
        setTranscriptionJobId(transcriptionJob.id);
        setTranscriptionProgress(transcriptionJob.progress);
      } else {
        setTranscriptionJobId(null);
        setTranscriptionProgress(transcriptionJob?.progress ?? 0);
      }
      setEditor({
        id: row.id,
        title: row.title,
        media_id: row.media_id ?? "",
        media_label: row.media?.original_filename ?? "",
        transcript: row.transcript ?? "",
        transcript_source: (row.transcript_source as EditorState["transcript_source"]) ?? "none",
        learning_language:
          row.learning_language ?? languages.defaultLearningCode,
        level: row.level ?? "",
        status: row.status,
        max_plays: rules["max_plays"] == null ? "" : String(rules["max_plays"]),
        allow_pause: rules["allow_pause"] !== false,
        allow_seek: rules["allow_seek"] !== false,
        allow_rewind: rules["allow_rewind"] !== false,
        show_transcript: rules["show_transcript"] === true,
        topicIds: row.topicIds,
        tags: row.tags.join(", "),
        sections: row.sections.map((x) => ({
          id: x.id,
          title: x.title ?? "",
          start_seconds: x.start_seconds == null ? "" : String(x.start_seconds),
          end_seconds: x.end_seconds == null ? "" : String(x.end_seconds),
        })),
        questionSets: row.questionSets.map((x) => ({
          id: x.id,
          section_id: x.section_id ?? "",
          title: x.title ?? "",
          instructions: x.instructions ?? "",
        })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusy(true);
    try {
      const saved = await saveListening({
        data: {
          id: editor.id,
          title: editor.title,
          media_id: editor.media_id || null,
          transcript: editor.transcript || null,
          transcript_source: editor.transcript_source,
          learning_language: editor.learning_language || null,
          level: editor.level || null,
          status: editor.status,
          playback_rules: {
            max_plays: editor.max_plays ? Number(editor.max_plays) : null,
            allow_pause: editor.allow_pause,
            allow_seek: editor.allow_seek,
            allow_rewind: editor.allow_rewind,
            show_transcript: editor.show_transcript,
          },
          topicIds: editor.topicIds,
          tags: editor.tags.split(",").map((x) => x.trim()).filter(Boolean),
        },
      });

      const savedSectionIds: string[] = [];
      for (let i = 0; i < editor.sections.length; i++) {
        const section = editor.sections[i]!;
        const result = await saveListeningSection({
          data: {
            id: section.id,
            listeningId: saved.id,
            title: section.title || null,
            start_seconds: section.start_seconds ? Number(section.start_seconds) : null,
            end_seconds: section.end_seconds ? Number(section.end_seconds) : null,
            sort_order: i,
          },
        });
        savedSectionIds.push(result.id);
      }

      for (let i = 0; i < editor.questionSets.length; i++) {
        const set = editor.questionSets[i]!;
        const sectionIndex = set.section_id.startsWith("new:")
          ? Number(set.section_id.slice(4))
          : -1;
        await saveListeningQuestionSet({
          data: {
            id: set.id,
            listeningId: saved.id,
            section_id: sectionIndex >= 0 ? savedSectionIds[sectionIndex] ?? null : set.section_id || null,
            title: set.title || null,
            instructions: set.instructions || null,
            sort_order: i,
          },
        });
      }

      await qc.invalidateQueries({ queryKey: ["listenings"] });
      await openEdit(saved.id);
      toast.success(t("save"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startTranscription() {
    if (!editor?.id || !editor.media_id) return;
    try {
      const result = await startListeningTranscription({
        data: { listeningId: editor.id },
      });
      setTranscriptionJobId(result.jobId);
      setTranscriptionProgress(0);
      toast.success(t("transcription_started"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!transcriptionJobId || !editor?.id) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const state = await syncTranscriptionJob({
          data: { jobId: transcriptionJobId },
        });
        if (cancelled) return;
        setTranscriptionProgress(state.progress);

        if (state.status === "completed") {
          const row = await getListening({ data: { id: editor.id! } });
          if (cancelled) return;
          setEditor((current) =>
            current
              ? {
                  ...current,
                  transcript: row.transcript ?? "",
                  transcript_source:
                    (row.transcript_source as EditorState["transcript_source"]) ??
                    "local_whisper",
                }
              : current,
          );
          setTranscriptionJobId(null);
          await qc.invalidateQueries({ queryKey: ["listenings"] });
          toast.success(t("transcription_completed"));
        } else if (state.status === "failed") {
          setTranscriptionJobId(null);
          toast.error(t("transcription_failed"));
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : String(err));
          setTranscriptionJobId(null);
        }
      }
    };

    void poll();
    const timer = window.setInterval(poll, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [transcriptionJobId, editor?.id, qc, t]);

  async function removeSection(index: number) {
    if (!editor) return;
    const section = editor.sections[index];
    if (!section) return;

    if (section.id && editor.id) {
      if (!confirm(t("delete_section_confirm"))) return;
      try {
        await deleteListeningSection({
          data: { id: section.id, listeningId: editor.id },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    const removedId = section.id ?? `new:${index}`;
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        sections: current.sections.filter((_, rowIndex) => rowIndex !== index),
        questionSets: current.questionSets.map((set) => {
          if (set.section_id === removedId) {
            return { ...set, section_id: "" };
          }

          if (!section.id && set.section_id.startsWith("new:")) {
            const previousIndex = Number(set.section_id.slice(4));
            if (Number.isInteger(previousIndex) && previousIndex > index) {
              return {
                ...set,
                section_id: `new:${previousIndex - 1}`,
              };
            }
          }

          return set;
        }),
      };
    });
  }

  async function removeQuestionSet(index: number) {
    if (!editor) return;
    const set = editor.questionSets[index];
    if (!set) return;

    if (set.id) {
      if (!confirm(t("delete_question_set_confirm"))) return;
      try {
        await deleteContextQuestionSet({
          data: { kind: "listening", id: set.id },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    setEditor((current) =>
      current
        ? {
            ...current,
            questionSets: current.questionSets.filter(
              (_, rowIndex) => rowIndex !== index,
            ),
          }
        : current,
    );
  }

  async function trashListening(id: string) {
    if (!confirm(t("move_to_trash_confirm"))) return;
    try {
      await trashContextContent({ data: { type: "listening", id } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["listenings"] }),
        qc.invalidateQueries({ queryKey: ["trash-center"] }),
      ]);
      toast.success(t("moved_to_trash"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("listenings")}</h1>
          <p className="text-sm text-muted-foreground">{total} {t("items").toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/teacher/sources?target=listenings">
              <FileUp className="h-4 w-4" />
              {t("import_document")}
            </a>
          </Button>
          <Button
            disabled={languages.isPending}
            onClick={() =>
              setEditor(emptyEditor(languages.defaultLearningCode))
            }
          >
            <Plus className="h-4 w-4" />
            {t("add_listening")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <Input value={search} placeholder={t("search")} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <select className={selectClass} value={language} onChange={(e) => { setLanguage(e.target.value); setPage(0); }}>
          <option value="">{t("all")} — {t("language")}</option>
          {languages.all.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={level} onChange={(e) => { setLevel(e.target.value); setPage(0); }}>
          <option value="">{t("all")} — {t("level")}</option>
          {LEVELS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }}>
          {(["active", "draft", "archived", "all"] as const).map((x) => <option key={x}>{t(x)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("title")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("language")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("level")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("sections")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("question_sets")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{isFetching ? "…" : t("no_results")}</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <button className="text-left font-medium hover:underline" onClick={() => openEdit(row.id)}>{row.title}</button>
                  <div className="text-xs text-muted-foreground">{row.media_id ? t("media_linked") : t("no_media")}</div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">{row.learning_language ?? "—"}</td>
                <td className="hidden px-3 py-2 md:table-cell">{row.level ?? "—"}</td>
                <td className="hidden px-3 py-2 md:table-cell">{row.sections}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{row.questionSets}</td>
                <td className="px-3 py-2">{t(row.status)}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(row.id)} aria-label={t("edit")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => trashListening(row.id)}
                      aria-label={t("trash")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page + 1} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>←</Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>→</Button>
        </div>
      </div>

      {editor && (
        <Dialog open onOpenChange={(open) => !open && setEditor(null)}>
          <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
            <DialogHeader><DialogTitle>{editor.id ? t("edit_listening") : t("add_listening")}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-5">
              <Field label={t("title")}><Input required autoFocus value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></Field>

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={t("language")}>
                  <select className={selectClass} value={editor.learning_language} onChange={(e) => setEditor({ ...editor, learning_language: e.target.value })}>
                    {editor.learning_language &&
                      !languages.learning.some(
                        (item) => item.code === editor.learning_language,
                      ) && (
                        <option value={editor.learning_language}>
                          {editor.learning_language}
                        </option>
                      )}
                    {languages.learning.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("level")}>
                  <select className={selectClass} value={editor.level} onChange={(e) => setEditor({ ...editor, level: e.target.value })}>
                    <option value="">—</option>{LEVELS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label={t("transcript_source")}>
                  <select className={selectClass} value={editor.transcript_source} onChange={(e) => setEditor({ ...editor, transcript_source: e.target.value as EditorState["transcript_source"] })}>
                    {(["none", "manual", "imported", "auto", "local_whisper"] as const).map((x) => <option key={x} value={x}>{t(x)}</option>)}
                  </select>
                </Field>
                <Field label={t("status")}>
                  <select className={selectClass} value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value as EditorState["status"] })}>
                    {(["active", "draft", "archived"] as const).map((x) => <option key={x}>{t(x)}</option>)}
                  </select>
                </Field>
              </div>

              <Field label={t("media")}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm">
                    {editor.media_id ? (
                      <div className="flex items-center gap-2">
                        <FileAudio className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{editor.media_label || editor.media_id}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t("no_media")}</span>
                    )}
                  </div>
                  <Button type="button" variant="outline" onClick={() => setMediaPickerOpen(true)}>
                    {t("choose_media")}
                  </Button>
                  {editor.media_id && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setEditor({ ...editor, media_id: "", media_label: "" })}
                    >
                      {t("clear")}
                    </Button>
                  )}
                </div>
              </Field>

              {editor.id && editor.media_id && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!!transcriptionJobId}
                    onClick={startTranscription}
                  >
                    <WandSparkles className="h-4 w-4" />
                    {transcriptionJobId ? t("transcribing") : t("transcribe_locally")}
                  </Button>
                  {transcriptionJobId && (
                    <div className="min-w-48 flex-1">
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>{t("local_whisper")}</span>
                        <span>{transcriptionProgress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-foreground transition-all"
                          style={{ width: `${transcriptionProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Field label={t("transcript")}>
                <Textarea rows={8} value={editor.transcript} onChange={(e) => setEditor({ ...editor, transcript: e.target.value })} />
              </Field>

              <section className="space-y-3">
                <Label>{t("playback_rules")}</Label>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label={t("max_plays")}>
                    <Input type="number" min={1} value={editor.max_plays} onChange={(e) => setEditor({ ...editor, max_plays: e.target.value })} placeholder="∞" />
                  </Field>
                  <Check label={t("allow_pause")} checked={editor.allow_pause} onChange={(v) => setEditor({ ...editor, allow_pause: v })} />
                  <Check label={t("allow_seek")} checked={editor.allow_seek} onChange={(v) => setEditor({ ...editor, allow_seek: v })} />
                  <Check label={t("allow_rewind")} checked={editor.allow_rewind} onChange={(v) => setEditor({ ...editor, allow_rewind: v })} />
                  <Check label={t("show_transcript")} checked={editor.show_transcript} onChange={(v) => setEditor({ ...editor, show_transcript: v })} />
                </div>
              </section>

              <Field label={t("topics")}>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {topicOpts.map((x) => (
                    <label key={x.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: x.depth * 16 }}>
                      <Checkbox checked={editor.topicIds.includes(x.id)} onCheckedChange={(checked) => setEditor({
                        ...editor,
                        topicIds: checked ? [...editor.topicIds, x.id] : editor.topicIds.filter((id) => id !== x.id),
                      })} />
                      {x.name}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Tags"><Input value={editor.tags} onChange={(e) => setEditor({ ...editor, tags: e.target.value })} placeholder="ielts, listening" /></Field>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("sections")}</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditor({
                    ...editor,
                    sections: [...editor.sections, { title: "", start_seconds: "", end_seconds: "" }],
                  })}><Plus className="h-4 w-4" />{t("add")}</Button>
                </div>
                {editor.sections.map((section, index) => (
                  <div key={section.id ?? index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_120px_120px_auto]">
                    <Input value={section.title} placeholder={t("title")} onChange={(e) => setEditor({
                      ...editor,
                      sections: editor.sections.map((x, i) => i === index ? { ...x, title: e.target.value } : x),
                    })} />
                    <Input type="number" min={0} step="0.1" value={section.start_seconds} placeholder={t("start_seconds")} onChange={(e) => setEditor({
                      ...editor,
                      sections: editor.sections.map((x, i) => i === index ? { ...x, start_seconds: e.target.value } : x),
                    })} />
                    <Input type="number" min={0} step="0.1" value={section.end_seconds} placeholder={t("end_seconds")} onChange={(e) => setEditor({
                      ...editor,
                      sections: editor.sections.map((x, i) => i === index ? { ...x, end_seconds: e.target.value } : x),
                    })} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void removeSection(index)}
                      aria-label={t("delete")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("question_sets")}</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditor({
                    ...editor,
                    questionSets: [...editor.questionSets, { section_id: "", title: "", instructions: "" }],
                  })}><Plus className="h-4 w-4" />{t("add")}</Button>
                </div>
                {editor.questionSets.map((set, index) => (
                  <div
                    key={set.id ?? index}
                    className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[180px_1fr_2fr_auto]"
                  >
                    <select className={selectClass} value={set.section_id} onChange={(e) => setEditor({
                      ...editor,
                      questionSets: editor.questionSets.map((x, i) => i === index ? { ...x, section_id: e.target.value } : x),
                    })}>
                      <option value="">{t("no_section")}</option>
                      {editor.sections.map((section, sectionIndex) => (
                        <option key={section.id ?? sectionIndex} value={section.id ?? `new:${sectionIndex}`}>
                          {section.title || `${t("section")} ${sectionIndex + 1}`}
                        </option>
                      ))}
                    </select>
                    <Input value={set.title} placeholder={t("title")} onChange={(e) => setEditor({
                      ...editor,
                      questionSets: editor.questionSets.map((x, i) => i === index ? { ...x, title: e.target.value } : x),
                    })} />
                    <Input value={set.instructions} placeholder={t("instructions")} onChange={(e) => setEditor({
                      ...editor,
                      questionSets: editor.questionSets.map((x, i) => i === index ? { ...x, instructions: e.target.value } : x),
                    })} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void removeQuestionSet(index)}
                      aria-label={t("delete")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    {set.id ? (
                      <div className="lg:col-span-4">
                        <ContextQuestionSetManager
                          kind="listening"
                          questionSetId={set.id}
                          topics={topics}
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground lg:col-span-4">
                        {t("save_context_before_questions")}
                      </div>
                    )}
                  </div>
                ))}
              </section>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>{t("cancel")}</Button>
                <Button type="submit" disabled={busy}>{t("save")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {editor && mediaPickerOpen && (
        <ListeningMediaPicker
          onClose={() => setMediaPickerOpen(false)}
          onChoose={(media) => {
            setEditor({
              ...editor,
              media_id: media.id,
              media_label: media.original_filename ?? media.id,
            });
            setMediaPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ListeningMediaPicker({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (media: { id: string; original_filename: string | null }) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"audio" | "video">("audio");
  const [page, setPage] = useState(0);
  const { data, isFetching } = useQuery({
    queryKey: ["listening-media-picker", search, kind, page],
    queryFn: () => listMedia({ data: { search, kind, includeDeleted: false, page } }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 40)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader><DialogTitle>{t("choose_media")}</DialogTitle></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder={t("search")}
            />
          </div>
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => { setKind(e.target.value as typeof kind); setPage(0); }}
          >
            <option value="audio">{t("audio")}</option>
            <option value="video">{t("video")}</option>
          </select>
        </div>
        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isFetching ? "…" : t("no_results")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((media) => (
                <li key={media.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {media.original_filename ?? media.id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {media.mime_type ?? t(media.kind)}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onChoose(media)}>{t("select")}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{page + 1} / {pages}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>←</Button>
            <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>→</Button>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(!!value)} />
      {label}
    </label>
  );
}
