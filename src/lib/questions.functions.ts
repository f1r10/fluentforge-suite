import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { validateQuestionInput, type QuestionInput } from "./question-schema";
import {
  buildQuestionInputFromImportRow,
  type QuestionImportDefaults,
  type QuestionImportRow,
} from "./question-import";

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
      .eq("context_kind", "none")
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

export const getQuestionStudentPreview = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: row, error } = await admin
      .from("questions")
      .select(
        "id,question_type,prompt,instructions,payload,answer_key,scoring,grading_mode,current_version,learning_language,level",
      )
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Question not found.");

    const { hydrateQuestionMedia } = await import("./media.server");
    const { publicPracticeQuestion } = await import(
      "./student-library.functions"
    );
    const [hydrated] = await hydrateQuestionMedia(admin, [row], 60 * 60);
    if (!hydrated) throw new Error("Question not found.");
    return publicPracticeQuestion(hydrated as never);
  });

const VERSIONED = ["question_type", "prompt", "instructions", "payload", "answer_key", "scoring", "normalization", "explanation", "grading_mode"] as const;

export const saveQuestion = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => validateQuestionInput(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sha256, adminClient, audit } = await import("./security.server");
    const { id, topicIds, tags, force, ...fields } = data;

    const payloadMediaId =
      fields.payload && typeof fields.payload === "object" &&
      typeof (fields.payload as Record<string, unknown>)["media_id"] === "string"
        ? ((fields.payload as Record<string, unknown>)["media_id"] as string)
        : null;

    if (payloadMediaId) {
      const { data: media, error: mediaError } = await sb
        .from("media_assets")
        .select("id,kind")
        .eq("id", payloadMediaId)
        .is("deleted_at", null)
        .maybeSingle();
      if (mediaError) throw new Error(mediaError.message);
      if (!media) throw new Error("Selected media was not found.");

      if (
        ["image_labelling", "diagram_labelling", "map_labelling"].includes(
          fields.question_type,
        ) &&
        media.kind !== "image"
      ) {
        throw new Error("Visual labelling questions require image media.");
      }

      if (
        ["dictation", "listening_transcription"].includes(fields.question_type) &&
        !["audio", "video"].includes(media.kind)
      ) {
        throw new Error("Dictation and listening transcription require audio or video media.");
      }
    }

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


const importRowSchema = z.object({
  rowNumber: z.number().int().min(1).max(100_000),
  sourceSheet: z.string().max(200).nullable().optional(),
  values: z.record(z.string(), z.string().max(100_000)),
});

const importDefaultsSchema = z.object({
  question_type: z.string().min(1).max(60),
  learning_language: z.string().max(10).nullable(),
  level: z.string().max(20).nullable(),
  status: z.enum(["active", "draft", "archived"]),
  topicIds: z.array(z.string().uuid()).max(100),
  tags: z.array(z.string().trim().min(1).max(60)).max(100),
});

const importRequestSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  defaults: importDefaultsSchema,
  sourceFilename: z.string().max(255).nullable().default(null),
});

type PreparedImportRow = {
  row: QuestionImportRow;
  input: QuestionInput | null;
  hash: string | null;
  status: "valid" | "invalid" | "duplicate";
  reason: string | null;
  duplicateOf: string | null;
};

async function prepareQuestionImportRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  rows: QuestionImportRow[],
  defaults: QuestionImportDefaults,
) {
  const { sha256 } = await import("./security.server");
  const prepared: PreparedImportRow[] = rows.map((row) => {
    try {
      const input = validateQuestionInput(
        buildQuestionInputFromImportRow(row, defaults),
      );
      const hash = sha256(
        JSON.stringify([
          input.question_type,
          input.prompt.trim().toLowerCase().replace(/\s+/g, " "),
          input.answer_key,
          input.payload,
        ]),
      );
      return {
        row,
        input,
        hash,
        status: "valid" as const,
        reason: null,
        duplicateOf: null,
      };
    } catch (error) {
      const reason =
        error instanceof z.ZodError
          ? error.issues.map((issue) => issue.message).join(" · ")
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        row,
        input: null,
        hash: null,
        status: "invalid" as const,
        reason,
        duplicateOf: null,
      };
    }
  });

  const topicIds = [
    ...new Set(
      prepared
        .filter((item) => item.input)
        .flatMap((item) => item.input!.topicIds),
    ),
  ];
  const mediaIds = [
    ...new Set(
      prepared
        .map((item) => {
          const payload = item.input?.payload;
          return payload &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>)["media_id"] === "string"
            ? ((payload as Record<string, unknown>)["media_id"] as string)
            : null;
        })
        .filter((value): value is string => !!value),
    ),
  ];

  const [topicsResult, mediaResult] = await Promise.all([
    topicIds.length
      ? sb.from("topics").select("id").in("id", topicIds)
      : Promise.resolve({ data: [], error: null }),
    mediaIds.length
      ? sb
          .from("media_assets")
          .select("id,kind")
          .in("id", mediaIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (topicsResult.error) throw new Error(topicsResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  const validTopics = new Set((topicsResult.data ?? []).map((row: { id: string }) => row.id));
  const mediaById = new Map(
    (mediaResult.data ?? []).map((row: { id: string; kind: string }) => [
      row.id,
      row.kind,
    ]),
  );

  for (const item of prepared) {
    if (!item.input || item.status !== "valid") continue;

    const missingTopic = item.input.topicIds.find((id) => !validTopics.has(id));
    if (missingTopic) {
      item.status = "invalid";
      item.reason = `Topic ${missingTopic} was not found.`;
      continue;
    }

    const payload = item.input.payload as Record<string, unknown>;
    const mediaId =
      typeof payload["media_id"] === "string" ? payload["media_id"] : null;
    if (mediaId) {
      const kind = mediaById.get(mediaId);
      if (!kind) {
        item.status = "invalid";
        item.reason = "Selected media was not found.";
        continue;
      }
      if (
        ["image_labelling", "diagram_labelling", "map_labelling"].includes(
          item.input.question_type,
        ) &&
        kind !== "image"
      ) {
        item.status = "invalid";
        item.reason = "Visual labelling questions require image media.";
        continue;
      }
      if (
        ["dictation", "listening_transcription"].includes(
          item.input.question_type,
        ) &&
        !["audio", "video"].includes(kind)
      ) {
        item.status = "invalid";
        item.reason =
          "Dictation and listening transcription require audio or video media.";
      }
    }
  }

  const firstByHash = new Map<string, number>();
  for (const item of prepared) {
    if (item.status !== "valid" || !item.hash) continue;
    const first = firstByHash.get(item.hash);
    if (first != null) {
      item.status = "duplicate";
      item.reason = `Duplicate of spreadsheet row ${first}.`;
      continue;
    }
    firstByHash.set(item.hash, item.row.rowNumber);
  }

  const hashes = prepared
    .filter((item) => item.status === "valid" && item.hash)
    .map((item) => item.hash!);
  if (hashes.length) {
    const { data: existing, error } = await sb
      .from("questions")
      .select("id,content_hash")
      .in("content_hash", hashes)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const existingByHash = new Map(
      (existing ?? [])
        .filter((row: { content_hash: string | null }) => !!row.content_hash)
        .map((row: { id: string; content_hash: string | null }) => [
          row.content_hash!,
          row.id,
        ]),
    );

    for (const item of prepared) {
      if (item.status !== "valid" || !item.hash) continue;
      const duplicateId = existingByHash.get(item.hash);
      if (duplicateId) {
        item.status = "duplicate";
        item.duplicateOf = duplicateId;
        item.reason = "An identical question already exists.";
      }
    }
  }

  return prepared;
}

export const previewQuestionImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => importRequestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const prepared = await prepareQuestionImportRows(
      context.supabase,
      data.rows as QuestionImportRow[],
      data.defaults as QuestionImportDefaults,
    );

    return {
      rows: prepared.map((item) => ({
        rowNumber: item.row.rowNumber,
        sourceSheet: item.row.sourceSheet ?? null,
        status: item.status,
        reason: item.reason,
        duplicateOf: item.duplicateOf,
        question_type:
          item.input?.question_type ??
          item.row.values["question_type"] ??
          data.defaults.question_type,
        prompt: item.input?.prompt ?? item.row.values["prompt"] ?? "",
      })),
      summary: {
        total: prepared.length,
        valid: prepared.filter((item) => item.status === "valid").length,
        invalid: prepared.filter((item) => item.status === "invalid").length,
        duplicates: prepared.filter((item) => item.status === "duplicate").length,
      },
    };
  });

export const commitQuestionImport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => importRequestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const prepared = await prepareQuestionImportRows(
      sb,
      data.rows as QuestionImportRow[],
      data.defaults as QuestionImportDefaults,
    );
    const valid = prepared.filter(
      (item): item is PreparedImportRow & { input: QuestionInput; hash: string } =>
        item.status === "valid" && !!item.input && !!item.hash,
    );

    if (!valid.length) {
      return {
        imported: 0,
        invalid: prepared.filter((item) => item.status === "invalid").length,
        duplicates: prepared.filter((item) => item.status === "duplicate").length,
        jobId: null as string | null,
      };
    }

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .insert({
        mode: "question_spreadsheet",
        status: "processing",
        progress: 0,
        extraction_method: "client_spreadsheet_parser",
        stats: {
          source_filename: data.sourceFilename,
          total_rows: prepared.length,
        } as never,
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Could not create import job.");
    }

    try {
      const insertRows = valid.map((item) => {
        const { topicIds: _topics, tags: _tags, force: _force, id: _id, ...fields } =
          item.input;
        return {
          ...fields,
          content_hash: item.hash,
          current_version: 1,
          import_job_id: job.id,
          source_sheet: item.row.sourceSheet ?? null,
          provenance: {
            source_type: "question_spreadsheet",
            source_filename: data.sourceFilename,
            source_sheet: item.row.sourceSheet ?? null,
            source_row: item.row.rowNumber,
          },
        };
      });

      const { data: created, error: insertError } = await admin
        .from("questions")
        .insert(insertRows as never)
        .select("id,content_hash");
      if (insertError) throw new Error(insertError.message);

      const createdByHash = new Map(
        (created ?? [])
          .filter((row) => !!row.content_hash)
          .map((row) => [row.content_hash!, row.id]),
      );

      const versionRows = valid.flatMap((item) => {
        const questionId = createdByHash.get(item.hash);
        if (!questionId) return [];
        const { topicIds: _topics, tags: _tags, force: _force, id: _id, ...snapshot } =
          item.input;
        return [
          {
            question_id: questionId,
            version: 1,
            snapshot,
          },
        ];
      });
      if (versionRows.length) {
        const { error } = await admin
          .from("question_versions")
          .insert(versionRows as never);
        if (error) throw new Error(error.message);
      }

      const topicRows = valid.flatMap((item) => {
        const questionId = createdByHash.get(item.hash);
        if (!questionId) return [];
        return item.input.topicIds.map((topicId) => ({
          question_id: questionId,
          topic_id: topicId,
        }));
      });
      if (topicRows.length) {
        const { error } = await admin
          .from("question_topics")
          .insert(topicRows as never);
        if (error) throw new Error(error.message);
      }

      const tagNames = [
        ...new Set(valid.flatMap((item) => item.input.tags.map((tag) => tag.toLowerCase()))),
      ];
      if (tagNames.length) {
        const { error: tagUpsertError } = await admin
          .from("tags")
          .upsert(
            tagNames.map((name) => ({ name })),
            { onConflict: "name", ignoreDuplicates: true },
          );
        if (tagUpsertError) throw new Error(tagUpsertError.message);

        const { data: tagRows, error: tagReadError } = await admin
          .from("tags")
          .select("id,name")
          .in("name", tagNames);
        if (tagReadError) throw new Error(tagReadError.message);
        const tagIdByName = new Map((tagRows ?? []).map((tag) => [tag.name, tag.id]));

        const questionTagRows = valid.flatMap((item) => {
          const questionId = createdByHash.get(item.hash);
          if (!questionId) return [];
          return item.input.tags.flatMap((name) => {
            const tagId = tagIdByName.get(name.toLowerCase());
            return tagId ? [{ question_id: questionId, tag_id: tagId }] : [];
          });
        });
        if (questionTagRows.length) {
          const { error } = await admin
            .from("question_tags")
            .insert(questionTagRows as never);
          if (error) throw new Error(error.message);
        }
      }

      const invalidCount = prepared.filter((item) => item.status === "invalid").length;
      const duplicateCount = prepared.filter((item) => item.status === "duplicate").length;

      await admin
        .from("import_jobs")
        .update({
          status: "completed",
          progress: 100,
          stats: {
            source_filename: data.sourceFilename,
            total_rows: prepared.length,
            imported: valid.length,
            invalid: invalidCount,
            duplicates: duplicateCount,
          } as never,
        })
        .eq("id", job.id);

      await audit(admin, {
        actor_type: "teacher",
        actor_id: context.userId,
        action: "questions_spreadsheet_imported",
        entity_type: "import_job",
        entity_id: job.id,
        summary: `Imported ${valid.length} question(s) from spreadsheet`,
        details: {
          source_filename: data.sourceFilename,
          total_rows: prepared.length,
          imported: valid.length,
          invalid: invalidCount,
          duplicates: duplicateCount,
        },
      });

      return {
        imported: valid.length,
        invalid: invalidCount,
        duplicates: duplicateCount,
        jobId: job.id,
      };
    } catch (error) {
      await admin
        .from("questions")
        .delete()
        .eq("import_job_id", job.id);
      await admin
        .from("import_jobs")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
        .eq("id", job.id);
      throw error;
    }
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
