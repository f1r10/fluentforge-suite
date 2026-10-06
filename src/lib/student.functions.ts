import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ language: z.enum(["az", "en", "ru", "tr"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) throw new Error("Forbidden");
    const { adminClient } = await import("./security.server");
    await (await adminClient()).from("students").update({ interface_language: data.language }).eq("id", sid);
    return { ok: true };
  });

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ location: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sid } = await context.supabase.rpc("current_student_id");
    if (!sid) return { ok: false };
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const now = new Date().toISOString();
    const claims = (context.claims ?? {}) as Record<string, unknown>;
    if (claims["session_id"]) await admin.from("student_sessions").update({ last_seen_at: now, current_location: data.location }).eq("auth_session_id", String(claims["session_id"]));
    await admin.from("students").update({ last_active_at: now }).eq("id", sid);
    return { ok: true };
  });


const favoriteEntitySchema = z.enum(["question", "vocabulary"]);

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        entityType: favoriteEntitySchema,
        entityId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: sid, error: sidError } = await context.supabase.rpc(
      "current_student_id",
    );
    if (sidError || !sid) throw new Error("Forbidden");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    if (data.entityType === "question") {
      const { data: entity, error } = await admin
        .from("questions")
        .select("id")
        .eq("id", data.entityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!entity) throw new Error("Question is not available.");
    } else {
      const { data: entity, error } = await admin
        .from("vocabulary_entries")
        .select("id")
        .eq("id", data.entityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!entity) throw new Error("Vocabulary item is not available.");
    }

    const { data: existing, error: existingError } = await admin
      .from("favorites")
      .select("entity_id")
      .eq("student_id", sid)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      const { error } = await admin
        .from("favorites")
        .delete()
        .eq("student_id", sid)
        .eq("entity_type", data.entityType)
        .eq("entity_id", data.entityId);
      if (error) throw new Error(error.message);
      return { favorited: false };
    }

    const { error } = await admin.from("favorites").insert({
      student_id: sid,
      entity_type: data.entityType,
      entity_id: data.entityId,
    });
    if (error) throw new Error(error.message);
    return { favorited: true };
  });

export const listMyFavorites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: sid, error: sidError } = await context.supabase.rpc(
      "current_student_id",
    );
    if (sidError || !sid) throw new Error("Forbidden");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data: favorites, error } = await admin
      .from("favorites")
      .select("entity_type,entity_id,created_at")
      .eq("student_id", sid)
      .in("entity_type", ["question", "vocabulary"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const questionIds = (favorites ?? [])
      .filter((row) => row.entity_type === "question")
      .map((row) => row.entity_id);
    const vocabularyIds = (favorites ?? [])
      .filter((row) => row.entity_type === "vocabulary")
      .map((row) => row.entity_id);

    const [questionsResult, vocabularyResult] = await Promise.all([
      questionIds.length
        ? admin
            .from("questions")
            .select(
              "id,prompt,question_type,learning_language,level,status,deleted_at",
            )
            .in("id", questionIds)
        : Promise.resolve({ data: [], error: null }),
      vocabularyIds.length
        ? admin
            .from("vocabulary_entries")
            .select(
              "id,word,definition,learning_language,level,status,deleted_at",
            )
            .in("id", vocabularyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (questionsResult.error) throw new Error(questionsResult.error.message);
    if (vocabularyResult.error) throw new Error(vocabularyResult.error.message);

    const questions = new Map(
      (questionsResult.data ?? [])
        .filter((row) => row.status === "active" && !row.deleted_at)
        .map((row) => [row.id, row]),
    );
    const vocabulary = new Map(
      (vocabularyResult.data ?? [])
        .filter((row) => row.status === "active" && !row.deleted_at)
        .map((row) => [row.id, row]),
    );

    return (favorites ?? []).flatMap((favorite) => {
      if (favorite.entity_type === "question") {
        const row = questions.get(favorite.entity_id);
        return row
          ? [
              {
                entity_type: "question" as const,
                entity_id: row.id,
                title: row.prompt,
                subtitle: row.question_type,
                learning_language: row.learning_language,
                level: row.level,
                created_at: favorite.created_at,
              },
            ]
          : [];
      }

      const row = vocabulary.get(favorite.entity_id);
      return row
        ? [
            {
              entity_type: "vocabulary" as const,
              entity_id: row.id,
              title: row.word,
              subtitle: row.definition,
              learning_language: row.learning_language,
              level: row.level,
              created_at: favorite.created_at,
            },
          ]
        : [];
    });
  });

export const getMyDashboardSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: sid, error: sidError } = await context.supabase.rpc(
      "current_student_id",
    );
    if (sidError || !sid) throw new Error("Forbidden");

    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "student_dashboard")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const value =
      data?.value && typeof data.value === "object"
        ? (data.value as Record<string, unknown>)
        : {};
    const raw = Array.isArray(value["visible_widgets"])
      ? value["visible_widgets"]
      : Array.isArray(value["widgets"])
        ? value["widgets"]
        : [];

    const widgets = raw.filter(
      (item): item is string => typeof item === "string",
    );

    return {
      widgets:
        widgets.length > 0
          ? widgets
          : [
              "catalogs",
              "exams",
              "practice",
              "today",
              "correctness",
              "accuracy",
              "study_time",
              "streak",
              "progress",
              "domain_progress",
              "weak_topics",
              "history",
              "favorites",
              "completed_exams",
            ],
    };
  });
