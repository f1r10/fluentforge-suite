import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

export type GlobalSearchKind =
  | "question"
  | "vocabulary"
  | "reading"
  | "listening"
  | "catalog"
  | "exam"
  | "student"
  | "source";

export type GlobalSearchResult = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
};

function safeNeedle(value: string) {
  return value.trim().replace(/[,()%]/g, " ");
}

export const globalAdminSearch = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        query: z.string().trim().min(2).max(120),
        limitPerType: z.number().int().min(1).max(25).default(8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const needle = safeNeedle(data.query);
    const like = `%${needle}%`;
    const limit = data.limitPerType;

    const [
      questions,
      vocabulary,
      readings,
      listenings,
      catalogs,
      exams,
      students,
      sources,
    ] = await Promise.all([
      admin
        .from("questions")
        .select("id,prompt,question_type,learning_language,level,status")
        .is("deleted_at", null)
        .ilike("prompt", like)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("vocabulary_entries")
        .select("id,word,definition,learning_language,level,status")
        .is("deleted_at", null)
        .or(`word.ilike.${like},definition.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("readings")
        .select("id,title,learning_language,level,status")
        .is("deleted_at", null)
        .or(`title.ilike.${like},body.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("listenings")
        .select("id,title,learning_language,level,status")
        .is("deleted_at", null)
        .or(`title.ilike.${like},transcript.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("catalogs")
        .select("id,name,description,status")
        .is("deleted_at", null)
        .or(`name.ilike.${like},description.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("exams")
        .select("id,title,status")
        .is("deleted_at", null)
        .ilike("title", like)
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("students")
        .select("id,first_name,last_name,username,status")
        .is("deleted_at", null)
        .or(
          `first_name.ilike.${like},last_name.ilike.${like},username.ilike.${like}`,
        )
        .order("updated_at", { ascending: false })
        .limit(limit),
      admin
        .from("source_files")
        .select("id,original_filename,mime_type,created_at")
        .is("deleted_at", null)
        .ilike("original_filename", like)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    for (const result of [
      questions,
      vocabulary,
      readings,
      listenings,
      catalogs,
      exams,
      students,
      sources,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const rows: GlobalSearchResult[] = [];

    for (const row of questions.data ?? []) {
      rows.push({
        kind: "question",
        id: row.id,
        title: row.prompt,
        subtitle: [row.question_type, row.learning_language, row.level]
          .filter(Boolean)
          .join(" · ") || null,
        status: row.status,
      });
    }
    for (const row of vocabulary.data ?? []) {
      rows.push({
        kind: "vocabulary",
        id: row.id,
        title: row.word,
        subtitle:
          row.definition ||
          [row.learning_language, row.level].filter(Boolean).join(" · ") ||
          null,
        status: row.status,
      });
    }
    for (const row of readings.data ?? []) {
      rows.push({
        kind: "reading",
        id: row.id,
        title: row.title,
        subtitle: [row.learning_language, row.level]
          .filter(Boolean)
          .join(" · ") || null,
        status: row.status,
      });
    }
    for (const row of listenings.data ?? []) {
      rows.push({
        kind: "listening",
        id: row.id,
        title: row.title,
        subtitle: [row.learning_language, row.level]
          .filter(Boolean)
          .join(" · ") || null,
        status: row.status,
      });
    }
    for (const row of catalogs.data ?? []) {
      rows.push({
        kind: "catalog",
        id: row.id,
        title: row.name,
        subtitle: row.description,
        status: row.status,
      });
    }
    for (const row of exams.data ?? []) {
      rows.push({
        kind: "exam",
        id: row.id,
        title: row.title,
        subtitle: null,
        status: row.status,
      });
    }
    for (const row of students.data ?? []) {
      rows.push({
        kind: "student",
        id: row.id,
        title: `${row.first_name} ${row.last_name}`,
        subtitle: row.username,
        status: row.status,
      });
    }
    for (const row of sources.data ?? []) {
      rows.push({
        kind: "source",
        id: row.id,
        title: row.original_filename,
        subtitle: row.mime_type,
        status: null,
      });
    }

    return {
      query: data.query,
      results: rows,
      counts: Object.fromEntries(
        (
          [
            "question",
            "vocabulary",
            "reading",
            "listening",
            "catalog",
            "exam",
            "student",
            "source",
          ] as const
        ).map((kind) => [
          kind,
          rows.filter((row) => row.kind === kind).length,
        ]),
      ),
    };
  });
