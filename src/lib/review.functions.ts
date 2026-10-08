import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { examSettingsSchema } from "./exam.functions";

type SnapshotQuestion = {
  item_key?: string;
  question_id?: string;
  version?: number;
  question_type?: string;
  prompt?: string;
  instructions?: string | null;
  answer_key?: unknown;
  scoring?: unknown;
  explanation?: string | null;
  grading_mode?: string;
};

function findQuestionByItemKey(value: unknown, itemKey: string): SnapshotQuestion | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findQuestionByItemKey(item, itemKey);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record["item_key"] === itemKey && typeof record["question_type"] === "string") {
    return record as SnapshotQuestion;
  }

  for (const child of Object.values(record)) {
    const found = findQuestionByItemKey(child, itemKey);
    if (found) return found;
  }
  return null;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function questionMaxScore(question: SnapshotQuestion | null) {
  if (!question?.scoring || typeof question.scoring !== "object") return 1;
  return Math.max(0, numberValue((question.scoring as Record<string, unknown>)["points"], 1));
}

function plainResponse(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);

  const response = value as Record<string, unknown>;
  if (typeof response["text"] === "string") return response["text"];
  if (Array.isArray(response["answers"])) return (response["answers"] as unknown[]).map(String).join(" · ");
  if (Array.isArray(response["selected"])) return (response["selected"] as unknown[]).map(String).join(", ");
  if (Array.isArray(response["order"])) return (response["order"] as unknown[]).map(String).join(" → ");
  if (Array.isArray(response["pairs"])) {
    return (response["pairs"] as Array<{ left?: unknown; right?: unknown }>)
      .map((pair) => `${String(pair.left ?? "")} → ${String(pair.right ?? "")}`)
      .join(" · ");
  }
  return JSON.stringify(value);
}

function plainAnswerKey(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  const answer = value as Record<string, unknown>;
  if (Array.isArray(answer["correct"])) return (answer["correct"] as unknown[]).map(String).join(", ");
  if (Array.isArray(answer["blanks"])) {
    return (answer["blanks"] as unknown[][])
      .map((values, index) => `${index + 1}. ${values.map(String).join(" / ")}`)
      .join(" · ");
  }
  if (Array.isArray(answer["order"])) return (answer["order"] as unknown[]).map(String).join(" → ");
  if (Array.isArray(answer["pairs"])) {
    return (answer["pairs"] as Array<{ left?: unknown; right?: unknown }>)
      .map((pair) => `${String(pair.left ?? "")} → ${String(pair.right ?? "")}`)
      .join(" · ");
  }
  if (typeof answer["model_answer"] === "string") return answer["model_answer"];
  return "—";
}

export const getAiReviewStatus = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async () => {
    const { getAiProviderStatus } = await import("./ai.server");
    return getAiProviderStatus();
  });

export const listManualReviews = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        status: z.enum(["pending", "reviewed", "all"]).default("pending"),
        search: z.string().max(160).default(""),
        examId: z.string().uuid().nullable().default(null),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 40;
    let query = context.supabase
      .from("manual_reviews")
      .select(
        "id,status,final_score,ai_suggestion,reviewed_at,created_at,student_id,question_id,attempt_answers!inner(id,attempt_id,item_key,response,score,auto_score,question_version,flagged,time_spent_ms,exam_attempts!inner(id,exam_id,snapshot,status,score,max_score,result_released,exams!inner(id,title))),students!inner(id,first_name,last_name,username)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    query = query.is("attempt_answers.exam_attempts.reset_at", null);
    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.examId) query = query.eq("attempt_answers.exam_attempts.exam_id", data.examId);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    const typed = (rows ?? []) as unknown as Array<{
      id: string;
      status: "pending" | "reviewed";
      final_score: number | null;
      ai_suggestion: unknown;
      reviewed_at: string | null;
      created_at: string;
      student_id: string;
      question_id: string | null;
      students: { id: string; first_name: string; last_name: string; username: string };
      attempt_answers: {
        id: string;
        attempt_id: string;
        item_key: string;
        response: unknown;
        score: number | null;
        auto_score: number | null;
        question_version: number | null;
        flagged: boolean;
        time_spent_ms: number;
        exam_attempts: {
          id: string;
          exam_id: string;
          snapshot: unknown;
          status: string;
          score: number | null;
          max_score: number | null;
          result_released: boolean;
          exams: { id: string; title: string };
        };
      };
    }>;

    const needle = data.search.trim().toLocaleLowerCase();
    const mapped = typed.map((row) => {
      const attempt = row.attempt_answers.exam_attempts;
      const question = findQuestionByItemKey(attempt.snapshot, row.attempt_answers.item_key);
      return {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        reviewed_at: row.reviewed_at,
        final_score: row.final_score,
        ai_suggestion: row.ai_suggestion,
        student: {
          id: row.students.id,
          name: `${row.students.first_name} ${row.students.last_name}`,
          username: row.students.username,
        },
        exam: {
          id: attempt.exams.id,
          title: attempt.exams.title,
        },
        attempt: {
          id: attempt.id,
          status: attempt.status,
          score: attempt.score,
          max_score: attempt.max_score,
          result_released: attempt.result_released,
        },
        answer: {
          id: row.attempt_answers.id,
          item_key: row.attempt_answers.item_key,
          response: row.attempt_answers.response,
          response_text: plainResponse(row.attempt_answers.response),
          score: row.attempt_answers.score,
          auto_score: row.attempt_answers.auto_score,
          flagged: row.attempt_answers.flagged,
          time_spent_ms: row.attempt_answers.time_spent_ms,
        },
        question: {
          id: row.question_id,
          version: question?.version ?? row.attempt_answers.question_version,
          type: question?.question_type ?? "unknown",
          prompt: question?.prompt ?? "Question snapshot unavailable",
          instructions: question?.instructions ?? null,
          answer_key: question?.answer_key ?? null,
          answer_key_text: plainAnswerKey(question?.answer_key),
          explanation: question?.explanation ?? null,
          max_score: questionMaxScore(question),
        },
      };
    });

    const filtered = needle
      ? mapped.filter((row) =>
          [
            row.student.name,
            row.student.username,
            row.exam.title,
            row.question.prompt,
            row.answer.response_text,
          ].some((value) => value.toLocaleLowerCase().includes(needle)),
        )
      : mapped;

    return {
      rows: filtered,
      total: needle ? filtered.length : count ?? 0,
      pageSize,
    };
  });

export const listReviewExams = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("exams")
      .select("id,title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listReleaseQueue = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .handler(async ({ context }) => {
    const { data: attempts, error } = await context.supabase
      .from("exam_attempts")
      .select(
        "id,status,score,max_score,passed,submitted_at,snapshot,result_released,students!inner(id,first_name,last_name,username),exams!inner(id,title)",
      )
      .neq("status", "in_progress")
      .is("reset_at", null)
      .eq("result_released", false)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const candidates = (attempts ?? []).filter((attempt) => {
      const snapshot = attempt.snapshot as Record<string, unknown>;
      const exam = (snapshot["exam"] ?? {}) as Record<string, unknown>;
      const settings = examSettingsSchema.safeParse(exam["settings"] ?? {});
      return settings.success && settings.data.result_release === "after_approval";
    });

    const attemptIds = candidates.map((attempt) => attempt.id);
    const pendingByAttempt = new Map<string, number>();

    if (attemptIds.length) {
      const { data: pendingRows, error: pendingError } = await context.supabase
        .from("manual_reviews")
        .select("id,attempt_answers!inner(attempt_id)")
        .eq("status", "pending")
        .in("attempt_answers.attempt_id", attemptIds);
      if (pendingError) throw new Error(pendingError.message);

      for (const row of pendingRows ?? []) {
        const answer = row.attempt_answers as unknown as { attempt_id: string };
        pendingByAttempt.set(
          answer.attempt_id,
          (pendingByAttempt.get(answer.attempt_id) ?? 0) + 1,
        );
      }
    }

    return candidates.map((attempt) => {
      const student = attempt.students as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        username: string;
      };
      const exam = attempt.exams as unknown as { id: string; title: string };

      return {
        id: attempt.id,
        status: attempt.status,
        score: attempt.score,
        max_score: attempt.max_score,
        passed: attempt.passed,
        submitted_at: attempt.submitted_at,
        pending_reviews: pendingByAttempt.get(attempt.id) ?? 0,
        student: {
          id: student.id,
          name: `${student.first_name} ${student.last_name}`,
          username: student.username,
        },
        exam,
      };
    });
  });

export const listQuestionReports = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        status: z.enum(["open", "resolved", "all"]).default("open"),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 30;
    let query = context.supabase
      .from("question_reports")
      .select(
        "id,comment,created_at,resolved_at,student_id,question_id,students!inner(id,first_name,last_name,username),questions!inner(id,prompt,question_type,status,deleted_at)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.status === "open") query = query.is("resolved_at", null);
    if (data.status === "resolved") query = query.not("resolved_at", "is", null);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []).map((row) => {
        const student = row.students as unknown as {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
        };
        const question = row.questions as unknown as {
          id: string;
          prompt: string;
          question_type: string;
          status: string;
          deleted_at: string | null;
        };
        return {
          id: row.id,
          comment: row.comment,
          created_at: row.created_at,
          resolved_at: row.resolved_at,
          student: {
            id: student.id,
            name: `${student.first_name} ${student.last_name}`,
            username: student.username,
          },
          question: {
            id: question.id,
            prompt: question.prompt,
            question_type: question.question_type,
            status: question.status,
            deleted_at: question.deleted_at,
          },
        };
      }),
      total: count ?? 0,
      pageSize,
    };
  });

export const resolveQuestionReport = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        resolved: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: report, error: reportError } = await admin
      .from("question_reports")
      .select("id,student_id,question_id,resolved_at")
      .eq("id", data.id)
      .maybeSingle();
    if (reportError) throw new Error(reportError.message);
    if (!report) throw new Error("Question report not found.");

    const resolvedAt = data.resolved ? new Date().toISOString() : null;
    const { error } = await admin
      .from("question_reports")
      .update({ resolved_at: resolvedAt })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: data.resolved
        ? "question_report_resolved"
        : "question_report_reopened",
      entity_type: "question_report",
      entity_id: report.id,
      summary: data.resolved
        ? "Resolved a student question report"
        : "Reopened a student question report",
      details: {
        student_id: report.student_id,
        question_id: report.question_id,
      },
    });

    return { ok: true, resolved_at: resolvedAt };
  });

async function recomputeAttempt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  attemptId: string,
) {
  const { data: attempt, error: attemptError } = await admin
    .from("exam_attempts")
    .select("id,exam_id,snapshot,max_score,status,result_released")
    .eq("id", attemptId)
    .single();
  if (attemptError || !attempt) throw new Error(attemptError?.message ?? "Attempt not found.");

  const { data: answers, error: answersError } = await admin
    .from("attempt_answers")
    .select("id,score")
    .eq("attempt_id", attemptId);
  if (answersError) throw new Error(answersError.message);

  const { count: pending, error: pendingError } = await admin
    .from("manual_reviews")
    .select("id,attempt_answers!inner(attempt_id)", { count: "exact", head: true })
    .eq("attempt_answers.attempt_id", attemptId)
    .eq("status", "pending");
  if (pendingError) throw new Error(pendingError.message);

  const score = (answers ?? []).reduce(
    (sum: number, answer: { score: number | null }) => sum + numberValue(answer.score, 0),
    0,
  );

  const snapshot = attempt.snapshot as Record<string, unknown>;
  const exam = (snapshot["exam"] ?? {}) as Record<string, unknown>;
  const settings = examSettingsSchema.parse(exam["settings"] ?? {});
  const maxScore = numberValue(attempt.max_score, 0);
  const passed =
    (pending ?? 0) > 0 || settings.pass_score_percent == null || maxScore <= 0
      ? null
      : (score / maxScore) * 100 >= settings.pass_score_percent;

  const closeAt = typeof exam["available_until"] === "string" ? exam["available_until"] : null;
  const canAutoRelease =
    (pending ?? 0) === 0 &&
    (settings.result_release === "immediate" ||
      (settings.result_release === "after_close" &&
        !!closeAt &&
        Date.now() >= new Date(closeAt).getTime()));

  const { error: updateError } = await admin
    .from("exam_attempts")
    .update({
      status: (pending ?? 0) === 0 ? "graded" : attempt.status,
      score,
      passed,
      result_released: attempt.result_released || canAutoRelease,
    })
    .eq("id", attemptId);
  if (updateError) throw new Error(updateError.message);

  return {
    pending: pending ?? 0,
    score,
    max_score: maxScore,
    passed,
    result_released: attempt.result_released || canAutoRelease,
    settings,
  };
}

export const generateAiReviewSuggestion = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z.object({ reviewId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: review, error } = await admin
      .from("manual_reviews")
      .select(
        "id,status,answer_id,question_id,attempt_answers!inner(id,attempt_id,item_key,response,exam_attempts!inner(id,snapshot))",
      )
      .eq("id", data.reviewId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!review) throw new Error("Review not found.");
    if (review.status !== "pending") {
      throw new Error("AI suggestions are only available for pending reviews.");
    }

    const typed = review as unknown as {
      id: string;
      status: "pending" | "reviewed";
      answer_id: string | null;
      question_id: string | null;
      attempt_answers: {
        id: string;
        attempt_id: string;
        item_key: string;
        response: unknown;
        exam_attempts: {
          id: string;
          snapshot: unknown;
        };
      };
    };

    const question = findQuestionByItemKey(
      typed.attempt_answers.exam_attempts.snapshot,
      typed.attempt_answers.item_key,
    );
    if (!question) {
      throw new Error("Question snapshot is unavailable for AI review.");
    }

    const studentResponse = plainResponse(typed.attempt_answers.response);
    const maxScore = questionMaxScore(question);
    const { suggestOpenAnswerGrade } = await import("./ai.server");
    const suggestion = await suggestOpenAnswerGrade({
      questionType: question.question_type ?? "open_text",
      prompt: question.prompt ?? "",
      instructions: question.instructions ?? null,
      referenceAnswer: plainAnswerKey(question.answer_key),
      explanation: question.explanation ?? null,
      studentResponse,
      maxScore,
    });

    const { error: updateError } = await admin
      .from("manual_reviews")
      .update({
        ai_suggestion: suggestion as never,
      })
      .eq("id", typed.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "manual_review_ai_suggested",
      entity_type: "manual_review",
      entity_id: typed.id,
      summary: `AI suggested ${suggestion.score}/${maxScore} for a pending answer`,
      details: {
        answer_id: typed.answer_id,
        attempt_id: typed.attempt_answers.attempt_id,
        question_id: typed.question_id,
        provider: suggestion.provider,
        model: suggestion.model,
        confidence: suggestion.confidence,
        suggested_score: suggestion.score,
        max_score: maxScore,
      },
    });

    return suggestion;
  });

export const reviewManualAnswer = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        reviewId: z.string().uuid(),
        score: z.number().min(0).max(10_000),
        feedback: z.string().trim().max(10_000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: review, error } = await admin
      .from("manual_reviews")
      .select(
        "id,status,student_id,question_id,answer_id,attempt_answers!inner(id,attempt_id,item_key,exam_attempts!inner(id,snapshot))",
      )
      .eq("id", data.reviewId)
      .single();
    if (error || !review) throw new Error(error?.message ?? "Review not found.");

    const typed = review as unknown as {
      id: string;
      status: string;
      student_id: string;
      question_id: string | null;
      answer_id: string;
      attempt_answers: {
        id: string;
        attempt_id: string;
        item_key: string;
        exam_attempts: { id: string; snapshot: unknown };
      };
    };

    const question = findQuestionByItemKey(
      typed.attempt_answers.exam_attempts.snapshot,
      typed.attempt_answers.item_key,
    );
    const maxScore = questionMaxScore(question);
    if (data.score > maxScore + 1e-9) {
      throw new Error(`Score cannot be greater than ${maxScore}.`);
    }

    const isCorrect = Math.abs(data.score - maxScore) < 1e-9;

    const { error: answerError } = await admin
      .from("attempt_answers")
      .update({
        score: data.score,
        is_correct: isCorrect,
      })
      .eq("id", typed.answer_id);
    if (answerError) throw new Error(answerError.message);

    const now = new Date().toISOString();
    const { error: reviewError } = await admin
      .from("manual_reviews")
      .update({
        status: "reviewed",
        final_score: data.score,
        reviewed_at: now,
      })
      .eq("id", typed.id);
    if (reviewError) throw new Error(reviewError.message);

    if (data.feedback) {
      const { error: feedbackError } = await admin.from("teacher_feedback").insert({
        attempt_id: typed.attempt_answers.attempt_id,
        answer_id: typed.answer_id,
        student_id: typed.student_id,
        body: data.feedback,
      });
      if (feedbackError) throw new Error(feedbackError.message);

      const { notifyStudent } = await import("./notifications.functions");
      await notifyStudent(admin, typed.student_id, {
        kind: "teacher_feedback",
        title: "Teacher feedback available",
        body: data.feedback,
        link: `/student/attempts/${typed.attempt_answers.attempt_id}`,
        data: {
          attempt_id: typed.attempt_answers.attempt_id,
          answer_id: typed.answer_id,
          question_id: typed.question_id,
        },
        dedupeKey: `teacher-feedback:${typed.answer_id}`,
      });
    }

    const attempt = await recomputeAttempt(admin, typed.attempt_answers.attempt_id);

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "manual_score_override",
      entity_type: "attempt_answer",
      entity_id: typed.answer_id,
      summary: `Manual answer scored ${data.score}/${maxScore}`,
      details: {
        review_id: typed.id,
        attempt_id: typed.attempt_answers.attempt_id,
        question_id: typed.question_id,
        final_score: data.score,
        max_score: maxScore,
      },
    });

    return {
      ok: true,
      attempt,
    };
  });

export const releaseAttemptResult = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();
    const recomputed = await recomputeAttempt(admin, data.attemptId);

    if (recomputed.pending > 0) {
      throw new Error("Complete all pending manual reviews before releasing this result.");
    }

    const { data: attempt, error } = await admin
      .from("exam_attempts")
      .update({
        result_released: true,
        status: "graded",
      })
      .eq("id", data.attemptId)
      .select("student_id,exam_id")
      .single();
    if (error || !attempt) throw new Error(error?.message ?? "Attempt not found.");

    const { notifyStudent } = await import("./notifications.functions");
    await notifyStudent(admin, attempt.student_id, {
      kind: "exam_result",
      title: "Exam result available",
      body: "Your exam result has been released.",
      link: `/student/attempts/${data.attemptId}`,
      data: {
        attempt_id: data.attemptId,
        exam_id: attempt.exam_id,
      },
      dedupeKey: `exam-result:${data.attemptId}`,
    });

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "exam_result_released",
      entity_type: "exam_attempt",
      entity_id: data.attemptId,
      summary: "Exam result released to student",
    });

    return { ok: true };
  });

export const resetExamAttempt = createServerFn({ method: "POST" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        attemptId: z.string().uuid(),
        reason: z.string().trim().max(1_000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient, audit } = await import("./security.server");
    const admin = await adminClient();

    const { data: attempt, error: attemptError } = await admin
      .from("exam_attempts")
      .select(
        "id,exam_id,student_id,attempt_number,status,score,max_score,result_released,reset_at,exams!inner(id,title),students!inner(id,first_name,last_name,username)",
      )
      .eq("id", data.attemptId)
      .maybeSingle();
    if (attemptError) throw new Error(attemptError.message);
    if (!attempt) throw new Error("Attempt not found.");

    if (attempt.reset_at) {
      return {
        ok: true,
        alreadyReset: true,
        resetAt: attempt.reset_at,
      };
    }

    const resetAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("exam_attempts")
      .update({
        status: "abandoned",
        result_released: false,
        reset_at: resetAt,
        reset_by: context.userId,
      })
      .eq("id", attempt.id)
      .is("reset_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      throw new Error("Attempt was reset by another request.");
    }

    const { error: activityError } = await admin
      .from("activity_events")
      .insert({
        student_id: attempt.student_id,
        category: "exam",
        event_type: "exam_attempt_reset",
        entity_type: "exam",
        entity_id: attempt.exam_id,
        attempt_id: attempt.id,
        details: {
          attempt_number: attempt.attempt_number,
          previous_status: attempt.status,
          previous_score: attempt.score,
          previous_max_score: attempt.max_score,
          reason: data.reason || null,
        } as never,
      });
    if (activityError) throw new Error(activityError.message);

    const student = attempt.students as unknown as {
      first_name: string;
      last_name: string;
      username: string;
    };
    const exam = attempt.exams as unknown as {
      id: string;
      title: string;
    };

    const { notifyStudent } = await import("./notifications.functions");
    await notifyStudent(admin, attempt.student_id, {
      kind: "exam_attempt_reset",
      title: "Exam attempt reset",
      body: `Your attempt for ${exam.title} was reset by the teacher. You may start a new attempt if the exam is still available.`,
      link: "/student/exams",
      data: {
        exam_id: attempt.exam_id,
        reset_attempt_id: attempt.id,
      },
      dedupeKey: `exam-attempt-reset:${attempt.id}`,
    });

    await audit(admin, {
      actor_type: "teacher",
      actor_id: context.userId,
      action: "exam_attempt_reset",
      entity_type: "exam_attempt",
      entity_id: attempt.id,
      summary: `Reset attempt #${attempt.attempt_number} for ${student.first_name} ${student.last_name} — ${exam.title}`,
      details: {
        student_id: attempt.student_id,
        username: student.username,
        exam_id: attempt.exam_id,
        attempt_number: attempt.attempt_number,
        previous_status: attempt.status,
        previous_score: attempt.score,
        previous_max_score: attempt.max_score,
        result_was_released: attempt.result_released,
        reason: data.reason || null,
        reset_at: resetAt,
      },
    });

    return {
      ok: true,
      alreadyReset: false,
      resetAt,
    };
  });

export const listExamAttemptsMonitoring = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(120).default(""),
        examId: z.string().uuid().nullable().default(null),
        status: z
          .enum(["all", "in_progress", "submitted", "auto_submitted", "graded", "abandoned"])
          .default("all"),
        violationsOnly: z.boolean().default(false),
        page: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 40;
    let studentIds: string[] | null = null;

    if (data.search.trim()) {
      const safe = data.search.trim().replace(/[,()%]/g, " ");
      const { data: students, error: studentError } = await context.supabase
        .from("students")
        .select("id")
        .is("deleted_at", null)
        .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,username.ilike.%${safe}%`)
        .limit(500);
      if (studentError) throw new Error(studentError.message);
      studentIds = (students ?? []).map((student) => student.id);
      if (!studentIds.length) {
        return { rows: [], total: 0, pageSize };
      }
    }

    let query = context.supabase
      .from("exam_attempts")
      .select(
        "id,exam_id,student_id,attempt_number,status,started_at,deadline_at,submitted_at,score,max_score,passed,result_released,violations,reset_at,reset_by,students!inner(id,first_name,last_name,username),exams!inner(id,title),attempt_answers(count)",
        { count: "exact" },
      )
      .order("started_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (studentIds) query = query.in("student_id", studentIds);
    if (data.examId) query = query.eq("exam_id", data.examId);
    if (data.status !== "all") query = query.eq("status", data.status);

    const { data: attempts, count, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (attempts ?? [])
      .map((attempt) => {
        const violations = Array.isArray(attempt.violations) ? attempt.violations : [];
        const counts = (attempt.attempt_answers as unknown as Array<{ count: number }>)[0]?.count ?? 0;
        const student = attempt.students as unknown as {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
        };
        const exam = attempt.exams as unknown as { id: string; title: string };
        return {
          id: attempt.id,
          exam_id: attempt.exam_id,
          reset_at: attempt.reset_at,
          reset_by: attempt.reset_by,
          student_id: attempt.student_id,
          attempt_number: attempt.attempt_number,
          status: attempt.status,
          started_at: attempt.started_at,
          deadline_at: attempt.deadline_at,
          submitted_at: attempt.submitted_at,
          score: attempt.score,
          max_score: attempt.max_score,
          passed: attempt.passed,
          result_released: attempt.result_released,
          violation_count: violations.length,
          tab_switches: violations.filter(
            (entry) =>
              !!entry &&
              typeof entry === "object" &&
              (entry as Record<string, unknown>)["type"] === "tab_hidden",
          ).length,
          answers_saved: counts,
          student: {
            id: student.id,
            name: `${student.first_name} ${student.last_name}`,
            username: student.username,
          },
          exam,
        };
      })
      .filter((row) => !data.violationsOnly || row.violation_count > 0);

    // When violationsOnly is used, count is page-local because JSON-array
    // filtering is deliberately kept outside query-builder-specific syntax.
    return {
      rows,
      total: data.violationsOnly ? rows.length : count ?? 0,
      pageSize,
    };
  });

export const getReviewAttemptSummary = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: attempt, error } = await context.supabase
      .from("exam_attempts")
      .select(
        "id,exam_id,student_id,status,started_at,deadline_at,submitted_at,score,max_score,passed,result_released,violations,students(id,first_name,last_name,username),exams(id,title)",
      )
      .eq("id", data.attemptId)
      .single();
    if (error || !attempt) throw new Error(error?.message ?? "Attempt not found.");

    const [
      { count: pending },
      answersResult,
      activityResult,
      playsResult,
    ] = await Promise.all([
      context.supabase
        .from("manual_reviews")
        .select("id,attempt_answers!inner(attempt_id)", { count: "exact", head: true })
        .eq("attempt_answers.attempt_id", data.attemptId)
        .eq("status", "pending"),
      context.supabase
        .from("attempt_answers")
        .select("id,item_key,is_correct,score,flagged,change_count,time_spent_ms,updated_at")
        .eq("attempt_id", data.attemptId)
        .order("updated_at"),
      context.supabase
        .from("activity_events")
        .select("id,event_type,details,created_at")
        .eq("attempt_id", data.attemptId)
        .eq("category", "exam")
        .order("created_at"),
      context.supabase
        .from("exam_listening_plays")
        .select(
          "id,listening_id,play_number,started_at,expires_at,completed_at",
        )
        .eq("attempt_id", data.attemptId)
        .order("started_at"),
    ]);

    if (answersResult.error) throw new Error(answersResult.error.message);
    if (activityResult.error) throw new Error(activityResult.error.message);
    if (playsResult.error) throw new Error(playsResult.error.message);

    const answers = answersResult.data ?? [];
    const autoGraded = answers.filter((answer) => answer.is_correct !== null);
    const correct = autoGraded.filter((answer) => answer.is_correct === true).length;

    return {
      ...attempt,
      pending_reviews: pending ?? 0,
      metrics: {
        answers_saved: answers.length,
        auto_graded: autoGraded.length,
        correct,
        incorrect: autoGraded.length - correct,
        flagged: answers.filter((answer) => answer.flagged).length,
        answer_changes: answers.reduce((sum, answer) => sum + (answer.change_count ?? 0), 0),
        time_spent_ms: answers.reduce((sum, answer) => sum + (answer.time_spent_ms ?? 0), 0),
      },
      answers,
      listening_plays: playsResult.data ?? [],
      timeline: activityResult.data ?? [],
    };
  });
