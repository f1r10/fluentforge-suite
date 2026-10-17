import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAGE_SIZE = 50;

const bookInputSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid(),
  mediaId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).nullable().default(null),
  description: z.string().max(20_000).nullable().default(null),
  learningLanguage: z.string().trim().max(10).nullable().default(null),
  level: z.string().trim().max(20).nullable().default(null),
  status: z.enum(["draft", "active", "archived"]).default("active"),
  allowDownload: z.boolean().default(true),
});

async function requireStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

export const listTeacherLibraryCategories = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("library_categories")
      .select("id,system_key,name,sort_order,is_visible,created_at,updated_at")
      .is("deleted_at", null)
      .order("sort_order")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveLibraryCategory = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        isVisible: z.boolean().default(true),
        sortOrder: z.number().int().min(0).max(100_000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();

    if (data.id) {
      const { data: current, error: currentError } = await context.supabase
        .from("library_categories")
        .select("id,system_key")
        .eq("id", data.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) throw new Error("Library section not found.");

      const patch = current.system_key
        ? {
            is_visible: data.isVisible,
            sort_order: data.sortOrder,
            updated_at: now,
          }
        : {
            name: data.name,
            is_visible: data.isVisible,
            sort_order: data.sortOrder,
            updated_at: now,
          };

      const { error } = await context.supabase
        .from("library_categories")
        .update(patch)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await context.supabase
      .from("library_categories")
      .insert({
        system_key: null,
        name: data.name,
        is_visible: data.isVisible,
        sort_order: data.sortOrder,
      })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(error?.message ?? "Could not create library section.");
    }
    return { id: created.id };
  });

export const deleteLibraryCategory = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: category, error: categoryError } = await admin
      .from("library_categories")
      .select("id,system_key")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (categoryError) throw new Error(categoryError.message);
    if (!category) throw new Error("Library section not found.");
    if (category.system_key) {
      throw new Error("Built-in library sections cannot be deleted.");
    }

    const { count, error: countError } = await admin
      .from("library_books")
      .select("id", { count: "exact", head: true })
      .eq("category_id", data.id)
      .is("deleted_at", null);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error("Move or delete the books in this section first.");
    }

    const { error } = await admin
      .from("library_categories")
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTeacherLibraryBooks = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        categoryId: z.string().uuid().nullable().default(null),
        search: z.string().max(200).default(""),
        status: z.enum(["all", "draft", "active", "archived"]).default("all"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("library_books")
      .select(
        "id,category_id,media_id,title,author,description,learning_language,level,status,allow_download,sort_order,created_at,updated_at,library_categories(id,system_key,name),media_assets(id,kind,original_filename,mime_type,size_bytes)",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .order("sort_order")
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.categoryId) query = query.eq("category_id", data.categoryId);
    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      query = query.ilike("title", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const saveLibraryBook = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => bookInputSchema.parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const { data: category, error: categoryError } = await admin
      .from("library_categories")
      .select("id")
      .eq("id", data.categoryId)
      .is("deleted_at", null)
      .maybeSingle();
    if (categoryError) throw new Error(categoryError.message);
    if (!category) throw new Error("Library section not found.");

    let mediaId = data.mediaId ?? null;
    if (data.id && !mediaId) {
      const { data: current, error: currentError } = await admin
        .from("library_books")
        .select("media_id")
        .eq("id", data.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      mediaId = current?.media_id ?? null;
    }
    if (!mediaId) throw new Error("Choose a book/document file.");

    const { data: media, error: mediaError } = await admin
      .from("media_assets")
      .select("id,kind")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .maybeSingle();
    if (mediaError) throw new Error(mediaError.message);
    if (!media) throw new Error("Uploaded library file was not found.");
    if (!["document", "other"].includes(media.kind)) {
      throw new Error("Library books must be document files.");
    }

    const fields = {
      category_id: data.categoryId,
      media_id: mediaId,
      title: data.title,
      author: data.author || null,
      description: data.description || null,
      learning_language: data.learningLanguage || null,
      level: data.level || null,
      status: data.status,
      allow_download: data.allowDownload,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await admin
        .from("library_books")
        .update(fields)
        .eq("id", data.id)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await admin
      .from("library_books")
      .insert(fields)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (!created) throw new Error("Could not add book to library.");
    return { id: created.id };
  });

export const trashLibraryBook = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("library_books")
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTeacherLibraryBookAccess = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const { resolveMediaUrl } = await import("./media.server");
    const admin = await adminClient();
    const { data: book, error } = await admin
      .from("library_books")
      .select(
        "id,title,allow_download,media_assets(id,storage_path,external_url,original_filename,mime_type)",
      )
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!book) throw new Error("Library book not found.");
    const media = book.media_assets as unknown as {
      id: string;
      storage_path: string | null;
      external_url: string | null;
      original_filename: string | null;
      mime_type: string | null;
    } | null;
    if (!media) throw new Error("Library file not found.");
    return {
      id: book.id,
      title: book.title,
      url: await resolveMediaUrl(admin, media, 60 * 60),
      filename: media.original_filename,
      mimeType: media.mime_type,
      allowDownload: book.allow_download,
    };
  });

export const listStudentLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const [categoriesResult, booksResult] = await Promise.all([
      admin
        .from("library_categories")
        .select("id,system_key,name,sort_order")
        .eq("is_visible", true)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      admin
        .from("library_books")
        .select(
          "id,category_id,title,author,description,learning_language,level,allow_download,sort_order,created_at,media_assets(id,original_filename,mime_type,size_bytes)",
        )
        .eq("status", "active")
        .is("deleted_at", null)
        .order("sort_order")
        .order("created_at", { ascending: false }),
    ]);
    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (booksResult.error) throw new Error(booksResult.error.message);

    const visibleCategoryIds = new Set(
      (categoriesResult.data ?? []).map((row) => row.id),
    );

    return {
      categories: categoriesResult.data ?? [],
      books: (booksResult.data ?? []).filter((row) =>
        visibleCategoryIds.has(row.category_id),
      ),
    };
  });

export const getStudentLibraryBookAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const { resolveMediaUrl } = await import("./media.server");
    const admin = await adminClient();

    const { data: book, error } = await admin
      .from("library_books")
      .select(
        "id,title,allow_download,category_id,library_categories!inner(id,is_visible,deleted_at),media_assets(id,storage_path,external_url,original_filename,mime_type,deleted_at)",
      )
      .eq("id", data.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .eq("library_categories.is_visible", true)
      .is("library_categories.deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!book) throw new Error("Library book is not available.");

    const media = book.media_assets as unknown as {
      id: string;
      storage_path: string | null;
      external_url: string | null;
      original_filename: string | null;
      mime_type: string | null;
      deleted_at: string | null;
    } | null;
    if (!media || media.deleted_at) {
      throw new Error("Library file is not available.");
    }

    return {
      id: book.id,
      title: book.title,
      url: await resolveMediaUrl(admin, media, 30 * 60),
      filename: media.original_filename,
      mimeType: media.mime_type,
      allowDownload: book.allow_download,
    };
  });
