import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

const PAGE_SIZE = 40;

const baseContentSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
  learning_language: z.string().trim().min(2).max(10).nullable().default(null),
  level: z.string().max(20).nullable().default(null),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  topicIds: z.array(z.string().uuid()).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
});

async function syncTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  relationTable: "reading_tags" | "listening_tags",
  ownerColumn: "reading_id" | "listening_id",
  ownerId: string,
  names: string[],
) {
  const tags = [...new Set(names.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  await sb.from(relationTable).delete().eq(ownerColumn, ownerId);
  if (!tags.length) return;

  const { error: upsertError } = await sb.from("tags").upsert(
    tags.map((name) => ({ name })),
    { onConflict: "name", ignoreDuplicates: true },
  );
  if (upsertError) throw new Error(upsertError.message);

  const { data: rows, error: selectError } = await sb.from("tags").select("id,name").in("name", tags);
  if (selectError) throw new Error(selectError.message);
  if (rows?.length) {
    const { error } = await sb.from(relationTable).insert(
      rows.map((row: { id: string }) => ({
        [ownerColumn]: ownerId,
        tag_id: row.id,
      })),
    );
    if (error) throw new Error(error.message);
  }
}

async function syncTopics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  relationTable: "reading_topics" | "listening_topics",
  ownerColumn: "reading_id" | "listening_id",
  ownerId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  await sb.from(relationTable).delete().eq(ownerColumn, ownerId);
  if (!unique.length) return;
  const { error } = await sb.from(relationTable).insert(
    unique.map((topicId) => ({
      [ownerColumn]: ownerId,
      topic_id: topicId,
    })),
  );
  if (error) throw new Error(error.message);
}

// -------------------- Readings --------------------

export const listReadings = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        language: z.string().max(10).default(""),
        level: z.string().max(20).default(""),
        status: z.enum(["active", "draft", "archived", "all"]).default("active"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("readings")
      .select("id,title,learning_language,level,word_count,display_layout,status,updated_at,reading_question_sets(count)", {
        count: "exact",
      })
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.language) q = q.eq("learning_language", data.language);
    if (data.level) q = q.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      q = q.ilike("title", `%${safe}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        learning_language: row.learning_language,
        level: row.level,
        word_count: row.word_count,
        display_layout: row.display_layout,
        status: row.status,
        updated_at: row.updated_at,
        questionSets: (row.reading_question_sets as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const getReading = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("readings")
      .select(
        "id,title,body,learning_language,level,word_count,display_layout,status,metadata,reading_topics(topic_id),reading_tags(tags(name)),reading_question_sets(id,title,instructions,sort_order)",
      )
      .eq("id", data.id)
      .is("deleted_at", null)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Reading not found.");

    const typed = row as unknown as {
      id: string;
      title: string;
      body: string;
      learning_language: string | null;
      level: string | null;
      word_count: number | null;
      display_layout: string;
      status: "active" | "draft" | "archived";
      metadata: Record<string, unknown>;
      reading_topics: Array<{ topic_id: string }>;
      reading_tags: Array<{ tags: { name: string } }>;
      reading_question_sets: Array<{ id: string; title: string | null; instructions: string | null; sort_order: number }>;
    };

    return {
      ...typed,
      topicIds: typed.reading_topics.map((x) => x.topic_id),
      tags: typed.reading_tags.map((x) => x.tags.name),
      questionSets: typed.reading_question_sets.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

export const saveReading = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    baseContentSchema
      .extend({
        body: z.string().max(250_000).default(""),
        display_layout: z.enum(["stacked", "split", "tabbed"]).default("stacked"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { topicIds, tags, id: existingId, ...input } = data;
    const body = input.body.trim();
    const core = {
      title: input.title,
      body,
      learning_language: input.learning_language,
      level: input.level,
      display_layout: input.display_layout,
      status: input.status,
      word_count: body ? body.split(/\s+/).filter(Boolean).length : 0,
    };

    let id = existingId;
    if (id) {
      const { error } = await context.supabase.from("readings").update(core).eq("id", id).is("deleted_at", null);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await context.supabase.from("readings").insert(core).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "Could not create reading.");
      id = created.id;
    }

    await syncTopics(context.supabase, "reading_topics", "reading_id", id, topicIds);
    await syncTags(context.supabase, "reading_tags", "reading_id", id, tags);

    const { adminClient, audit } = await import("./security.server");
    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: existingId ? "reading_updated" : "reading_created",
      entity_type: "reading",
      entity_id: id,
      summary: `${existingId ? "Updated" : "Created"} reading "${input.title}"`,
    });

    return { id };
  });

export const saveReadingQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        readingId: z.string().uuid(),
        title: z.string().max(300).nullable().default(null),
        instructions: z.string().max(5_000).nullable().default(null),
        sort_order: z.number().int().min(0).max(10_000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const core = {
      reading_id: data.readingId,
      title: data.title || null,
      instructions: data.instructions || null,
      sort_order: data.sort_order,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("reading_question_sets")
        .update(core)
        .eq("id", data.id)
        .eq("reading_id", data.readingId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("reading_question_sets")
      .insert(core)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create question set.");
    return { id: row.id };
  });

// -------------------- Listenings --------------------

export const listListenings = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        language: z.string().max(10).default(""),
        level: z.string().max(20).default(""),
        status: z.enum(["active", "draft", "archived", "all"]).default("active"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("listenings")
      .select("id,title,learning_language,level,status,media_id,transcript_source,updated_at,listening_sections(count),listening_question_sets(count)", {
        count: "exact",
      })
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.language) q = q.eq("learning_language", data.language);
    if (data.level) q = q.eq("level", data.level);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      q = q.ilike("title", `%${safe}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        learning_language: row.learning_language,
        level: row.level,
        status: row.status,
        media_id: row.media_id,
        transcript_source: row.transcript_source,
        updated_at: row.updated_at,
        sections: (row.listening_sections as unknown as Array<{ count: number }>)[0]?.count ?? 0,
        questionSets: (row.listening_question_sets as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    };
  });

export const getListening = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("listenings")
      .select(
        "id,title,media_id,transcript,transcript_segments,transcript_source,learning_language,level,playback_rules,status,metadata,media_assets(id,kind,original_filename,mime_type),listening_topics(topic_id),listening_tags(tags(name)),listening_sections(id,title,start_seconds,end_seconds,sort_order),listening_question_sets(id,section_id,title,instructions,sort_order)",
      )
      .eq("id", data.id)
      .is("deleted_at", null)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Listening not found.");

    const typed = row as unknown as {
      id: string;
      title: string;
      media_id: string | null;
      transcript: string | null;
      transcript_segments: unknown;
      transcript_source: string | null;
      learning_language: string | null;
      level: string | null;
      playback_rules: Record<string, unknown>;
      status: "active" | "draft" | "archived";
      metadata: Record<string, unknown>;
      media_assets: {
        id: string;
        kind: string;
        original_filename: string | null;
        mime_type: string | null;
      } | null;
      listening_topics: Array<{ topic_id: string }>;
      listening_tags: Array<{ tags: { name: string } }>;
      listening_sections: Array<{
        id: string;
        title: string | null;
        start_seconds: number | null;
        end_seconds: number | null;
        sort_order: number;
      }>;
      listening_question_sets: Array<{
        id: string;
        section_id: string | null;
        title: string | null;
        instructions: string | null;
        sort_order: number;
      }>;
    };

    return {
      ...typed,
      media: typed.media_assets,
      topicIds: typed.listening_topics.map((x) => x.topic_id),
      tags: typed.listening_tags.map((x) => x.tags.name),
      sections: typed.listening_sections.sort((a, b) => a.sort_order - b.sort_order),
      questionSets: typed.listening_question_sets.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

export const saveListening = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    baseContentSchema
      .extend({
        media_id: z.string().uuid().nullable().default(null),
        transcript: z.string().max(500_000).nullable().default(null),
        transcript_source: z.enum(["none", "manual", "imported", "auto"]).nullable().default("none"),
        playback_rules: z
          .object({
            max_plays: z.number().int().min(1).max(100).nullable().default(null),
            allow_pause: z.boolean().default(true),
            allow_seek: z.boolean().default(true),
            allow_rewind: z.boolean().default(true),
            show_transcript: z.boolean().default(false),
          })
          .default({
            max_plays: null,
            allow_pause: true,
            allow_seek: true,
            allow_rewind: true,
            show_transcript: false,
          }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { topicIds, tags, id: existingId, ...input } = data;
    const core = {
      title: input.title,
      media_id: input.media_id,
      transcript: input.transcript || null,
      transcript_source: input.transcript_source,
      learning_language: input.learning_language,
      level: input.level,
      playback_rules: input.playback_rules,
      status: input.status,
    };

    let id = existingId;
    if (id) {
      const { error } = await context.supabase.from("listenings").update(core as never).eq("id", id).is("deleted_at", null);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await context.supabase
        .from("listenings")
        .insert(core as never)
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Could not create listening.");
      id = created.id;
    }

    await syncTopics(context.supabase, "listening_topics", "listening_id", id, topicIds);
    await syncTags(context.supabase, "listening_tags", "listening_id", id, tags);

    const { adminClient, audit } = await import("./security.server");
    await audit(await adminClient(), {
      actor_type: "teacher",
      actor_id: context.userId,
      action: existingId ? "listening_updated" : "listening_created",
      entity_type: "listening",
      entity_id: id,
      summary: `${existingId ? "Updated" : "Created"} listening "${input.title}"`,
    });

    return { id };
  });

export const saveListeningSection = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        listeningId: z.string().uuid(),
        title: z.string().max(300).nullable().default(null),
        start_seconds: z.number().min(0).nullable().default(null),
        end_seconds: z.number().min(0).nullable().default(null),
        sort_order: z.number().int().min(0).max(10_000).default(0),
      })
      .superRefine((value, ctx) => {
        if (
          value.start_seconds != null &&
          value.end_seconds != null &&
          value.end_seconds <= value.start_seconds
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["end_seconds"],
            message: "End time must be after start time.",
          });
        }
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const core = {
      listening_id: data.listeningId,
      title: data.title || null,
      start_seconds: data.start_seconds,
      end_seconds: data.end_seconds,
      sort_order: data.sort_order,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("listening_sections")
        .update(core)
        .eq("id", data.id)
        .eq("listening_id", data.listeningId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("listening_sections")
      .insert(core)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create listening section.");
    return { id: row.id };
  });

export const saveListeningQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        listeningId: z.string().uuid(),
        section_id: z.string().uuid().nullable().default(null),
        title: z.string().max(300).nullable().default(null),
        instructions: z.string().max(5_000).nullable().default(null),
        sort_order: z.number().int().min(0).max(10_000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const core = {
      listening_id: data.listeningId,
      section_id: data.section_id,
      title: data.title || null,
      instructions: data.instructions || null,
      sort_order: data.sort_order,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("listening_question_sets")
        .update(core)
        .eq("id", data.id)
        .eq("listening_id", data.listeningId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("listening_question_sets")
      .insert(core)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create question set.");
    return { id: row.id };
  });

// -------------------- Context question linking --------------------

export const listContextQuestions = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["reading", "listening"]),
        questionSetId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const column = data.kind === "reading" ? "reading_question_set_id" : "listening_question_set_id";
    const { data: rows, error } = await context.supabase
      .from("questions")
      .select("id,question_type,prompt,status,current_version,context_sort,reusable_independently")
      .eq(column, data.questionSetId)
      .is("deleted_at", null)
      .order("context_sort");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const linkQuestionToContext = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        questionId: z.string().uuid(),
        kind: z.enum(["reading", "listening"]),
        questionSetId: z.string().uuid(),
        sort_order: z.number().int().min(0).max(10_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const table =
      data.kind === "reading"
        ? "reading_question_sets"
        : "listening_question_sets";
    const { data: target, error: targetError } = await context.supabase
      .from(table)
      .select("id")
      .eq("id", data.questionSetId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Question set was not found.");

    const column =
      data.kind === "reading"
        ? "reading_question_set_id"
        : "listening_question_set_id";
    let sortOrder = data.sort_order;
    if (sortOrder == null) {
      const { data: last, error: lastError } = await context.supabase
        .from("questions")
        .select("context_sort")
        .eq(column, data.questionSetId)
        .is("deleted_at", null)
        .order("context_sort", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw new Error(lastError.message);
      sortOrder = Number(last?.context_sort ?? -1) + 1;
    }

    const patch =
      data.kind === "reading"
        ? {
            context_kind: "reading" as const,
            reading_question_set_id: data.questionSetId,
            listening_question_set_id: null,
            context_sort: sortOrder,
          }
        : {
            context_kind: "listening" as const,
            reading_question_set_id: null,
            listening_question_set_id: data.questionSetId,
            context_sort: sortOrder,
          };

    const { error } = await context.supabase
      .from("questions")
      .update(patch)
      .eq("id", data.questionId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unlinkQuestionFromContext = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ questionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: question, error: questionError } = await context.supabase
      .from("questions")
      .select("id,status,reusable_independently")
      .eq("id", data.questionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (questionError) throw new Error(questionError.message);
    if (!question) throw new Error("Question was not found.");

    const { error } = await context.supabase
      .from("questions")
      .update({
        context_kind: "none",
        reading_question_set_id: null,
        listening_question_set_id: null,
        context_sort: 0,
        ...(!question.reusable_independently && question.status === "active"
          ? { status: "draft" as const }
          : {}),
      })
      .eq("id", data.questionId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const searchContextQuestionCandidates = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).default(""),
        type: z.string().max(60).default(""),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 40;
    let query = context.supabase
      .from("questions")
      .select(
        "id,question_type,prompt,status,level,learning_language,context_kind,reading_question_set_id,listening_question_set_id",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.type) query = query.eq("question_type", data.type);
    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[%,()]/g, " ");
      query = query.ilike("prompt", `%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize,
    };
  });

export const reorderContextQuestions = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["reading", "listening"]),
        questionSetId: z.string().uuid(),
        questionIds: z.array(z.string().uuid()).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const column =
      data.kind === "reading"
        ? "reading_question_set_id"
        : "listening_question_set_id";
    const { data: rows, error } = await context.supabase
      .from("questions")
      .select("id")
      .eq(column, data.questionSetId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const current = new Set((rows ?? []).map((row) => row.id));
    const requested = new Set(data.questionIds);
    if (
      current.size !== requested.size ||
      [...current].some((id) => !requested.has(id))
    ) {
      throw new Error("Question order does not match the question set.");
    }

    for (let index = 0; index < data.questionIds.length; index += 1) {
      const { error: updateError } = await context.supabase
        .from("questions")
        .update({ context_sort: index })
        .eq("id", data.questionIds[index]!)
        .eq(column, data.questionSetId);
      if (updateError) throw new Error(updateError.message);
    }

    return { ok: true };
  });

export const deleteContextQuestionSet = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["reading", "listening"]),
        id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const table =
      data.kind === "reading"
        ? "reading_question_sets"
        : "listening_question_sets";
    const column =
      data.kind === "reading"
        ? "reading_question_set_id"
        : "listening_question_set_id";

    const { data: linkedQuestions, error: linkedQuestionsError } =
      await context.supabase
        .from("questions")
        .select("id,status,reusable_independently")
        .eq(column, data.id)
        .is("deleted_at", null);
    if (linkedQuestionsError) {
      throw new Error(linkedQuestionsError.message);
    }

    const { error: unlinkError } = await context.supabase
      .from("questions")
      .update({
        context_kind: "none",
        reading_question_set_id: null,
        listening_question_set_id: null,
        context_sort: 0,
      })
      .eq(column, data.id)
      .is("deleted_at", null);
    if (unlinkError) throw new Error(unlinkError.message);

    const idsToDraft = (linkedQuestions ?? [])
      .filter(
        (question) =>
          !question.reusable_independently && question.status === "active",
      )
      .map((question) => question.id);
    if (idsToDraft.length) {
      const { error: draftError } = await context.supabase
        .from("questions")
        .update({ status: "draft" })
        .in("id", idsToDraft);
      if (draftError) throw new Error(draftError.message);
    }

    const { error } = await context.supabase
      .from(table)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteListeningSection = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      listeningId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("listening_sections")
      .delete()
      .eq("id", data.id)
      .eq("listening_id", data.listeningId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
