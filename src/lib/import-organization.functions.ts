import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const kindSchema = z.enum(["question", "vocabulary", "reading", "listening"]);
const organizationSchema = z.object({
  jobId: z.string().uuid(),
  catalogId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  kinds: z.array(kindSchema).min(1).max(4).default(["question", "vocabulary", "reading", "listening"]),
  pageFrom: z.number().int().min(1).nullable().default(null),
  pageTo: z.number().int().min(1).nullable().default(null),
}).refine((value) => value.pageFrom == null || value.pageTo == null || value.pageFrom <= value.pageTo, {
  message: "The first page must not exceed the last page.",
});

type Kind = z.infer<typeof kindSchema>;
const tagLinks: Record<Kind, { table: string; key: string }> = {
  question: { table: "question_tags", key: "question_id" },
  vocabulary: { table: "vocabulary_tags", key: "entry_id" },
  reading: { table: "reading_tags", key: "reading_id" },
  listening: { table: "listening_tags", key: "listening_id" },
};

/**
 * Organize ONLY approved, successfully committed entities originating from this import.
 * No SQL text is constructed from client-supplied strings, and no existing taxonomy links
 * are removed. Re-running after a partial failure is safe (ignoreDuplicates).
 */
export const organizeDocumentImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((value) => organizationSchema.parse(value))
  .handler(async ({ data, context }) => {
    if (!data.catalogId && !data.tags.length) {
      throw new Error("Choose a catalog or enter one or more tags.");
    }

    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const { data: job, error: jobError } = await admin.from("import_jobs")
      .select("id").eq("id", data.jobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Import job was not found.");

    if (data.catalogId) {
      const { data: catalog, error } = await admin.from("catalogs")
        .select("id,status").eq("id", data.catalogId)
        .is("deleted_at", null).maybeSingle();
      if (error) throw new Error(error.message);
      if (!catalog || catalog.status === "archived") {
        throw new Error("Select an existing non-archived catalog.");
      }
    }

    const allowed = new Set<Kind>(data.kinds);
    const imported: Array<{ kind: Kind; id: string }> = [];
    for (let offset = 0; ; offset += 200) {
      const { data: rows, error } = await admin.from("import_items")
        .select("item_type,created_entity_id,page")
        .eq("job_id", data.jobId).eq("decision", "approved")
        .not("created_entity_id", "is", null)
        .order("created_at").order("id")
        .range(offset, offset + 199);
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        if (!allowed.has(row.item_type as Kind) ||
            !row.created_entity_id ||
            (data.pageFrom != null && (row.page == null || row.page < data.pageFrom)) ||
            (data.pageTo != null && (row.page == null || row.page > data.pageTo))) continue;
        imported.push({ kind: row.item_type as Kind, id: row.created_entity_id });
      }
      if ((rows?.length ?? 0) < 200) break;
      if (offset > 50000) throw new Error("Import organization exceeds 50,000 items.");
    }

    const unique = [...new Map(imported.map((item) => [
      item.kind + ":" + item.id, item,
    ] as const)).values()];
    if (!unique.length) throw new Error("No committed imported content matches this selection.");

    const names = [...new Set(data.tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))];
    const tagIds: string[] = [];
    if (names.length) {
      const { error: upsertError } = await admin.from("tags")
        .upsert(names.map((name) => ({ name })), {
          onConflict: "name", ignoreDuplicates: true,
        });
      if (upsertError) throw new Error(upsertError.message);
      const { data: tagRows, error } = await admin.from("tags")
        .select("id,name").in("name", names);
      if (error) throw new Error(error.message);
      tagIds.push(...(tagRows ?? []).map((row) => row.id));
      if (tagIds.length !== names.length) throw new Error("Not all requested tags could be resolved.");
    }

    if (data.catalogId) {
      const { data: tail, error } = await admin.from("catalog_items")
        .select("sort_order").eq("catalog_id", data.catalogId)
        .order("sort_order", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      const next = (tail?.sort_order ?? -1) + 1;
      for (let start = 0; start < unique.length; start += 100) {
        const { error: insertError } = await admin.from("catalog_items").upsert(
          unique.slice(start, start + 100).map((item, index) => ({
            catalog_id: data.catalogId!,
            entity_type: item.kind,
            entity_id: item.id,
            sort_order: next + start + index,
          })),
          { onConflict: "catalog_id,entity_type,entity_id", ignoreDuplicates: true },
        );
        if (insertError) throw new Error(insertError.message);
      }
    }

    for (const kind of data.kinds) {
      if (!tagIds.length) break;
      const linked = unique.filter((item) => item.kind === kind);
      const join = tagLinks[kind];
      for (let start = 0; start < linked.length; start += 50) {
        const rows = linked.slice(start, start + 50).flatMap((item) =>
          tagIds.map((tagId) => ({ [join.key]: item.id, tag_id: tagId })));
        // Fixed whitelist of relation tables/foreign keys; no caller-controlled SQL.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableClient = (admin as any).from(join.table);
        const { error } = await tableClient.upsert(rows, {
          onConflict: join.key + ",tag_id", ignoreDuplicates: true,
        });
        if (error) throw new Error(error.message);
      }
    }

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "import_content_organized",
      entity_type: "import_job",
      entity_id: data.jobId,
      summary: "Teacher organized committed imported content",
      details: {
        item_count: unique.length, catalog_id: data.catalogId,
        tag_names: names, item_types: data.kinds,
        page_from: data.pageFrom, page_to: data.pageTo,
      },
    });
    return { matched: unique.length, catalogId: data.catalogId, tagCount: tagIds.length };
  });
