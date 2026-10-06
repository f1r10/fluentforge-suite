import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";

export const getTeacherAnalytics = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        questionLimit: z.number().int().min(1).max(1000).default(300),
        catalogLimit: z.number().int().min(1).max(1000).default(300),
        studentLimit: z.number().int().min(1).max(5000).default(1000),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const [questionsResult, catalogsResult, studentsResult] =
      await Promise.all([
        admin.rpc("teacher_question_analytics", {
          p_limit: data.questionLimit,
        }),
        admin.rpc("teacher_catalog_analytics", {
          p_limit: data.catalogLimit,
        }),
        admin.rpc("teacher_student_analytics", {
          p_limit: data.studentLimit,
        }),
      ]);

    for (const result of [
      questionsResult,
      catalogsResult,
      studentsResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    return {
      questions: (questionsResult.data ?? []).map((row) => ({
        ...row,
        attempts: Number(row.attempts ?? 0),
        correct: Number(row.correct ?? 0),
        incorrect: Number(row.incorrect ?? 0),
        manual: Number(row.manual ?? 0),
        skips: Number(row.skips ?? 0),
        accuracy:
          row.accuracy == null ? null : Number(row.accuracy),
        skip_rate:
          row.skip_rate == null ? null : Number(row.skip_rate),
        avg_time_ms:
          row.avg_time_ms == null ? null : Number(row.avg_time_ms),
      })),
      catalogs: (catalogsResult.data ?? []).map((row) => ({
        ...row,
        sessions: Number(row.sessions ?? 0),
        total_answered: Number(row.total_answered ?? 0),
        avg_accuracy:
          row.avg_accuracy == null ? null : Number(row.avg_accuracy),
        avg_score_percent:
          row.avg_score_percent == null
            ? null
            : Number(row.avg_score_percent),
      })),
      students: (studentsResult.data ?? []).map((row) => ({
        ...row,
        practice_answers: Number(row.practice_answers ?? 0),
        practice_accuracy:
          row.practice_accuracy == null
            ? null
            : Number(row.practice_accuracy),
        study_time_ms: Number(row.study_time_ms ?? 0),
        exam_attempts: Number(row.exam_attempts ?? 0),
        exam_accuracy_percent:
          row.exam_accuracy_percent == null
            ? null
            : Number(row.exam_accuracy_percent),
      })),
    };
  });
