import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, Download, Eye, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getStudentLibraryBookAccess,
  listStudentLibrary,
} from "@/lib/library.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student/library")({
  component: StudentLibraryPage,
  head: () => ({
    meta: [
      { title: "Library" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type StudentLibrary = Awaited<ReturnType<typeof listStudentLibrary>>;
type StudentCategory = StudentLibrary["categories"][number];
type StudentBook = StudentLibrary["books"][number];

function StudentLibraryPage() {
  const { t } = useI18n();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    url: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["student-library"],
    queryFn: () => listStudentLibrary(),
  });

  const categories = data?.categories ?? [];
  const books = data?.books ?? [];

  const visibleBooks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return books.filter((book) => {
      if (categoryId && book.category_id !== categoryId) return false;
      if (!needle) return true;
      return [
        book.title,
        book.author ?? "",
        book.description ?? "",
        book.level ?? "",
        book.learning_language ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [books, categoryId, search]);

  async function openBook(book: StudentBook, download = false) {
    try {
      const access = await getStudentLibraryBookAccess({
        data: { id: book.id },
      });
      if (!access.url) throw new Error(t("file_unavailable"));

      if (download) {
        if (!access.allowDownload) {
          toast.error(t("download_not_allowed"));
          return;
        }
        const anchor = document.createElement("a");
        anchor.href = access.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.download = access.filename ?? book.title;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }

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
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("library")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("student_library_hint")}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={categoryId === null ? "default" : "outline"}
          onClick={() => setCategoryId(null)}
        >
          {t("all")}
        </Button>
        {categories.map((category) => (
          <Button
            key={category.id}
            size="sm"
            variant={categoryId === category.id ? "default" : "outline"}
            onClick={() => setCategoryId(category.id)}
          >
            {categoryLabel(category, t)}
          </Button>
        ))}
      </div>

      <div className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("search_library")}
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : visibleBooks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t("library_empty_student")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleBooks.map((book) => {
            const media = book.media_assets as unknown as {
              original_filename: string | null;
              mime_type: string | null;
              size_bytes: number | null;
            } | null;
            const category = categories.find(
              (item) => item.id === book.category_id,
            );
            return (
              <article
                key={book.id}
                className="flex min-h-52 flex-col rounded-md border border-border p-4"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <BookMarked className="h-5 w-5" />
                </div>
                <div className="font-semibold">{book.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {category ? categoryLabel(category, t) : "—"}
                  {book.author ? " · " + book.author : ""}
                  {book.level ? " · " + book.level : ""}
                  {book.learning_language
                    ? " · " + book.learning_language
                    : ""}
                </div>
                {book.description && (
                  <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">
                    {book.description}
                  </p>
                )}
                {media?.original_filename && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {media.original_filename}
                    {media.size_bytes
                      ? " · " + formatBytes(media.size_bytes)
                      : ""}
                  </div>
                )}
                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openBook(book)}
                  >
                    <Eye className="h-4 w-4" />
                    {t("view")}
                  </Button>
                  {book.allow_download && (
                    <Button
                      size="sm"
                      onClick={() => void openBook(book, true)}
                    >
                      <Download className="h-4 w-4" />
                      {t("download")}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="flex h-[92vh] max-w-6xl flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>{preview.title}</DialogTitle>
            </DialogHeader>
            <iframe
              title={preview.title}
              src={preview.url}
              className="min-h-0 w-full flex-1 rounded-md border border-border"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function categoryLabel(
  category: Pick<StudentCategory, "system_key" | "name">,
  t: (key: string) => string,
) {
  if (!category.system_key) return category.name;
  const key = "library_section_" + category.system_key;
  const translated = t(key);
  return translated === key ? category.name : translated;
}

function formatBytes(value: number) {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  if (value < 1024 * 1024 * 1024) {
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }
  return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}
