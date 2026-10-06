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
        "id,status,final_score,reviewed_at,created_at,student_id,question_id,attempt_answers!inner(id,attempt_id,item_key,response,score,auto_score,question_version,flagged,time_spent_ms,exam_attempts!inner(id,exam_id,snapshot,status,score,max_score,result_released,exams!inner(id,title))),students!inner(id,first_name,last_name,username)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);

    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.examId) query = query.eq("attempt_answers.exam_attempts.exam_id", data.examId);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    const typed = (rows ?? []) as unknown as Array<{
      id: string;
      status: "pending" | "reviewed";
      final_score: number | null;
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

    await admin.from("notifications").insert({
      recipient_type: "student",
      student_id: attempt.student_id,
      kind: "exam_result",
      title: "Exam result available",
      body: "Your exam result has been released.",
      link: `/student/attempts/${data.attemptId}`,
      data: {
        attempt_id: data.attemptId,
        exam_id: attempt.exam_id,
      } as never,
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

    const { count: pending } = await context.supabase
      .from("manual_reviews")
      .select("id,attempt_answers!inner(attempt_id)", { count: "exact", head: true })
      .eq("attempt_answers.attempt_id", data.attemptId)
      .eq("status", "pending");

    return {
      ...attempt,
      pending_reviews: pending ?? 0,
    };
  });
