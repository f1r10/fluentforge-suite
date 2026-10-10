import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

export const CATALOG_ITEM_TYPES = ["question", "vocabulary", "reading", "listening"] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];

const catalogSettingsSchema = z
  .object({
    shuffle_questions: z.boolean().default(true),
    shuffle_vocabulary: z.boolean().default(true),
    preserve_context: z.literal(true).default(true),
    feedback_mode: z.enum(["instant", "end"]).default("instant"),
    show_explanations: z.boolean().default(true),
    allow_self_practice: z.boolean().default(true),
  })
  .default({
    shuffle_questions: true,
    shuffle_vocabulary: true,
    preserve_context: true,
    feedback_mode: "instant",
    show_explanations: true,
    allow_self_practice: true,
  });

export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;

const catalogInputSchema = z.object({
  id: z.string().uuid().optional(),
  parent_id: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).nullable().default(null),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  settings: catalogSettingsSchema,
});

export type CatalogInput = z.infer<typeof catalogInputSchema>;

type CatalogResolvedItem = {
  id: string;
  entity_type: CatalogItemType;
  entity_id: string;
  sort_order: number;
  title: string;
  subtitle: string | null;
  language: string | null;
  level: string | null;
  status: string;
  available: boolean;
};

function defaultSettings(value: unknown): CatalogSettings {
  const parsed = catalogSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : catalogSettingsSchema.parse({});
}

export const listCatalogsDetailed = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("catalogs")
      .select("id,parent_id,name,description,status,settings,sort_order,updated_at,catalog_items(count),catalog_assignments(count)")
      .is("deleted_at", null)
      .order("sort_order")
      .order("name");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      name: row.name,
      description: row.description,
      status: row.status,
      settings: defaultSettings(row.settings),
      sort_order: row.sort_order,
      updated_at: row.updated_at,
      items: (row.catalog_items as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      assignments: (row.catalog_assignments as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    }));
  });

export const saveCatalog = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => catalogInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.id && data.parent_id === data.id) {
      throw new Error("A catalog cannot be its own parent.");
    }

    if (data.parent_id) {
      const { data: parent, error: parentError } = await context.supabase
        .from("catalogs")
        .select("id,status")
        .eq("id", data.parent_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (parentError) throw new Error(parentError.message);
      if (!parent) throw new Error("Parent catalog was not found.");
      if (parent.status === "archived") throw new Error("An archived catalog cannot be used as a parent.");
    }

    const core = {
      parent_id: data.parent_id,
      name: data.name,
      description: data.description || null,
      status: data.status,
      settings: data.settings,
    };

    let id = data.id;
    if (id) {
      const { error } = await context.supabase
        .from("catalogs")
        .update(core as never)
        .eq("id", id)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
    } else {
      const { data: last } = await context.supabase
        .from("catalogs")
        .select("sort_order")
        .eq("parent_id", data.parent_id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: created, error } = await context.supabase
        .from("catalogs")
        .insert({ ...core, sort_order: (last?.sort_order ?? -1) + 1 } as never)
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Could not create catalog.");
      id = created.id;
    }

    const { adminClient, audit } = await import("./security.server");
    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: data.id ? "catalog_updated" : "catalog_created",
      entity_type: "catalog",
      entity_id: id,
      summary: `${data.id ? "Updated" : "Created"} catalog "${data.name}"`,
    });

    return { id };
  });

export const getCatalog = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: catalog, error } = await context.supabase
      .from("catalogs")
      .select("id,parent_id,name,description,status,settings,sort_order,updated_at")
      .eq("id", data.id)
      .is("deleted_at", null)
      .single();
    if (error || !catalog) throw new Error(error?.message ?? "Catalog not found.");

    const { data: rawItems, error: itemsError } = await context.supabase
      .from("catalog_items")
      .select("id,entity_type,entity_id,sort_order")
      .eq("catalog_id", data.id)
      .order("sort_order")
      .order("created_at");
    if (itemsError) throw new Error(itemsError.message);

    const items = (rawItems ?? []) as Array<{
      id: string;
      entity_type: CatalogItemType;
      entity_id: string;
      sort_order: number;
    }>;

    const questionIds = items.filter((x) => x.entity_type === "question").map((x) => x.entity_id);
    const vocabularyIds = items.filter((x) => x.entity_type === "vocabulary").map((x) => x.entity_id);
    const readingIds = items.filter((x) => x.entity_type === "reading").map((x) => x.entity_id);
    const listeningIds = items.filter((x) => x.entity_type === "listening").map((x) => x.entity_id);

    const [questions, vocabulary, readings, listenings, assignments] = await Promise.all([
      questionIds.length
        ? context.supabase
            .from("questions")
            .select("id,prompt,question_type,learning_language,level,status,deleted_at")
            .in("id", questionIds)
        : Promise.resolve({ data: [], error: null }),
      vocabularyIds.length
        ? context.supabase
            .from("vocabulary_entries")
            .select("id,word,part_of_speech,learning_language,level,status,deleted_at")
            .in("id", vocabularyIds)
        : Promise.resolve({ data: [], error: null }),
      readingIds.length
        ? context.supabase
            .from("readings")
            .select("id,title,learning_language,level,status,deleted_at")
            .in("id", readingIds)
        : Promise.resolve({ data: [], error: null }),
      listeningIds.length
        ? context.supabase
            .from("listenings")
            .select("id,title,learning_language,level,status,deleted_at")
            .in("id", listeningIds)
        : Promise.resolve({ data: [], error: null }),
      context.supabase
        .from("catalog_assignments")
        .select("id,group_id,student_id,groups(id,name),students(id,first_name,last_name,username,status)")
        .eq("catalog_id", data.id)
        .order("created_at"),
    ]);

    for (const result of [questions, vocabulary, readings, listenings, assignments]) {
      if (result.error) throw new Error(result.error.message);
    }

    const questionMap = new Map((questions.data ?? []).map((x) => [x.id, x]));
    const vocabularyMap = new Map((vocabulary.data ?? []).map((x) => [x.id, x]));
    const readingMap = new Map((readings.data ?? []).map((x) => [x.id, x]));
    const listeningMap = new Map((listenings.data ?? []).map((x) => [x.id, x]));

    const resolvedItems: CatalogResolvedItem[] = items.map((item) => {
      if (item.entity_type === "question") {
        const entity = questionMap.get(item.entity_id);
        return {
          ...item,
          title: entity?.prompt ?? "Unavailable question",
          subtitle: entity?.question_type ?? null,
          language: entity?.learning_language ?? null,
          level: entity?.level ?? null,
          status: entity?.status ?? "missing",
          available: !!entity && !entity.deleted_at,
        };
      }
      if (item.entity_type === "vocabulary") {
        const entity = vocabularyMap.get(item.entity_id);
        return {
          ...item,
          title: entity?.word ?? "Unavailable vocabulary",
          subtitle: entity?.part_of_speech ?? null,
          language: entity?.learning_language ?? null,
          level: entity?.level ?? null,
          status: entity?.status ?? "missing",
          available: !!entity && !entity.deleted_at,
        };
      }
      if (item.entity_type === "reading") {
        const entity = readingMap.get(item.entity_id);
        return {
          ...item,
          title: entity?.title ?? "Unavailable reading",
          subtitle: null,
          language: entity?.learning_language ?? null,
          level: entity?.level ?? null,
          status: entity?.status ?? "missing",
          available: !!entity && !entity.deleted_at,
        };
      }
      const entity = listeningMap.get(item.entity_id);
      return {
        ...item,
        title: entity?.title ?? "Unavailable listening",
        subtitle: null,
        language: entity?.learning_language ?? null,
        level: entity?.level ?? null,
        status: entity?.status ?? "missing",
        available: !!entity && !entity.deleted_at,
      };
    });

    const typedAssignments = (assignments.data ?? []) as unknown as Array<{
      id: string;
      group_id: string | null;
      student_id: string | null;
      groups: { id: string; name: string } | null;
      students: {
        id: string;
        first_name: string;
        last_name: string;
        username: string;
        status: string;
      } | null;
    }>;

    return {
      id: catalog.id,
      parent_id: catalog.parent_id,
      name: catalog.name,
      description: catalog.description,
      status: catalog.status,
      settings: defaultSettings(catalog.settings),
      sort_order: catalog.sort_order,
      updated_at: catalog.updated_at,
      items: resolvedItems,
      assignments: typedAssignments.map((assignment) => ({
        id: assignment.id,
        type: assignment.group_id ? ("group" as const) : ("student" as const),
        targetId: assignment.group_id ?? assignment.student_id!,
        label: assignment.groups
          ? assignment.groups.name
          : assignment.students
            ? `${assignment.students.first_name} ${assignment.students.last_name}`
            : "Unavailable target",
        secondary: assignment.students?.username ?? null,
        status: assignment.students?.status ?? null,
      })),
    };
  });

async function ensureCatalogExists(
  context: { supabase: Parameters<typeof validateEntities>[0] },
  catalogId: string,
) {
  const { data, error } = await context.supabase
    .from("catalogs")
    .select("id")
    .eq("id", catalogId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog not found.");
}

async function validateEntities(
  // The concrete client type is intentionally inferred by callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  items: Array<{ entity_type: CatalogItemType; entity_id: string }>,
) {
  const grouped = {
    question: items.filter((x) => x.entity_type === "question").map((x) => x.entity_id),
    vocabulary: items.filter((x) => x.entity_type === "vocabulary").map((x) => x.entity_id),
    reading: items.filter((x) => x.entity_type === "reading").map((x) => x.entity_id),
    listening: items.filter((x) => x.entity_type === "listening").map((x) => x.entity_id),
  };

  if (grouped.question.length) {
    const { data, error } = await sb
      .from("questions")
      .select("id,context_kind")
      .in("id", [...new Set(grouped.question)])
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== new Set(grouped.question).size) throw new Error("One or more questions no longer exist.");
    if ((data ?? []).some((q: { context_kind: string }) => q.context_kind !== "none")) {
      throw new Error("Context-bound questions must be added through their reading or listening.");
    }
  }

  const checks: Array<[CatalogItemType, string[], string]> = [
    ["vocabulary", grouped.vocabulary, "vocabulary_entries"],
    ["reading", grouped.reading, "readings"],
    ["listening", grouped.listening, "listenings"],
  ];

  for (const [, ids, table] of checks) {
    if (!ids.length) continue;
    const unique = [...new Set(ids)];
    const { data, error } = await sb.from(table).select("id").in("id", unique).is("deleted_at", null);
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== unique.length) throw new Error("One or more selected content items no longer exist.");
  }
}

export const addCatalogItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        items: z
          .array(
            z.object({
              entity_type: z.enum(CATALOG_ITEM_TYPES),
              entity_id: z.string().uuid(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCatalogExists(context as never, data.catalogId);
    const unique = Array.from(
      new Map(data.items.map((item) => [`${item.entity_type}:${item.entity_id}`, item])).values(),
    );
    await validateEntities(context.supabase, unique);

    const { data: last, error: lastError } = await context.supabase
      .from("catalog_items")
      .select("sort_order")
      .eq("catalog_id", data.catalogId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw new Error(lastError.message);

    const start = (last?.sort_order ?? -1) + 1;
    const { error } = await context.supabase.from("catalog_items").upsert(
      unique.map((item, index) => ({
        catalog_id: data.catalogId,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        sort_order: start + index,
      })),
      {
        onConflict: "catalog_id,entity_type,entity_id",
        ignoreDuplicates: true,
      },
    );
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const removeCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ catalogId: z.string().uuid(), itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("catalog_items")
      .delete()
      .eq("id", data.itemId)
      .eq("catalog_id", data.catalogId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderCatalogItems = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        itemIds: z.array(z.string().uuid()).max(2_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reorder_catalog_items", {
      p_catalog_id: data.catalogId,
      p_item_ids: data.itemIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchCatalogContent = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        search: z.string().max(200).default(""),
        type: z.enum(["all", ...CATALOG_ITEM_TYPES]).default("all"),
        language: z.string().trim().max(10).default(""),
        level: z.string().trim().max(20).default(""),
        subtype: z.string().trim().max(100).default(""),
        topicId: z.string().uuid().nullable().default(null),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const safe = data.search.trim().replace(/[,()%]/g, " ");
    const { data: existing, error: existingError } = await context.supabase
      .from("catalog_items")
      .select("entity_type,entity_id")
      .eq("catalog_id", data.catalogId);
    if (existingError) throw new Error(existingError.message);
    const inCatalog = new Set((existing ?? []).map((x) => `${x.entity_type}:${x.entity_id}`));

    const topicMatches = new Map<CatalogItemType, Set<string>>();
    if (data.topicId) {
      if (data.type === "all" || data.type === "question") {
        const { data: rows, error } = await context.supabase
          .from("question_topics")
          .select("question_id")
          .eq("topic_id", data.topicId);
        if (error) throw new Error(error.message);
        topicMatches.set("question", new Set((rows ?? []).map((row) => row.question_id)));
      }
      if (data.type === "all" || data.type === "vocabulary") {
        const { data: rows, error } = await context.supabase
          .from("vocabulary_topics")
          .select("entry_id")
          .eq("topic_id", data.topicId);
        if (error) throw new Error(error.message);
        topicMatches.set("vocabulary", new Set((rows ?? []).map((row) => row.entry_id)));
      }
      if (data.type === "all" || data.type === "reading") {
        const { data: rows, error } = await context.supabase
          .from("reading_topics")
          .select("reading_id")
          .eq("topic_id", data.topicId);
        if (error) throw new Error(error.message);
        topicMatches.set("reading", new Set((rows ?? []).map((row) => row.reading_id)));
      }
      if (data.type === "all" || data.type === "listening") {
        const { data: rows, error } = await context.supabase
          .from("listening_topics")
          .select("listening_id")
          .eq("topic_id", data.topicId);
        if (error) throw new Error(error.message);
        topicMatches.set("listening", new Set((rows ?? []).map((row) => row.listening_id)));
      }
    }

    const results: Array<{
      entity_type: CatalogItemType;
      entity_id: string;
      title: string;
      subtitle: string | null;
      language: string | null;
      level: string | null;
      status: string;
      inCatalog: boolean;
    }> = [];

    if (data.type === "all" || data.type === "question") {
      const topicIds = topicMatches.get("question");
      if (!data.topicId || (topicIds && topicIds.size > 0)) {
        let q = context.supabase
          .from("questions")
          .select("id,prompt,question_type,learning_language,level,status,context_kind")
          .is("deleted_at", null)
          .neq("status", "archived")
          .eq("context_kind", "none")
          .order("updated_at", { ascending: false })
          .limit(data.type === "all" ? 12 : 500);
        if (safe) q = q.ilike("prompt", `%${safe}%`);
        if (data.language) q = q.eq("learning_language", data.language);
        if (data.level) q = q.eq("level", data.level);
        if (data.type === "question" && data.subtype) {
          q = q.eq("question_type", data.subtype);
        }
        if (topicIds) q = q.in("id", [...topicIds]);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          results.push({
            entity_type: "question",
            entity_id: row.id,
            title: row.prompt,
            subtitle: row.question_type,
            language: row.learning_language,
            level: row.level,
            status: row.status,
            inCatalog: inCatalog.has(`question:${row.id}`),
          });
        }
      }
    }

    if (data.type === "all" || data.type === "vocabulary") {
      const topicIds = topicMatches.get("vocabulary");
      if (!data.topicId || (topicIds && topicIds.size > 0)) {
        let q = context.supabase
          .from("vocabulary_entries")
          .select("id,word,part_of_speech,learning_language,level,status")
          .is("deleted_at", null)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(data.type === "all" ? 12 : 500);
        if (safe) q = q.ilike("word", `%${safe}%`);
        if (data.language) q = q.eq("learning_language", data.language);
        if (data.level) q = q.eq("level", data.level);
        if (data.type === "vocabulary" && data.subtype) {
          q = q.eq("part_of_speech", data.subtype);
        }
        if (topicIds) q = q.in("id", [...topicIds]);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          results.push({
            entity_type: "vocabulary",
            entity_id: row.id,
            title: row.word,
            subtitle: row.part_of_speech,
            language: row.learning_language,
            level: row.level,
            status: row.status,
            inCatalog: inCatalog.has(`vocabulary:${row.id}`),
          });
        }
      }
    }

    if (data.type === "all" || data.type === "reading") {
      const topicIds = topicMatches.get("reading");
      if (!data.topicId || (topicIds && topicIds.size > 0)) {
        let q = context.supabase
          .from("readings")
          .select("id,title,learning_language,level,status")
          .is("deleted_at", null)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(data.type === "all" ? 12 : 500);
        if (safe) q = q.ilike("title", `%${safe}%`);
        if (data.language) q = q.eq("learning_language", data.language);
        if (data.level) q = q.eq("level", data.level);
        if (topicIds) q = q.in("id", [...topicIds]);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          results.push({
            entity_type: "reading",
            entity_id: row.id,
            title: row.title,
            subtitle: null,
            language: row.learning_language,
            level: row.level,
            status: row.status,
            inCatalog: inCatalog.has(`reading:${row.id}`),
          });
        }
      }
    }

    if (data.type === "all" || data.type === "listening") {
      const topicIds = topicMatches.get("listening");
      if (!data.topicId || (topicIds && topicIds.size > 0)) {
        let q = context.supabase
          .from("listenings")
          .select("id,title,learning_language,level,status")
          .is("deleted_at", null)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(data.type === "all" ? 12 : 500);
        if (safe) q = q.ilike("title", `%${safe}%`);
        if (data.language) q = q.eq("learning_language", data.language);
        if (data.level) q = q.eq("level", data.level);
        if (topicIds) q = q.in("id", [...topicIds]);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const row of rows ?? []) {
          results.push({
            entity_type: "listening",
            entity_id: row.id,
            title: row.title,
            subtitle: null,
            language: row.learning_language,
            level: row.level,
            status: row.status,
            inCatalog: inCatalog.has(`listening:${row.id}`),
          });
        }
      }
    }

    return results;
  });

export const searchCatalogAssignmentTargets = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        kind: z.enum(["group", "student"]),
        search: z.string().max(120).default(""),
        page: z.number().int().min(0).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 40;
    const { data: existing, error: existingError } = await context.supabase
      .from("catalog_assignments")
      .select("group_id,student_id")
      .eq("catalog_id", data.catalogId);
    if (existingError) throw new Error(existingError.message);
    const assigned = new Set(
      (existing ?? [])
        .map((x) => (data.kind === "group" ? x.group_id : x.student_id))
        .filter((x): x is string => !!x),
    );

    if (data.kind === "group") {
      let q = context.supabase
        .from("groups")
        .select("id,name,description", { count: "exact" })
        .is("deleted_at", null)
        .order("name")
        .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
      if (data.search.trim()) {
        const safe = data.search.trim().replace(/[,()%]/g, " ");
        q = q.ilike("name", `%${safe}%`);
      }
      const { data: rows, count, error } = await q;
      if (error) throw new Error(error.message);
      return {
        rows: (rows ?? []).map((x) => ({
          id: x.id,
          label: x.name,
          secondary: x.description,
          assigned: assigned.has(x.id),
        })),
        total: count ?? 0,
        pageSize,
      };
    }

    let q = context.supabase
      .from("students")
      .select("id,first_name,last_name,username,status", { count: "exact" })
      .is("deleted_at", null)
      .neq("status", "archived")
      .order("last_name")
      .order("first_name")
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      q = q.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,username.ilike.%${safe}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((x) => ({
        id: x.id,
        label: `${x.first_name} ${x.last_name}`,
        secondary: x.username,
        status: x.status,
        assigned: assigned.has(x.id),
      })),
      total: count ?? 0,
      pageSize,
    };
  });

export const addCatalogAssignment = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        catalogId: z.string().uuid(),
        kind: z.enum(["group", "student"]),
        targetId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCatalogExists(context as never, data.catalogId);

    if (data.kind === "group") {
      const { data: target, error } = await context.supabase
        .from("groups")
        .select("id")
        .eq("id", data.targetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!target) throw new Error("Group not found.");

      const { data: existing, error: existingError } = await context.supabase
        .from("catalog_assignments")
        .select("id")
        .eq("catalog_id", data.catalogId)
        .eq("group_id", data.targetId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) {
        const { error: insertError } = await context.supabase
          .from("catalog_assignments")
          .insert({
            catalog_id: data.catalogId,
            group_id: data.targetId,
            student_id: null,
          });
        if (insertError) throw new Error(insertError.message);
      }
    } else {
      const { data: target, error } = await context.supabase
        .from("students")
        .select("id,status")
        .eq("id", data.targetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!target || target.status === "archived") throw new Error("Student not found.");

      const { data: existing, error: existingError } = await context.supabase
        .from("catalog_assignments")
        .select("id")
        .eq("catalog_id", data.catalogId)
        .eq("student_id", data.targetId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) {
        const { error: insertError } = await context.supabase
          .from("catalog_assignments")
          .insert({
            catalog_id: data.catalogId,
            group_id: null,
            student_id: data.targetId,
          });
        if (insertError) throw new Error(insertError.message);
      }
    }

    return { ok: true };
  });

export const removeCatalogAssignment = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ catalogId: z.string().uuid(), assignmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("catalog_assignments")
      .delete()
      .eq("id", data.assignmentId)
      .eq("catalog_id", data.catalogId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const trashCatalog = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { count, error: childError } = await context.supabase
      .from("catalogs")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", data.id)
      .is("deleted_at", null);
    if (childError) throw new Error(childError.message);
    if ((count ?? 0) > 0) {
      throw new Error("Move or delete child catalogs before deleting this catalog.");
    }

    const { error } = await context.supabase
      .from("catalogs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
