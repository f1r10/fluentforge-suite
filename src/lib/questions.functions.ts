import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { validateQuestionInput, type QuestionInput } from "./question-schema";

const PAGE = 50;

export const listQuestions = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({
      text: z.string().max(200).default(""),
      type: z.string().max(60).default(""),
      level: z.string().max(10).default(""),
      language: z.string().max(10).default(""),
      topicId: z.string().uuid().optional(),
      status: z.enum(["active", "draft", "archived", "all"]).default("active"),
      page: z.number().int().min(0).default(0),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("questions")
      .select("id, question_type, prompt, level, learning_language, status, current_version, updated_at, context_kind" + (data.topicId ? ", qt:question_topics!inner(topic_id)" : ""), { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.type) q = q.eq("question_type", data.type);
    if (data.level) q = q.eq("level", data.level);
    if (data.language) q = q.eq("learning_language", data.language);
    if (data.topicId) q = q.eq("qt.topic_id", data.topicId);
    if (data.text.trim()) {
      const s = data.text.trim().replace(/[%,()]/g, " ");
      q = q.ilike("prompt", `%${s}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      pageSize: PAGE,
      rows: (rows ?? []) as unknown as { id: string; question_type: string; prompt: string; level: string | null; learning_language: string | null; status: string; current_version: number; updated_at: string; context_kind: string }[],
    };
  });

export const getQuestion = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: q, error } = await context.supabase
      .from("questions")
      .select("id, question_type, prompt, instructions, payload, answer_key, scoring, normalization, explanation, teacher_notes, learning_language, level, difficulty, grading_mode, status, current_version, reusable_independently, question_topics(topic_id), question_tags(tags(name))")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const { question_topics, question_tags, ...rest } = q;
    return {
      ...(rest as unknown as QuestionInput & { id: string; current_version: number }),
      topicIds: (question_topics ?? []).map((t) => t.topic_id),
      tags: ((question_tags ?? []) as unknown as { tags: { name: string } }[]).map((t) => t.tags.name),
    };
  });

const VERSIONED = ["question_type", "prompt", "instructions", "payload", "answer_key", "scoring", "normalization", "explanation", "grading_mode"] as const;

export const saveQuestion = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => validateQuestionInput(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sha256, adminClient, audit } = await import("./security.server");
    const { id, topicIds, tags, force, ...fields } = data;
    const content_hash = sha256(JSON.stringify([fields.question_type, fields.prompt.trim().toLowerCase().replace(/\s+/g, " "), fields.answer_key, fields.payload]));

    if (!force) {
      let dq = sb.from("questions").select("id, prompt").eq("content_hash", content_hash).is("deleted_at", null).limit(1);
      if (id) dq = dq.neq("id", id);
      const { data: dup } = await dq;
      if (dup && dup.length) return { duplicateOf: dup[0]!.id, id: null as string | null };
    }

    let qid = id;
    if (!id) {
      const { data: row, error } = await sb.from("questions").insert({ ...fields, content_hash, current_version: 1 } as never).select("id").single();
      if (error) throw new Error(error.message);
      qid = row.id;
      await sb.from("question_versions").insert({ question_id: qid!, version: 1, snapshot: fields as never });
    } else {
      const { data: prev } = await sb.from("questions").select("*").eq("id", id).single();
      if (!prev) throw new Error("Not found");
      const changed = VERSIONED.some((k) => JSON.stringify((prev as Record<string, unknown>)[k] ?? null) !== JSON.stringify(fields[k] ?? null));
      const version = changed ? prev.current_version + 1 : prev.current_version;
      const { error } = await sb.from("questions").update({ ...fields, content_hash, current_version: version } as never).eq("id", id);
      if (error) throw new Error(error.message);
      if (changed) {
        await sb.from("question_versions").insert({ question_id: id, version, snapshot: fields as never });
        await audit(await adminClient(), { actor_type: "teacher", actor_id: context.userId, action: "question_edited", entity_type: "question", entity_id: id, summary: `Question edited (version ${version})` });
      }
    }

    await sb.from("question_topics").delete().eq("question_id", qid!);
    if (topicIds.length) await sb.from("question_topics").insert(topicIds.map((t) => ({ question_id: qid!, topic_id: t })));
    await sb.from("question_tags").delete().eq("question_id", qid!);
    if (tags.length) {
      const unique = [...new Set(tags.map((t) => t.toLowerCase()))];
      await sb.from("tags").upsert(unique.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: true });
      const { data: tagRows } = await sb.from("tags").select("id").in("name", unique);
      if (tagRows?.length) await sb.from("question_tags").insert(tagRows.map((t) => ({ question_id: qid!, tag_id: t.id })));
    }
    return { id: qid!, duplicateOf: null as string | null };
  });

export const bulkQuestions = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({
      ids: z.array(z.string().uuid()).min(1).max(1000),
      action: z.enum(["archive", "activate", "trash", "add_topic", "add_to_catalog", "duplicate"]),
      topicId: z.string().uuid().optional(),
      catalogId: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { adminClient, audit } = await import("./security.server");
    switch (data.action) {
      case "archive":
      case "activate":
        await sb.from("questions").update({ status: data.action === "archive" ? "archived" : "active" }).in("id", data.ids);
        break;
      case "trash":
        await sb.from("questions").update({ deleted_at: new Date().toISOString() }).in("id", data.ids);
        await audit(await adminClient(), { actor_type: "teacher", actor_id: context.userId, action: "questions_trashed", entity_type: "question", summary: `${data.ids.length} question(s) moved to trash`, details: { ids: data.ids } });
        break;
      case "add_topic":
        if (!data.topicId) throw new Error("Choose a topic");
        await sb.from("question_topics").upsert(data.ids.map((id) => ({ question_id: id, topic_id: data.topicId! })), { ignoreDuplicates: true });
        break;
      case "add_to_catalog": {
        if (!data.catalogId) throw new Error("Choose a catalog");
        const { count } = await sb.from("catalog_items").select("id", { count: "exact", head: true }).eq("catalog_id", data.catalogId);
        await sb.from("catalog_items").upsert(
          data.ids.map((id, i) => ({ catalog_id: data.catalogId!, entity_type: "question", entity_id: id, sort_order: (count ?? 0) + i })),
          { onConflict: "catalog_id,entity_type,entity_id", ignoreDuplicates: true },
        );
        break;
      }
      case "duplicate": {
        const { data: src } = await sb.from("questions").select("question_type, prompt, instructions, payload, answer_key, scoring, normalization, explanation, teacher_notes, learning_language, level, difficulty, grading_mode, reusable_independently").in("id", data.ids);
        for (const q of src ?? []) {
          const { data: row } = await sb.from("questions").insert({ ...q, status: "draft", current_version: 1 }).select("id").single();
          if (row) await sb.from("question_versions").insert({ question_id: row.id, version: 1, snapshot: q as never });
        }
        break;
      }
    }
    return { ok: true };
  });

export const listQuestionVersions = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("question_versions").select("version, created_at, snapshot").eq("question_id", data.id).order("version", { ascending: false });
    return (rows ?? []) as unknown as { version: number; created_at: string; snapshot: { prompt: string; answer_key: Record<string, never> } }[];
  });

// ---------- Topics ----------
export const listTopics = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("topics").select("id, name, parent_id, sort_order").order("sort_order").order("name");
    return data ?? [];
  });

export const saveTopic = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), parent_id: z.string().uuid().nullable().default(null) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) await context.supabase.from("topics").update({ name: data.name, parent_id: data.parent_id }).eq("id", data.id);
    else {
      const { data: row, error } = await context.supabase.from("topics").insert({ name: data.name, parent_id: data.parent_id }).select("id").single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
    return { id: data.id };
  });

export const deleteTopic = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("topics").delete().eq("id", data.id);
    return { ok: true };
  });
