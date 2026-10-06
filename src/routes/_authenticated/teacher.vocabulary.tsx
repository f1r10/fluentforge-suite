import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listTopics } from "@/lib/questions.functions";
import {
  getVocabularyEntry,
  listVocabulary,
  saveVocabularyEntry,
  setVocabularyStatus,
  suggestVocabularyEnrichmentForEditor,
  trashVocabulary,
  type VocabularyInput,
} from "@/lib/vocabulary.functions";
import { LEVELS } from "@/lib/question-types";
import { topicOptions } from "@/components/app/topics";
import { useI18n } from "@/lib/i18n";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });

export const Route = createFileRoute("/_authenticated/teacher/vocabulary")({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  component: VocabularyPage,
});

type Status = "active" | "draft" | "archived" | "all";
type Translation = { language: string; value: string };
type Example = { sentence: string; translation: string | null };

type EditorState = {
  id?: string;
  word: string;
  learning_language: string;
  definition: string;
  ipa: string;
  part_of_speech: string;
  synonyms: string;
  antonyms: string;
  level: string;
  notes: string;
  status: "active" | "draft" | "archived";
  translations: Translation[];
  examples: Example[];
  topicIds: string[];
  tags: string;
};

const emptyEditor = (): EditorState => ({
  word: "",
  learning_language: "en",
  definition: "",
  ipa: "",
  part_of_speech: "",
  synonyms: "",
  antonyms: "",
  level: "",
  notes: "",
  status: "active",
  translations: [{ language: "az", value: "" }],
  examples: [],
  topicIds: [],
  tags: "",
});

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function VocabularyPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: topics } = useSuspenseQuery(topicsQuery);
  const topicOpts = topicOptions(topics);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [topicId, setTopicId] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busyEditor, setBusyEditor] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichment, setEnrichment] = useState<
    Awaited<ReturnType<typeof suggestVocabularyEnrichmentForEditor>> | null
  >(null);

  const { data, isFetching } = useQuery({
    queryKey: ["vocabulary", search, language, level, status, topicId, page],
    queryFn: () =>
      listVocabulary({
        data: {
          search,
          language,
          level,
          status,
          topicId: topicId || undefined,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPage = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  async function openEdit(id: string) {
    try {
      const v = await getVocabularyEntry({ data: { id } });
      setEnrichment(null);
      setEditor({
        id: v.id,
        word: v.word,
        learning_language: v.learning_language ?? "en",
        definition: v.definition ?? "",
        ipa: v.ipa ?? "",
        part_of_speech: v.part_of_speech ?? "",
        synonyms: (v.synonyms ?? []).join(", "),
        antonyms: (v.antonyms ?? []).join(", "),
        level: v.level ?? "",
        notes: v.notes ?? "",
        status: v.status,
        translations: v.translations.length ? v.translations : [{ language: "az", value: "" }],
        examples: v.examples,
        topicIds: v.topicIds,
        tags: v.tags.join(", "),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveEditor(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusyEditor(true);
    try {
      const input: VocabularyInput = {
        id: editor.id,
        word: editor.word,
        learning_language: editor.learning_language,
        definition: editor.definition || null,
        ipa: editor.ipa || null,
        part_of_speech: editor.part_of_speech || null,
        synonyms: editor.synonyms
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        antonyms: editor.antonyms
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        level: editor.level || null,
        notes: editor.notes || null,
        status: editor.status,
        translations: editor.translations.filter((x) => x.language.trim() && x.value.trim()),
        examples: editor.examples.filter((x) => x.sentence.trim()),
        topicIds: editor.topicIds,
        tags: editor.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      };
      await saveVocabularyEntry({ data: input });
      setEditor(null);
      await qc.invalidateQueries({ queryKey: ["vocabulary"] });
      toast.success(t("save"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyEditor(false);
    }
  }

  async function generateEnrichment() {
    if (!editor?.word.trim()) {
      toast.error(t("word_required_for_enrichment"));
      return;
    }

    setEnriching(true);
    try {
      const currentTargets = editor.translations
        .map((item) => item.language.trim().toLowerCase())
        .filter(
          (language) =>
            language &&
            language !== editor.learning_language.toLowerCase(),
        );
      const fallbackTargets = ["az", "en", "ru", "tr"].filter(
        (language) => language !== editor.learning_language.toLowerCase(),
      );

      const suggestion = await suggestVocabularyEnrichmentForEditor({
        data: {
          word: editor.word,
          learningLanguage: editor.learning_language,
          targetLanguages: currentTargets.length
            ? [...new Set(currentTargets)]
            : fallbackTargets,
          existing: {
            definition: editor.definition || null,
            ipa: editor.ipa || null,
            partOfSpeech: editor.part_of_speech || null,
            translations: editor.translations.filter(
              (item) => item.language.trim() && item.value.trim(),
            ),
          },
        },
      });
      setEnrichment(suggestion);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setEnriching(false);
    }
  }

  function applyEnrichment() {
    if (!editor || !enrichment) return;

    const translationMap = new Map(
      editor.translations
        .filter((item) => item.language.trim())
        .map((item) => [item.language.toLowerCase(), item]),
    );
    for (const item of enrichment.translations) {
      const key = item.language.toLowerCase();
      const existing = translationMap.get(key);
      if (!existing?.value.trim()) {
        translationMap.set(key, item);
      }
    }

    const exampleKeys = new Set(
      editor.examples.map((item) => item.sentence.trim().toLowerCase()),
    );
    const examples = [...editor.examples];
    for (const item of enrichment.examples) {
      const key = item.sentence.trim().toLowerCase();
      if (!exampleKeys.has(key)) {
        exampleKeys.add(key);
        examples.push(item);
      }
    }

    const mergeWords = (current: string, incoming: string[]) =>
      [
        ...new Set([
          ...current
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          ...incoming.map((value) => value.trim()).filter(Boolean),
        ]),
      ].join(", ");

    setEditor({
      ...editor,
      definition: editor.definition || enrichment.definition || "",
      ipa: editor.ipa || enrichment.ipa || "",
      part_of_speech:
        editor.part_of_speech || enrichment.part_of_speech || "",
      synonyms: mergeWords(editor.synonyms, enrichment.synonyms),
      antonyms: mergeWords(editor.antonyms, enrichment.antonyms),
      translations: [...translationMap.values()],
      examples,
    });
    setEnrichment(null);
    toast.success(t("enrichment_applied"));
  }

  async function bulkStatus(next: "active" | "draft" | "archived") {
    if (!selected.length) return;
    try {
      await setVocabularyStatus({ data: { ids: selected, status: next } });
      setSelected([]);
      await qc.invalidateQueries({ queryKey: ["vocabulary"] });
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function bulkTrash() {
    if (!selected.length || !confirm(`${t("delete")} ${selected.length}?`)) return;
    try {
      await trashVocabulary({ data: { ids: selected } });
      setSelected([]);
      await qc.invalidateQueries({ queryKey: ["vocabulary"] });
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("vocabulary")}</h1>
          <p className="text-sm text-muted-foreground">{total} {t("items").toLowerCase()}</p>
        </div>
        <Button onClick={() => { setEnrichment(null); setEditor(emptyEditor()); }}>
          <Plus className="h-4 w-4" />
          {t("add_vocabulary")}
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-5">
        <Input
          value={search}
          placeholder={t("search")}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          className={selectClass}
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("language")}</option>
          <option value="en">English</option>
          <option value="az">Azərbaycanca</option>
          <option value="ru">Русский</option>
          <option value="tr">Türkçe</option>
        </select>
        <select
          className={selectClass}
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("level")}</option>
          {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select
          className={selectClass}
          value={topicId}
          onChange={(e) => {
            setTopicId(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")} — {t("topics")}</option>
          {topicOpts.map((x) => (
            <option key={x.id} value={x.id}>{"—".repeat(x.depth)} {x.name}</option>
          ))}
        </select>
        <select
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status);
            setPage(0);
          }}
        >
          {(["active", "draft", "archived", "all"] as const).map((x) => (
            <option key={x} value={x}>{t(x)}</option>
          ))}
        </select>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <strong>{selected.length} {t("selected")}</strong>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("active")}>{t("active")}</Button>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("draft")}>{t("draft")}</Button>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("archived")}>{t("archive")}</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={bulkTrash}>
            <Trash2 className="h-4 w-4" />{t("delete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t("clear")}</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allOnPage}
                  onCheckedChange={(checked) => {
                    const ids = rows.map((x) => x.id);
                    setSelected(checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)));
                  }}
                  aria-label={t("select_all")}
                />
              </th>
              <th className="px-3 py-2 font-medium">{t("word")}</th>
              <th className="px-3 py-2 font-medium">{t("translations")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("level")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("type")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  {isFetching ? "…" : t("no_results")}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected.includes(row.id)}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <button className="text-left font-medium hover:underline" onClick={() => openEdit(row.id)}>
                    {row.word}
                  </button>
                  {row.ipa && <div className="text-xs text-muted-foreground">{row.ipa}</div>}
                </td>
                <td className="px-3 py-2">
                  {row.vocabulary_translations.slice(0, 3).map((x) => x.value).join(" · ") || "—"}
                </td>
                <td className="hidden px-3 py-2 md:table-cell">{row.level ?? "—"}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{row.part_of_speech ?? "—"}</td>
                <td className="px-3 py-2">{t(row.status)}</td>
                <td className="px-2 py-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(row.id)} aria-label={t("edit")}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {page + 1} / {pages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((x) => x + 1)}
          >
            →
          </Button>
        </div>
      </div>

      {editor && (
        <Dialog open onOpenChange={(open) => !open && setEditor(null)}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editor.id ? t("edit_vocabulary") : t("add_vocabulary")}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">
                  {t("vocabulary_enrichment")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("vocabulary_enrichment_hint")}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={generateEnrichment}
                disabled={enriching || !editor.word.trim()}
              >
                <Sparkles className="h-4 w-4" />
                {enriching ? t("generating") : t("suggest_enrichment")}
              </Button>
            </div>

            {enrichment && (
              <div className="space-y-3 rounded-md border border-primary/30 bg-primary/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{t("ai_suggestion")}</div>
                    <div className="text-xs text-muted-foreground">
                      {enrichment.provider} · {enrichment.model} · {t("confidence")}:{" "}
                      {Math.round(enrichment.confidence * 100)}%
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEnrichment(null)}
                    >
                      {t("dismiss")}
                    </Button>
                    <Button type="button" size="sm" onClick={applyEnrichment}>
                      {t("apply_suggestion")}
                    </Button>
                  </div>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("definition")}
                    </dt>
                    <dd>{enrichment.definition || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">IPA / POS</dt>
                    <dd>
                      {enrichment.ipa || "—"} · {enrichment.part_of_speech || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("translations")}
                    </dt>
                    <dd>
                      {enrichment.translations
                        .map((item) => `${item.language}: ${item.value}`)
                        .join(" · ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("examples")}
                    </dt>
                    <dd>
                      {enrichment.examples
                        .map((item) => item.sentence)
                        .slice(0, 3)
                        .join(" · ") || "—"}
                    </dd>
                  </div>
                </dl>
                {enrichment.notes && (
                  <p className="text-xs text-muted-foreground">
                    {enrichment.notes}
                  </p>
                )}
              </div>
            )}

            <form className="space-y-5" onSubmit={saveEditor}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("word")}>
                  <Input
                    value={editor.word}
                    onChange={(e) => setEditor({ ...editor, word: e.target.value })}
                    required
                    autoFocus
                  />
                </Field>
                <Field label={t("language")}>
                  <select
                    className={selectClass}
                    value={editor.learning_language}
                    onChange={(e) => setEditor({ ...editor, learning_language: e.target.value })}
                  >
                    <option value="en">English</option>
                    <option value="az">Azərbaycanca</option>
                    <option value="ru">Русский</option>
                    <option value="tr">Türkçe</option>
                    <option value="de">Deutsch</option>
                    <option value="fr">Français</option>
                    <option value="es">Español</option>
                    <option value="it">Italiano</option>
                    <option value="ar">العربية</option>
                  </select>
                </Field>
                <Field label="IPA">
                  <Input value={editor.ipa} onChange={(e) => setEditor({ ...editor, ipa: e.target.value })} />
                </Field>
                <Field label={t("part_of_speech")}>
                  <Input
                    value={editor.part_of_speech}
                    onChange={(e) => setEditor({ ...editor, part_of_speech: e.target.value })}
                  />
                </Field>
                <Field label={t("level")}>
                  <select
                    className={selectClass}
                    value={editor.level}
                    onChange={(e) => setEditor({ ...editor, level: e.target.value })}
                  >
                    <option value="">—</option>
                    {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label={t("status")}>
                  <select
                    className={selectClass}
                    value={editor.status}
                    onChange={(e) => setEditor({ ...editor, status: e.target.value as EditorState["status"] })}
                  >
                    {(["active", "draft", "archived"] as const).map((x) => <option key={x} value={x}>{t(x)}</option>)}
                  </select>
                </Field>
              </div>

              <Field label={t("definition")}>
                <Textarea
                  value={editor.definition}
                  onChange={(e) => setEditor({ ...editor, definition: e.target.value })}
                  rows={3}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("synonyms")}>
                  <Input
                    value={editor.synonyms}
                    onChange={(e) => setEditor({ ...editor, synonyms: e.target.value })}
                    placeholder="quick, rapid"
                  />
                </Field>
                <Field label={t("antonyms")}>
                  <Input
                    value={editor.antonyms}
                    onChange={(e) => setEditor({ ...editor, antonyms: e.target.value })}
                    placeholder="slow"
                  />
                </Field>
              </div>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("translations")}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditor({
                        ...editor,
                        translations: [...editor.translations, { language: "az", value: "" }],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />{t("add")}
                  </Button>
                </div>
                {editor.translations.map((tr, index) => (
                  <div key={index} className="grid grid-cols-[120px_1fr_auto] gap-2">
                    <Input
                      value={tr.language}
                      maxLength={10}
                      placeholder="az"
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          translations: editor.translations.map((x, i) =>
                            i === index ? { ...x, language: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={tr.value}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          translations: editor.translations.map((x, i) =>
                            i === index ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setEditor({
                          ...editor,
                          translations: editor.translations.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("examples")}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditor({
                        ...editor,
                        examples: [...editor.examples, { sentence: "", translation: null }],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />{t("add")}
                  </Button>
                </div>
                {editor.examples.map((example, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={example.sentence}
                      placeholder={t("example_sentence")}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          examples: editor.examples.map((x, i) =>
                            i === index ? { ...x, sentence: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={example.translation ?? ""}
                      placeholder={t("translation")}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          examples: editor.examples.map((x, i) =>
                            i === index ? { ...x, translation: e.target.value || null } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setEditor({
                          ...editor,
                          examples: editor.examples.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </section>

              <Field label={t("topics")}>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {topicOpts.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                  {topicOpts.map((x) => (
                    <label
                      key={x.id}
                      className="flex items-center gap-2 text-sm"
                      style={{ paddingLeft: x.depth * 16 }}
                    >
                      <Checkbox
                        checked={editor.topicIds.includes(x.id)}
                        onCheckedChange={(checked) =>
                          setEditor({
                            ...editor,
                            topicIds: checked
                              ? [...editor.topicIds, x.id]
                              : editor.topicIds.filter((id) => id !== x.id),
                          })
                        }
                      />
                      {x.name}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Tags">
                <Input
                  value={editor.tags}
                  placeholder="ielts, academic"
                  onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
                />
              </Field>

              <Field label={t("teacher_notes")}>
                <Textarea
                  value={editor.notes}
                  onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                  rows={3}
                />
              </Field>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={busyEditor}>
                  {t("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
