import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreBlanks,
  scoreMatching,
  scoreMultipleChoice,
  scoreOrdering,
  type Normalization,
  type Scoring,
} from "./grading";
import { TYPE_BY_ID } from "./question-types";
import { examSettingsSchema, type ExamSettings } from "./exam.functions";

type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

const responseSchema = z
  .object({
    selected: z.array(z.string().max(100)).max(200).optional(),
    answers: z.array(z.string().max(10_000)).max(200).optional(),
    pairs: z
      .array(
        z.object({
          left: z.string().max(10_000),
          right: z.string().max(10_000),
        }),
      )
      .max(200)
      .optional(),
    order: z.array(z.string().max(10_000)).max(200).optional(),
    text: z.string().max(100_000).optional(),
  })
  .strict();

export type ExamResponse = z.infer<typeof responseSchema>;

type PublishedQuestion = {
  kind: "question";
  question_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type PublishedReading = {
  kind: "reading";
  reading: Record<string, unknown> & { id: string; title: string };
  question_sets: Array<{
    id: string;
    title: string | null;
    instructions: string | null;
    questions: PublishedQuestion[];
  }>;
};

type PublishedListening = {
  kind: "listening";
  listening: Record<string, unknown> & { id: string; title: string };
  sections: Array<Record<string, unknown>>;
  question_sets: Array<{
    id: string;
    section_id: string | null;
    title: string | null;
    instructions: string | null;
    questions: PublishedQuestion[];
  }>;
};

type PublishedCatalog = {
  kind: "catalog";
  catalog: { id: string; name: string; description: string | null };
  items: PublishedContent[];
};

type PublishedContent = PublishedQuestion | PublishedReading | PublishedListening | PublishedCatalog;

type PublishedSection = {
  id: string;
  title: string | null;
  instructions: string | null;
  sort_order: number;
  fixed_items: Array<{
    item_id: string;
    entity_type: string;
    points: number | null;
    snapshot: PublishedContent;
  }>;
  pools: Array<{
    id: string;
    name: string;
    count: number;
    filters: Record<string, unknown>;
    candidates: PublishedQuestion[];
  }>;
};

type PublishedExamSnapshot = {
  schema_version: number;
  published_at: string;
  exam: {
    id: string;
    title: string;
    description: string | null;
    available_from: string | null;
    available_until: string | null;
    duration_minutes: number | null;
    settings: ExamSettings;
  };
  sections: PublishedSection[];
};

type AttemptQuestion = {
  item_key: string;
  question_id: string;
  version: number;
  question_type: string;
  prompt: string;
  instructions: string | null;
  payload: Record<string, unknown>;
  answer_key: Record<string, unknown>;
  scoring: Record<string, unknown>;
  normalization: Record<string, unknown>;
  explanation: string | null;
  grading_mode: string;
  metadata: Record<string, unknown>;
};

type AttemptQuestionSet = {
  id: string;
  title: string | null;
  instructions: string | null;
  section_id?: string | null;
  questions: AttemptQuestion[];
};

type AttemptBlock =
  | {
      kind: "question";
      source: Record<string, unknown>;
      question: AttemptQuestion;
    }
  | {
      kind: "reading";
      source: Record<string, unknown>;
      reading: Record<string, unknown>;
      question_sets: AttemptQuestionSet[];
    }
  | {
      kind: "listening";
      source: Record<string, unknown>;
      listening: Record<string, unknown>;
      sections: Array<Record<string, unknown>>;
      question_sets: AttemptQuestionSet[];
    };

type AttemptSnapshot = {
  schema_version: 1;
  published_at: string;
  exam: PublishedExamSnapshot["exam"];
  sections: Array<{
    id: string;
    title: string | null;
    instructions: string | null;
    blocks: AttemptBlock[];
  }>;
};

function shuffle<T>(input: T[]) {
  const output = [...input];
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j]!, output[i]!];
  }
  return output;
}

function parsePublishedSnapshot(value: unknown): PublishedExamSnapshot {
  if (!value || typeof value !== "object") throw new Error("Published exam snapshot is missing.");
  const snapshot = value as PublishedExamSnapshot;
  if (!snapshot.exam || !Array.isArray(snapshot.sections)) throw new Error("Published exam snapshot is invalid.");
  return {
    ...snapshot,
    exam: {
      ...snapshot.exam,
      settings: examSettingsSchema.parse(snapshot.exam.settings ?? {}),
    },
  };
}

function questionFromPublished(
  published: PublishedQuestion,
  settings: ExamSettings,
  pointsOverride: number | null = null,
): AttemptQuestion {
  const snapshot = published.snapshot ?? {};
  const payload =
    snapshot["payload"] && typeof snapshot["payload"] === "object"
      ? { ...(snapshot["payload"] as Record<string, unknown>) }
      : {};

  if (settings.shuffle_options && Array.isArray(payload["options"])) {
    payload["options"] = shuffle(payload["options"] as unknown[]);
  }

  const baseScoring =
    snapshot["scoring"] && typeof snapshot["scoring"] === "object"
      ? { ...(snapshot["scoring"] as Record<string, unknown>) }
      : {};

  if (pointsOverride != null) baseScoring["points"] = pointsOverride;

  return {
    item_key: crypto.randomUUID(),
    question_id: published.question_id,
    version: published.version,
    question_type: String(snapshot["question_type"] ?? ""),
    prompt: String(snapshot["prompt"] ?? ""),
    instructions: snapshot["instructions"] == null ? null : String(snapshot["instructions"]),
    payload,
    answer_key:
      snapshot["answer_key"] && typeof snapshot["answer_key"] === "object"
        ? (snapshot["answer_key"] as Record<string, unknown>)
        : {},
    scoring: baseScoring,
    normalization:
      snapshot["normalization"] && typeof snapshot["normalization"] === "object"
        ? (snapshot["normalization"] as Record<string, unknown>)
        : {},
    explanation: snapshot["explanation"] == null ? null : String(snapshot["explanation"]),
    grading_mode: String(snapshot["grading_mode"] ?? "automatic"),
    metadata: published.metadata ?? {},
  };
}

function materializeContent(
  content: PublishedContent,
  settings: ExamSettings,
  source: Record<string, unknown>,
  pointsOverride: number | null = null,
): AttemptBlock[] {
  if (content.kind === "question") {
    return [
      {
        kind: "question",
        source,
        question: questionFromPublished(content, settings, pointsOverride),
      },
    ];
  }

  if (content.kind === "reading") {
    return [
      {
        kind: "reading",
        source,
        reading: content.reading,
        question_sets: content.question_sets.map((set) => ({
          id: set.id,
          title: set.title,
          instructions: set.instructions,
          questions: set.questions.map((question) => questionFromPublished(question, settings)),
        })),
      },
    ];
  }

  if (content.kind === "listening") {
    return [
      {
        kind: "listening",
        source,
        listening: content.listening,
        sections: content.sections,
        question_sets: content.question_sets.map((set) => ({
          id: set.id,
          section_id: set.section_id,
          title: set.title,
          instructions: set.instructions,
          questions: set.questions.map((question) => questionFromPublished(question, settings)),
        })),
      },
    ];
  }

  return content.items.flatMap((item, index) =>
    materializeContent(item, settings, {
      ...source,
      catalog_id: content.catalog.id,
      catalog_name: content.catalog.name,
      catalog_index: index,
    }),
  );
}

function buildAttemptSnapshot(published: PublishedExamSnapshot): AttemptSnapshot {
  const settings = published.exam.settings;
  let sections = published.sections.map((section) => {
    const blocks: AttemptBlock[] = [];

    for (const fixed of section.fixed_items) {
      blocks.push(
        ...materializeContent(
          fixed.snapshot,
          settings,
          {
            source_kind: "fixed",
            exam_item_id: fixed.item_id,
            entity_type: fixed.entity_type,
          },
          fixed.entity_type === "question" ? fixed.points : null,
        ),
      );
    }

    for (const pool of section.pools) {
      const selected = shuffle(pool.candidates).slice(0, pool.count);
      for (const candidate of selected) {
        blocks.push(
          ...materializeContent(candidate, settings, {
            source_kind: "pool",
            pool_id: pool.id,
            pool_name: pool.name,
          }),
        );
      }
    }

    return {
      id: section.id,
      title: section.title,
      instructions: section.instructions,
      blocks: settings.shuffle_questions ? shuffle(blocks) : blocks,
    };
  });

  if (settings.section_order === "shuffle") sections = shuffle(sections);

  return {
    schema_version: 1,
    published_at: published.published_at,
    exam: published.exam,
    sections,
  };
}

function collectAttemptQuestions(snapshot: AttemptSnapshot) {
  const map = new Map<string, AttemptQuestion>();

  const addSet = (sets: AttemptQuestionSet[]) => {
    for (const set of sets) {
      for (const question of set.questions) map.set(question.item_key, question);
    }
  };

  for (const section of snapshot.sections) {
    for (const block of section.blocks) {
      if (block.kind === "question") map.set(block.question.item_key, block.question);
      else addSet(block.question_sets);
    }
  }

  return map;
}

function sanitizeQuestion(question: AttemptQuestion) {
  const { answer_key: _answerKey, explanation: _explanation, ...publicQuestion } = question;
  return publicQuestion;
}

function sanitizeAttemptSnapshot(snapshot: AttemptSnapshot) {
  return {
    ...snapshot,
    sections: snapshot.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.kind === "question") {
          return { ...block, question: sanitizeQuestion(block.question) };
        }
        if (block.kind === "listening") {
          const listening = { ...block.listening };
          const rules =
            listening["playback_rules"] && typeof listening["playback_rules"] === "object"
              ? (listening["playback_rules"] as Record<string, unknown>)
              : {};
          if (rules["show_transcript"] !== true) {
            delete listening["transcript"];
            delete listening["transcript_segments"];
          }
          return {
            ...block,
            listening,
            question_sets: block.question_sets.map((set) => ({
              ...set,
              questions: set.questions.map(sanitizeQuestion),
            })),
          };
        }
        return {
          ...block,
          question_sets: block.question_sets.map((set) => ({
            ...set,
            questions: set.questions.map(sanitizeQuestion),
          })),
        };
      }),
    })),
  };
}

function scoring(value: Record<string, unknown>): Scoring {
  return {
    points: typeof value["points"] === "number" ? value["points"] : 1,
    partial: value["partial"] === true,
    negative: typeof value["negative"] === "number" ? value["negative"] : 0,
  };
}

function normalization(value: Record<string, unknown>): Normalization {
  return {
    case_sensitive: value["case_sensitive"] === true,
    trim_whitespace: value["trim_whitespace"] !== false,
    ignore_punctuation: value["ignore_punctuation"] === true,
    ignore_diacritics: value["ignore_diacritics"] === true,
  };
}

function gradeQuestion(question: AttemptQuestion, response: ExamResponse | null) {
  const def = TYPE_BY_ID[question.question_type];
  const s = scoring(question.scoring);
  const n = normalization(question.normalization);
  const answer = question.answer_key;

  if (!def || def.editor === "open" || question.grading_mode !== "automatic") {
    return {
      score: null as number | null,
      auto_score: null as number | null,
      max_score: s.points ?? 1,
      is_correct: null as boolean | null,
      needs_review: true,
    };
  }

  const r = response ?? {};
  let score = 0;

  if (def.editor === "choice" || def.editor === "fixed_choice") {
    const correct = Array.isArray(answer["correct"]) ? (answer["correct"] as string[]) : [];
    score = scoreMultipleChoice(r.selected ?? [], correct, s);
  } else if (def.editor === "text") {
    const blanks = Array.isArray(answer["blanks"]) ? (answer["blanks"] as string[][]) : [];
    score = scoreBlanks(r.answers ?? [], blanks, n, s);
  } else if (def.editor === "matching") {
    const pairs = Array.isArray(answer["pairs"])
      ? (answer["pairs"] as Array<{ left: string; right: string }>)
      : [];
    score = scoreMatching(r.pairs ?? [], pairs, n, s);
  } else if (def.editor === "ordering") {
    const order = Array.isArray(answer["order"]) ? (answer["order"] as string[]) : [];
    score = scoreOrdering(r.order ?? [], order, n, s);
  }

  const maxScore = s.points ?? 1;
  return {
    score,
    auto_score: score,
    max_score: maxScore,
    is_correct: Math.abs(score - maxScore) < 1e-9,
    needs_review: false,
  };
}

async function currentStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

async function assignedExamIds(admin: Admin, studentId: string) {
  const { data: memberships, error: membershipError } = await admin
    .from("group_memberships")
    .select("group_id")
    .eq("student_id", studentId);
  if (membershipError) throw new Error(membershipError.message);

  const groupIds = (memberships ?? []).map((row) => row.group_id);

  const [direct, group] = await Promise.all([
    admin.from("exam_assignments").select("exam_id").eq("student_id", studentId),
    groupIds.length
      ? admin.from("exam_assignments").select("exam_id").in("group_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (direct.error) throw new Error(direct.error.message);
  if (group.error) throw new Error(group.error.message);

  return [...new Set([...(direct.data ?? []), ...(group.data ?? [])].map((row) => row.exam_id))];
}

async function getAssignedExam(admin: Admin, studentId: string, examId: string) {
  const assigned = await assignedExamIds(admin, studentId);
  if (!assigned.includes(examId)) throw new Error("This exam is not assigned to you.");

  const { data, error } = await admin
    .from("exams")
    .select(
      "id,title,description,status,available_from,available_until,duration_minutes,settings,published_snapshot,published_at",
    )
    .eq("id", examId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.published_at || !data.published_snapshot) throw new Error("Exam is not available.");

  return {
    ...data,
    settings: examSettingsSchema.parse(data.settings ?? {}),
    published: parsePublishedSnapshot(data.published_snapshot),
  };
}

function examAvailability(exam: {
  status: string;
  available_from: string | null;
  available_until: string | null;
}) {
  const now = Date.now();
  const from = exam.available_from ? new Date(exam.available_from).getTime() : null;
  const until = exam.available_until ? new Date(exam.available_until).getTime() : null;

  if (exam.status === "archived") return "archived" as const;
  if (exam.status === "finished") return "finished" as const;
  if (from != null && now < from) return "upcoming" as const;
  if (until != null && now >= until) return "closed" as const;
  return "available" as const;
}

function calculateDeadline(
  startedAt: Date,
  durationMinutes: number | null,
  closeAt: string | null,
  fullDurationAfterStart: boolean,
) {
  const durationDeadline = durationMinutes
    ? new Date(startedAt.getTime() + durationMinutes * 60_000)
    : null;
  const closeDeadline = closeAt ? new Date(closeAt) : null;

  if (fullDurationAfterStart) return durationDeadline ?? closeDeadline;
  if (durationDeadline && closeDeadline) {
    return durationDeadline.getTime() < closeDeadline.getTime() ? durationDeadline : closeDeadline;
  }
  return durationDeadline ?? closeDeadline;
}

async function getOwnedAttempt(admin: Admin, studentId: string, attemptId: string) {
  const { data, error } = await admin
    .from("exam_attempts")
    .select(
      "id,exam_id,student_id,attempt_number,status,snapshot,started_at,deadline_at,submitted_at,score,max_score,passed,result_released,violations",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Attempt not found.");
  return data;
}

function isExpired(deadline: string | null) {
  return !!deadline && Date.now() >= new Date(deadline).getTime();
}

export const listStudentExams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const ids = await assignedExamIds(admin, studentId);
    if (!ids.length) return [];

    const [examResult, attemptResult] = await Promise.all([
      admin
        .from("exams")
        .select("id,title,description,status,available_from,available_until,duration_minutes,settings,published_at")
        .in("id", ids)
        .not("published_at", "is", null)
        .is("deleted_at", null)
        .order("available_from", { ascending: true, nullsFirst: true }),
      admin
        .from("exam_attempts")
        .select("id,exam_id,attempt_number,status,started_at,deadline_at,submitted_at,score,max_score,passed,result_released")
        .eq("student_id", studentId)
        .in("exam_id", ids)
        .order("attempt_number", { ascending: false }),
    ]);

    if (examResult.error) throw new Error(examResult.error.message);
    if (attemptResult.error) throw new Error(attemptResult.error.message);

    const attemptsByExam = new Map<string, typeof attemptResult.data>();
    for (const attempt of attemptResult.data ?? []) {
      attemptsByExam.set(attempt.exam_id, [...(attemptsByExam.get(attempt.exam_id) ?? []), attempt]);
    }

    return (examResult.data ?? []).map((exam) => {
      const attempts = attemptsByExam.get(exam.id) ?? [];
      const settings = examSettingsSchema.parse(exam.settings ?? {});
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        status: exam.status,
        availability: examAvailability(exam),
        available_from: exam.available_from,
        available_until: exam.available_until,
        duration_minutes: exam.duration_minutes,
        max_attempts: settings.max_attempts,
        attempts_used: attempts.length,
        active_attempt: attempts.find((attempt) => attempt.status === "in_progress") ?? null,
        latest_attempt: attempts[0] ?? null,
      };
    });
  });

export const startOrResumeExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ examId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const exam = await getAssignedExam(admin, studentId, data.examId);
    const availability = examAvailability(exam);

    if (availability === "upcoming") throw new Error("This exam has not opened yet.");
    if (availability === "closed" || availability === "finished" || availability === "archived") {
      throw new Error("This exam is closed.");
    }

    const { data: existing, error: existingError } = await admin
      .from("exam_attempts")
      .select("id,status,deadline_at")
      .eq("exam_id", data.examId)
      .eq("student_id", studentId)
      .eq("status", "in_progress")
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      if (isExpired(existing.deadline_at)) {
        await submitAttemptInternal(admin, studentId, existing.id, true);
      } else {
        return { attemptId: existing.id, resumed: true };
      }
    }

    const { count, error: countError } = await admin
      .from("exam_attempts")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", data.examId)
      .eq("student_id", studentId);
    if (countError) throw new Error(countError.message);

    const attemptsUsed = count ?? 0;
    if (attemptsUsed >= exam.settings.max_attempts) {
      throw new Error("You have used all allowed attempts.");
    }

    const startedAt = new Date();
    const deadline = calculateDeadline(
      startedAt,
      exam.duration_minutes,
      exam.available_until,
      exam.settings.full_duration_after_start,
    );

    if (deadline && deadline.getTime() <= startedAt.getTime()) {
      throw new Error("There is no remaining time to start this exam.");
    }

    const snapshot = buildAttemptSnapshot(exam.published);

    const { data: created, error } = await admin
      .from("exam_attempts")
      .insert({
        exam_id: data.examId,
        student_id: studentId,
        attempt_number: attemptsUsed + 1,
        status: "in_progress",
        snapshot: snapshot as never,
        started_at: startedAt.toISOString(),
        deadline_at: deadline?.toISOString() ?? null,
      })
      .select("id")
      .single();

    if (error) {
      const { data: raced } = await admin
        .from("exam_attempts")
        .select("id")
        .eq("exam_id", data.examId)
        .eq("student_id", studentId)
        .eq("status", "in_progress")
        .maybeSingle();
      if (raced) return { attemptId: raced.id, resumed: true };
      throw new Error(error.message);
    }

    await admin.from("activity_events").insert({
      student_id: studentId,
      category: "exam",
      event_type: "exam_started",
      entity_type: "exam",
      entity_id: data.examId,
      attempt_id: created.id,
      details: {
        attempt_number: attemptsUsed + 1,
        deadline_at: deadline?.toISOString() ?? null,
      } as never,
    });

    return { attemptId: created.id, resumed: false };
  });

export const getExamAttempt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    let attempt = await getOwnedAttempt(admin, studentId, data.attemptId);

    if (attempt.status === "in_progress" && isExpired(attempt.deadline_at)) {
      await submitAttemptInternal(admin, studentId, attempt.id, true);
      attempt = await getOwnedAttempt(admin, studentId, data.attemptId);
    }

    const { data: answers, error } = await admin
      .from("attempt_answers")
      .select("item_key,response,flagged,change_count,time_spent_ms,updated_at")
      .eq("attempt_id", attempt.id);
    if (error) throw new Error(error.message);

    const snapshot = attempt.snapshot as unknown as AttemptSnapshot;

    return {
      attempt: {
        id: attempt.id,
        exam_id: attempt.exam_id,
        attempt_number: attempt.attempt_number,
        status: attempt.status,
        started_at: attempt.started_at,
        deadline_at: attempt.deadline_at,
        submitted_at: attempt.submitted_at,
        score: attempt.score,
        max_score: attempt.max_score,
        passed: attempt.passed,
        result_released: attempt.result_released,
        violations: attempt.violations,
      },
      snapshot: sanitizeAttemptSnapshot(snapshot),
      answers: answers ?? [],
      server_time: new Date().toISOString(),
    };
  });

export const saveExamAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        attemptId: z.string().uuid(),
        itemKey: z.string().uuid(),
        response: responseSchema.nullable(),
        flagged: z.boolean().default(false),
        timeSpentMs: z.number().int().min(0).max(86_400_000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const attempt = await getOwnedAttempt(admin, studentId, data.attemptId);

    if (attempt.status !== "in_progress") throw new Error("This attempt is no longer active.");
    if (isExpired(attempt.deadline_at)) {
      await submitAttemptInternal(admin, studentId, attempt.id, true);
      throw new Error("Time is up. The exam was submitted automatically.");
    }

    const snapshot = attempt.snapshot as unknown as AttemptSnapshot;
    const question = collectAttemptQuestions(snapshot).get(data.itemKey);
    if (!question) throw new Error("Question is not part of this attempt.");

    const { data: saved, error } = await admin.rpc("save_attempt_answer", {
      p_attempt_id: attempt.id,
      p_item_key: data.itemKey,
      p_question_id: question.question_id,
      p_question_version: question.version,
      p_response: data.response as never,
      p_flagged: data.flagged,
      p_time_spent_ms: data.timeSpentMs,
    });
    if (error) throw new Error(error.message);

    return {
      ok: true,
      saved_at: new Date().toISOString(),
      change_count: saved?.change_count ?? 0,
    };
  });

export const recordExamViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        attemptId: z.string().uuid(),
        type: z.enum(["tab_hidden", "copy", "paste", "cut", "fullscreen_exit"]),
        details: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const attempt = await getOwnedAttempt(admin, studentId, data.attemptId);
    if (attempt.status !== "in_progress") return { ok: false };

    const { error } = await admin.rpc("append_exam_violation", {
      p_attempt_id: attempt.id,
      p_event: {
        type: data.type,
        details: data.details,
      } as never,
    });
    if (error) throw new Error(error.message);

    await admin.from("activity_events").insert({
      student_id: studentId,
      category: "exam",
      event_type: "exam_violation",
      entity_type: "exam",
      entity_id: attempt.exam_id,
      attempt_id: attempt.id,
      details: {
        type: data.type,
        ...data.details,
      } as never,
    });

    return { ok: true };
  });

async function submitAttemptInternal(
  admin: Admin,
  studentId: string,
  attemptId: string,
  automatic: boolean,
) {
  const attempt = await getOwnedAttempt(admin, studentId, attemptId);
  if (attempt.status !== "in_progress") return attempt;

  const snapshot = attempt.snapshot as unknown as AttemptSnapshot;
  const questions = collectAttemptQuestions(snapshot);

  const { data: savedAnswers, error: answerError } = await admin
    .from("attempt_answers")
    .select("id,item_key,response,flagged,time_spent_ms")
    .eq("attempt_id", attempt.id);
  if (answerError) throw new Error(answerError.message);

  const answerByKey = new Map((savedAnswers ?? []).map((answer) => [answer.item_key, answer]));
  const graded: Array<{
    item_key: string;
    question: AttemptQuestion;
    score: number | null;
    auto_score: number | null;
    max_score: number;
    is_correct: boolean | null;
    needs_review: boolean;
    response: ExamResponse | null;
  }> = [];

  for (const [itemKey, question] of questions) {
    const saved = answerByKey.get(itemKey);
    const response = (saved?.response ?? null) as ExamResponse | null;
    const grade = gradeQuestion(question, response);
    graded.push({
      item_key: itemKey,
      question,
      response,
      ...grade,
    });
  }

  for (const result of graded) {
    const saved = answerByKey.get(result.item_key);

    if (!saved) {
      const { data: inserted, error } = await admin
        .from("attempt_answers")
        .insert({
          attempt_id: attempt.id,
          item_key: result.item_key,
          question_id: result.question.question_id,
          question_version: result.question.version,
          response: result.response as never,
          is_correct: result.is_correct,
          score: result.score,
          auto_score: result.auto_score,
          flagged: false,
          time_spent_ms: 0,
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "Could not finalize answer.");
      answerByKey.set(result.item_key, {
        id: inserted.id,
        item_key: result.item_key,
        response: result.response as never,
        flagged: false,
        time_spent_ms: 0,
      });
    } else {
      const { error } = await admin
        .from("attempt_answers")
        .update({
          is_correct: result.is_correct,
          score: result.score,
          auto_score: result.auto_score,
        })
        .eq("id", saved.id);
      if (error) throw new Error(error.message);
    }
  }

  const manual = graded.filter((result) => result.needs_review);
  if (manual.length) {
    const answerIds = manual
      .map((result) => answerByKey.get(result.item_key)?.id)
      .filter((value): value is string => !!value);

    const { data: existingReviews, error: reviewError } = await admin
      .from("manual_reviews")
      .select("answer_id")
      .in("answer_id", answerIds);
    if (reviewError) throw new Error(reviewError.message);
    const existing = new Set((existingReviews ?? []).map((row) => row.answer_id));

    const rows = manual
      .map((result) => ({
        answer_id: answerByKey.get(result.item_key)?.id ?? null,
        student_id: studentId,
        question_id: result.question.question_id,
        status: "pending" as const,
      }))
      .filter((row) => row.answer_id && !existing.has(row.answer_id));

    if (rows.length) {
      const { error } = await admin.from("manual_reviews").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  const autoScore = graded.reduce((sum, result) => sum + (result.score ?? 0), 0);
  const maxScore = graded.reduce((sum, result) => sum + result.max_score, 0);
  const settings = examSettingsSchema.parse(snapshot.exam.settings ?? {});
  const passed =
    manual.length > 0 || settings.pass_score_percent == null || maxScore <= 0
      ? manual.length > 0
        ? null
        : settings.pass_score_percent == null
          ? null
          : false
      : (autoScore / maxScore) * 100 >= settings.pass_score_percent;

  const canReleaseImmediately =
    manual.length === 0 &&
    (settings.result_release === "immediate" ||
      (settings.result_release === "after_close" &&
        !!snapshot.exam.available_until &&
        Date.now() >= new Date(snapshot.exam.available_until).getTime()));

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("exam_attempts")
    .update({
      status: manual.length > 0 ? (automatic ? "auto_submitted" : "submitted") : "graded",
      submitted_at: now,
      score: autoScore,
      max_score: maxScore,
      passed,
      result_released: canReleaseImmediately,
    })
    .eq("id", attempt.id)
    .eq("status", "in_progress")
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  await admin.from("activity_events").insert({
    student_id: studentId,
    category: "exam",
    event_type: automatic ? "exam_auto_submitted" : "exam_submitted",
    entity_type: "exam",
    entity_id: attempt.exam_id,
    attempt_id: attempt.id,
    details: {
      score: autoScore,
      max_score: maxScore,
      pending_reviews: manual.length,
      passed,
    } as never,
  });

  return updated;
}

export const submitExamAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const result = await submitAttemptInternal(admin, studentId, data.attemptId, false);

    return {
      status: result.status,
      submitted_at: result.submitted_at,
      score: result.result_released ? result.score : null,
      max_score: result.result_released ? result.max_score : null,
      passed: result.result_released ? result.passed : null,
      result_released: result.result_released,
    };
  });

export const autoSubmitExamAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    const result = await submitAttemptInternal(admin, studentId, data.attemptId, true);
    return {
      status: result.status,
      submitted_at: result.submitted_at,
      result_released: result.result_released,
    };
  });

export const getExamResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();
    const studentId = await currentStudentId(context.supabase);
    let attempt = await getOwnedAttempt(admin, studentId, data.attemptId);

    if (attempt.status === "in_progress") {
      return { ready: false as const, status: attempt.status };
    }

    const snapshot = attempt.snapshot as unknown as AttemptSnapshot;
    const settings = examSettingsSchema.parse(snapshot.exam.settings ?? {});

    if (
      !attempt.result_released &&
      settings.result_release === "after_close" &&
      snapshot.exam.available_until &&
      Date.now() >= new Date(snapshot.exam.available_until).getTime()
    ) {
      const { count: pending } = await admin
        .from("manual_reviews")
        .select("id,attempt_answers!inner(attempt_id)", { count: "exact", head: true })
        .eq("attempt_answers.attempt_id", attempt.id)
        .eq("status", "pending");

      if ((pending ?? 0) === 0) {
        await admin.from("exam_attempts").update({ result_released: true }).eq("id", attempt.id);
        attempt = { ...attempt, result_released: true };
      }
    }

    if (!attempt.result_released) {
      return {
        ready: false as const,
        status: attempt.status,
        pending_review: attempt.status === "submitted" || attempt.status === "auto_submitted",
      };
    }

    const questions = collectAttemptQuestions(snapshot);
    const { data: answers, error } = await admin
      .from("attempt_answers")
      .select("item_key,response,is_correct,score,auto_score,flagged")
      .eq("attempt_id", attempt.id);
    if (error) throw new Error(error.message);

    const answerVisibility =
      settings.answer_visibility === "after_submit" ||
      settings.answer_visibility === "after_close" ||
      settings.answer_visibility === "after_approval";
    const explanationVisibility =
      settings.explanation_visibility === "after_submit" ||
      settings.explanation_visibility === "after_close" ||
      settings.explanation_visibility === "after_approval";

    return {
      ready: true as const,
      status: attempt.status,
      score: attempt.score,
      max_score: attempt.max_score,
      passed: attempt.passed,
      submitted_at: attempt.submitted_at,
      answers: (answers ?? []).map((answer) => {
        const question = questions.get(answer.item_key);
        return {
          item_key: answer.item_key,
          response: answer.response,
          is_correct: answer.is_correct,
          score: answer.score,
          flagged: answer.flagged,
          answer_key: answerVisibility ? question?.answer_key ?? null : null,
          explanation: explanationVisibility ? question?.explanation ?? null : null,
        };
      }),
    };
  });
