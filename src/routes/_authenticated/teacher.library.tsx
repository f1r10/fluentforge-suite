import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { BookMarked, Eye, FileUp, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createMediaUploadSession, finalizeMediaUpload } from "@/lib/media.functions";
import {
  deleteLibraryCategory,
  getTeacherLibraryBookAccess,
  listTeacherLibraryBooks,
  listTeacherLibraryCategories,
  saveLibraryBook,
  saveLibraryCategory,
  trashLibraryBook,
} from "@/lib/library.functions";
import { supabase } from "@/integrations/supabase/client";
import { LEVELS } from "@/lib/question-types";
import { useContentLanguages } from "@/lib/content-languages";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/teacher/library")({
  component: TeacherLibraryPage,
});

type Category = Awaited<ReturnType<typeof listTeacherLibraryCategories>>[number];
type Book = Awaited<ReturnType<typeof listTeacherLibraryBooks>>["rows"][number];

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function TeacherLibraryPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const languages = useContentLanguages();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "draft" | "active" | "archived">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [categoryEditor, setCategoryEditor] = useState<Category | "new" | null>(null);
  const [bookEditor, setBookEditor] = useState<Book | "new" | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["library-categories"],
    queryFn: () => listTeacherLibraryCategories(),
  });

  const { data, isFetching } = useQuery({
    queryKey: ["library-books", categoryId, status, search, page],
    queryFn: () => listTeacherLibraryBooks({ data: { categoryId, status, search, page } }),
    placeholderData: keepPreviousData,
  });

  const books = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  async function removeCategory(category: Category) {
    if (!confirm(t("delete") + " \"" + categoryLabel(category, t) + "\"?")) return;
    try {
      await deleteLibraryCategory({ data: { id: category.id } });
      if (categoryId === category.id) setCategoryId(null);
      await qc.invalidateQueries({ queryKey: ["library-categories"] });
      toast.success(t("delete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeBook(book: Book) {
    if (!confirm(t("delete") + " \"" + book.title + "\"?")) return;
    try {
      await trashLibraryBook({ data: { id: book.id } });
      await qc.invalidateQueries({ queryKey: ["library-books"] });
      toast.success(t("delete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewBook(book: Book) {
    try {
      const access = await getTeacherLibraryBookAccess({ data: { id: book.id } });
      if (!access.url) throw new Error("File URL is unavailable.");
      if (access.mimeType === "application/pdf") {
        setPreview({ title: access.title, url: access.url });
      } else {
        window.open(access.url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("library")}</h1>
          <p className="text-sm text-muted-foreground">{t("teacher_library_hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCategoryEditor("new")}>
            <FolderPlus className="h-4 w-4" />
            {t("new_library_section")}
          </Button>
          <Button disabled={categories.length === 0} onClick={() => setBookEditor("new")}>
            <Plus className="h-4 w-4" />
            {t("add_book")}
          </Button>
        </div>
      </div>

      <section className="rounded-md border border-border">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Button
            size="sm"
            variant={categoryId === null ? "default" : "outline"}
            onClick={() => { setCategoryId(null); setPage(0); }}
          >
            {t("all")}
          </Button>
          {categories.map((category) => (
            <div key={category.id} className="flex items-center">
              <Button
                size="sm"
                variant={categoryId === category.id ? "default" : "outline"}
                onClick={() => { setCategoryId(category.id); setPage(0); }}
              >
                {categoryLabel(category, t)}
              </Button>
              {!category.system_key && (
                <div className="ml-1 flex">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setCategoryEditor(category)} aria-label={t("edit")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => void removeCategory(category)} aria-label={t("delete")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-[1fr_180px]">
          <Input
            value={search}
            placeholder={t("search")}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          />
          <select
            className={selectClass}
            value={status}
            onChange={(event) => { setStatus(event.target.value as typeof status); setPage(0); }}
          >
            {(["all", "active", "draft", "archived"] as const).map((value) => (
              <option key={value} value={value}>{t(value)}</option>
            ))}
          </select>
        </div>
      </section>

      <div className="overflow-hidden rounded-md border border-border">
        {books.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isFetching ? "…" : t("library_empty")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {books.map((book) => {
              const category = book.library_categories as unknown as Category | null;
              const media = book.media_assets as unknown as {
                original_filename: string | null;
                mime_type: string | null;
                size_bytes: number | null;
              } | null;
              return (
                <article key={book.id} className="flex flex-wrap items-start gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <BookMarked className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{book.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {category ? categoryLabel(category, t) : "—"}
                      {book.author ? " · " + book.author : ""}
                      {book.level ? " · " + book.level : ""}
                      {book.learning_language ? " · " + book.learning_language : ""}
                      {media?.original_filename ? " · " + media.original_filename : ""}
                    </div>
                    {book.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{book.description}</p>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t(book.status)} · {book.allow_download ? t("download_allowed") : t("view_only")}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => void previewBook(book)} aria-label={t("preview")}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setBookEditor(book)} aria-label={t("edit")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void removeBook(book)} aria-label={t("delete")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</Button>
        <span>{page + 1} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>→</Button>
      </div>

      {categoryEditor && (
        <CategoryDialog
          category={categoryEditor === "new" ? null : categoryEditor}
          onClose={() => setCategoryEditor(null)}
          onSaved={async () => {
            setCategoryEditor(null);
            await qc.invalidateQueries({ queryKey: ["library-categories"] });
          }}
        />
      )}

      {bookEditor && (
        <BookDialog
          book={bookEditor === "new" ? null : bookEditor}
          categories={categories}
          languages={languages.all}
          defaultCategoryId={categoryId ?? categories[0]?.id ?? ""}
          onClose={() => setBookEditor(null)}
          onSaved={async () => {
            setBookEditor(null);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["library-books"] }),
              qc.invalidateQueries({ queryKey: ["media-library"] }),
            ]);
          }}
        />
      )}

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="flex h-[92vh] max-w-6xl flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{preview.title}</DialogTitle></DialogHeader>
            <iframe title={preview.title} src={preview.url} className="min-h-0 w-full flex-1 rounded-md border border-border" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(category?.name ?? "");
  const [visible, setVisible] = useState(category?.is_visible ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveLibraryCategory({
        data: {
          id: category?.id,
          name: name.trim(),
          isVisible: visible,
          sortOrder: category?.sort_order ?? 100,
        },
      });
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? t("edit_library_section") : t("new_library_section")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("section_name")} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={visible} onCheckedChange={(value) => setVisible(!!value)} />
            {t("visible_to_students")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookDialog({
  book,
  categories,
  languages,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  book: Book | null;
  categories: Category[];
  languages: Array<{ code: string; label: string }>;
  defaultCategoryId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [categoryId, setCategoryId] = useState(book?.category_id ?? defaultCategoryId);
  const [title, setTitle] = useState(book?.title ?? "");
  const [author, setAuthor] = useState(book?.author ?? "");
  const [description, setDescription] = useState(book?.description ?? "");
  const [language, setLanguage] = useState(book?.learning_language ?? "");
  const [level, setLevel] = useState(book?.level ?? "");
  const [status, setStatus] = useState<"draft" | "active" | "archived">(
    (book?.status as "draft" | "active" | "archived") ?? "active",
  );
  const [allowDownload, setAllowDownload] = useState(book?.allow_download ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const existingMedia = book?.media_assets as unknown as { original_filename: string | null } | null;

  async function upload(fileValue: File) {
    const session = await createMediaUploadSession({
      data: {
        filename: fileValue.name,
        mimeType: fileValue.type || "application/octet-stream",
        sizeBytes: fileValue.size,
      },
    });
    if (!["document", "other"].includes(session.kind)) {
      throw new Error(t("library_document_required"));
    }
    const { error } = await supabase.storage
      .from(session.bucket)
      .uploadToSignedUrl(session.path, session.token, fileValue, {
        contentType: fileValue.type || "application/octet-stream",
        upsert: false,
      });
    if (error) throw error;
    return await finalizeMediaUpload({
      data: {
        sessionId: session.sessionId,
        checksum: null,
        durationSeconds: null,
        width: null,
        height: null,
      },
    });
  }

  async function save() {
    if (!categoryId || !title.trim()) return;
    if (!book && !file) {
      toast.error(t("choose_library_file"));
      return;
    }

    setBusy(true);
    try {
      let mediaId: string | undefined;
      if (file) {
        const result = await upload(file);
        mediaId = result.id;
      }
      await saveLibraryBook({
        data: {
          id: book?.id,
          categoryId,
          mediaId,
          title: title.trim(),
          author: author.trim() || null,
          description: description.trim() || null,
          learningLanguage: language || null,
          level: level || null,
          status,
          allowDownload,
        },
      });
      toast.success(t("save"));
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{book ? t("edit_book") : t("add_book")}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <select className={selectClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">{t("choose_library_section")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{categoryLabel(category, t)}</option>
            ))}
          </select>

          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("title")} />
          <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={t("author")} />
          <Textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("description")} />

          <div className="grid gap-3 sm:grid-cols-2">
            <select className={selectClass} value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="">{t("language")}: —</option>
              {languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
            <select className={selectClass} value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">{t("level")}: —</option>
              {LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>

          <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="active">{t("active")}</option>
            <option value="draft">{t("draft")}</option>
            <option value="archived">{t("archived")}</option>
          </select>

          <div className="rounded-md border border-border p-3">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.epub,.doc,.docx,.ppt,.pptx,.txt,.rtf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{file?.name ?? existingMedia?.original_filename ?? t("no_file_selected")}</div>
                <div className="text-xs text-muted-foreground">{t("library_file_formats")}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                {book ? t("replace_file") : t("choose_file")}
              </Button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allowDownload} onCheckedChange={(value) => setAllowDownload(!!value)} />
            {t("allow_student_download")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t("cancel")}</Button>
          <Button disabled={busy || !categoryId || !title.trim() || (!book && !file)} onClick={() => void save()}>
            {busy ? t("uploading") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function categoryLabel(category: Pick<Category, "system_key" | "name">, t: (key: string) => string) {
  if (!category.system_key) return category.name;
  const key = "library_section_" + category.system_key;
  const translated = t(key);
  return translated === key ? category.name : translated;
}
