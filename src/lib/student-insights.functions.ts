import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireTeacher } from "./teacher-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { publicPracticeQuestion } from "./student-library.functions";

async function currentStudentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data, error } = await supabase.rpc("current_student_id");
  if (error || !data) throw new Error("Forbidden");
  return String(data);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export const getTeacherStudentActivity = createServerFn({ method: "GET" })
  .middleware([requireTeacher])
  .inputValidator((d) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const studentResult = await admin
      .from("students")
      .select(
        "id,first_name,last_name,username,status,last_active_at,created_at,group_memberships(groups(id,name))",
      )
      .eq("id", data.studentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (studentResult.error) throw new Error(studentResult.error.message);
    if (!studentResult.data) throw new Error("Student not found.");

    const [sessionsResult, activityResult, attemptsResult] = await Promise.all([
      admin
        .from("student_sessions")
        .select("id,started_at,last_seen_at,current_location,revoked_at")
        .eq("student_id", data.studentId)
        .order("started_at", { ascending: false })
        .limit(100),
      admin
        .from("activity_events")
        .select(
          "id,category,event_type,entity_type,entity_id,attempt_id,is_correct,response,duration_ms,details,created_at",
        )
        .eq("student_id", data.studentId)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("exam_attempts")
        .select(
          "id,exam_id,attempt_number,status,started_at,submitted_at,score,max_score,passed,result_released,exams(title)",
        )
        .eq("student_id", data.studentId)
        .is("reset_at", null)
        .order("started_at", { ascending: false })
        .limit(200),
    ]);
    for (const result of [sessionsResult, activityResult, attemptsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const activities = activityResult.data ?? [];
    const attempts = attemptsResult.data ?? [];
    const attemptIds = attempts.map((row) => row.id);

    const attemptAnswersResult = attemptIds.length
      ? await admin
          .from("attempt_answers")
          .select(
            "id,attempt_id,question_id,response,is_correct,score,auto_score,time_spent_ms,updated_at",
          )
          .in("attempt_id", attemptIds)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (attemptAnswersResult.error) {
      throw new Error(attemptAnswersResult.error.message);
    }

    const practiceQuestionIds = activities
      .filter(
        (row) =>
          row.entity_type === "question" &&
          row.entity_id &&
          row.event_type === "practice_answer",
      )
      .map((row) => String(row.entity_id));
    const examQuestionIds = (attemptAnswersResult.data ?? [])
      .map((row) => row.question_id)
      .filter((id): id is string => !!id);
    const questionIds = [...new Set([...practiceQuestionIds, ...examQuestionIds])];

    const vocabularyIds = [
      ...new Set(
        activities
          .filter(
            (row) =>
              row.entity_type === "vocabulary" &&
              row.entity_id &&
              row.event_type === "vocabulary_answer",
          )
          .map((row) => String(row.entity_id)),
      ),
    ];

    const [questionsResult, vocabularyResult] = await Promise.all([
      questionIds.length
        ? admin
            .from("questions")
            .select(
              "id,prompt,question_type,payload,answer_key,explanation,learning_language,level,context_kind",
            )
            .in("id", questionIds)
        : Promise.resolve({ data: [], error: null }),
      vocabularyIds.length
        ? admin
            .from("vocabulary_entries")
            .select(
              "id,word,learning_language,level,vocabulary_translations(language,value)",
            )
            .in("id", vocabularyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (questionsResult.error) throw new Error(questionsResult.error.message);
    if (vocabularyResult.error) throw new Error(vocabularyResult.error.message);

    const questions = new Map(
      (questionsResult.data ?? []).map((row) => [row.id, row]),
    );
    const vocabulary = new Map(
      (vocabularyResult.data ?? []).map((row) => [row.id, row]),
    );
    const attemptById = new Map(attempts.map((row) => [row.id, row]));

    const practiceAnswers = activities
      .filter(
        (row) =>
          row.event_type === "practice_answer" &&
          row.entity_type === "question" &&
          row.entity_id,
      )
      .map((row) => {
        const question = questions.get(String(row.entity_id));
        const details = asRecord(row.details);
        return {
          id: String(row.id),
          kind: "question" as const,
          source: String(details["practice_kind"] ?? "practice"),
          prompt: question?.prompt ?? "Question",
          questionType: question?.question_type ?? null,
          payload: question?.payload ?? {},
          correctAnswer: question?.answer_key ?? {},
          explanation: question?.explanation ?? null,
          studentResponse: row.response ?? null,
          isCorrect: row.is_correct,
          score:
            typeof details["score"] === "number" ? details["score"] : null,
          maxScore:
            typeof details["max_score"] === "number"
              ? details["max_score"]
              : null,
          durationMs: row.duration_ms,
          at: row.created_at,
        };
      });

    const vocabularyAnswers = activities
      .filter(
        (row) =>
          row.event_type === "vocabulary_answer" &&
          row.entity_type === "vocabulary" &&
          row.entity_id,
      )
      .map((row) => {
        const entry = vocabulary.get(String(row.entity_id));
        const details = asRecord(row.details);
        return {
          id: String(row.id),
          kind: "vocabulary" as const,
          source: "vocabulary",
          prompt: entry?.word ?? "Vocabulary",
          questionType: "vocabulary",
          payload: {},
          correctAnswer: {
            expected: Array.isArray(details["expected"])
              ? details["expected"]
              : [],
          },
          explanation: null,
          studentResponse: row.response ?? null,
          isCorrect: row.is_correct,
          score: row.is_correct === true ? 1 : row.is_correct === false ? 0 : null,
          maxScore: 1,
          durationMs: row.duration_ms,
          at: row.created_at,
        };
      });

    const examAnswers = (attemptAnswersResult.data ?? []).map((row) => {
      const question = row.question_id ? questions.get(row.question_id) : null;
      const attempt = attemptById.get(row.attempt_id);
      const exam = attempt?.exams as unknown as { title: string } | null;
      return {
        id: row.id,
        kind: "question" as const,
        source: exam?.title ? `exam: ${exam.title}` : "exam",
        prompt: question?.prompt ?? "Question",
        questionType: question?.question_type ?? null,
        payload: question?.payload ?? {},
        correctAnswer: question?.answer_key ?? {},
        explanation: question?.explanation ?? null,
        studentResponse: row.response ?? null,
        isCorrect: row.is_correct,
        score: row.score,
        maxScore: null,
        durationMs: row.time_spent_ms,
        at: row.updated_at,
        attemptId: row.attempt_id,
      };
    });

    const answers = [...practiceAnswers, ...vocabularyAnswers, ...examAnswers]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 1000);

    const graded = answers.filter((row) => row.isCorrect != null);
    const correct = graded.filter((row) => row.isCorrect === true).length;
    const wrong = graded.filter((row) => row.isCorrect === false).length;

    const groups = (
      (studentResult.data.group_memberships ?? []) as unknown as Array<{
        groups: { id: string; name: string } | null;
      }>
    )
      .map((row) => row.groups)
      .filter((row): row is { id: string; name: string } => !!row);

    return {
      student: {
        id: studentResult.data.id,
        firstName: studentResult.data.first_name,
        lastName: studentResult.data.last_name,
        username: studentResult.data.username,
        status: studentResult.data.status,
        lastActiveAt: studentResult.data.last_active_at,
        createdAt: studentResult.data.created_at,
        groups,
      },
      summary: {
        answers: graded.length,
        correct,
        wrong,
        accuracy: graded.length ? correct / graded.length : null,
        exams: attempts.length,
        studyTimeMs: answers.reduce(
          (sum, row) => sum + (row.durationMs ?? 0),
          0,
        ),
      },
      answers,
      attempts: attempts.map((row) => ({
        id: row.id,
        examId: row.exam_id,
        title:
          (row.exams as unknown as { title: string } | null)?.title ?? "Exam",
        attemptNumber: row.attempt_number,
        status: row.status,
        startedAt: row.started_at,
        submittedAt: row.submitted_at,
        score: row.score,
        maxScore: row.max_score,
        passed: row.passed,
        resultReleased: row.result_released,
      })),
      sessions: (sessionsResult.data ?? []).map((row) => ({
        id: row.id,
        startedAt: row.started_at,
        lastSeenAt: row.last_seen_at,
        location: row.current_location,
        endedAt: row.revoked_at,
      })),
      activity: activities
        .filter(
          (row) =>
            !["practice_answer", "vocabulary_answer"].includes(row.event_type),
        )
        .slice(0, 300)
        .map((row) => ({
          id: String(row.id),
          category: row.category,
          type: row.event_type,
          entityType: row.entity_type,
          at: row.created_at,
          isCorrect: row.is_correct,
        })),
    };
  });

export const getMyMistakes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const studentId = await currentStudentId(context.supabase);
    const { adminClient } = await import("./security.server");
    const admin = await adminClient();

    const [practiceResult, attemptsResult, vocabularyStateResult] =
      await Promise.all([
        admin
          .from("activity_events")
          .select("entity_id,is_correct,response,created_at,details")
          .eq("student_id", studentId)
          .eq("event_type", "practice_answer")
          .eq("entity_type", "question")
          .not("entity_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000),
        admin
          .from("exam_attempts")
          .select("id,started_at,submitted_at")
          .eq("student_id", studentId)
          .neq("status", "in_progress")
          .is("reset_at", null)
          .order("started_at", { ascending: false })
          .limit(200),
        admin
          .from("student_vocabulary_state")
          .select(
            "entry_id,last_result,last_mode,last_practiced_at,incorrect_count,correct_count",
          )
          .eq("student_id", studentId)
          .eq("last_result", false)
          .order("last_practiced_at", { ascending: false })
          .limit(500),
      ]);
    for (const result of [
      practiceResult,
      attemptsResult,
      vocabularyStateResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const attempts = attemptsResult.data ?? [];
    const attemptIds = attempts.map((row) => row.id);
    const examAnswersResult = attemptIds.length
      ? await admin
          .from("attempt_answers")
          .select("question_id,response,is_correct,updated_at,attempt_id")
          .in("attempt_id", attemptIds)
          .not("question_id", "is", null)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (examAnswersResult.error) throw new Error(examAnswersResult.error.message);

    type Outcome = {
      questionId: string;
      isCorrect: boolean | null;
      response: unknown;
      at: string;
      source: "practice" | "exam";
    };
    const outcomes: Outcome[] = [
      ...(practiceResult.data ?? []).map((row) => ({
        questionId: String(row.entity_id),
        isCorrect: row.is_correct,
        response: row.response,
        at: row.created_at,
        source: "practice" as const,
      })),
      ...(examAnswersResult.data ?? []).map((row) => ({
        questionId: String(row.question_id),
        isCorrect: row.is_correct,
        response: row.response,
        at: row.updated_at,
        source: "exam" as const,
      })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const latestByQuestion = new Map<string, Outcome>();
    for (const row of outcomes) {
      if (!latestByQuestion.has(row.questionId)) {
        latestByQuestion.set(row.questionId, row);
      }
    }
    const wrongQuestionOutcomes = [...latestByQuestion.values()].filter(
      (row) => row.isCorrect === false,
    );
    const questionIds = wrongQuestionOutcomes.map((row) => row.questionId);

    const questionsResult = questionIds.length
      ? await admin
          .from("questions")
          .select(
            "id,question_type,prompt,instructions,payload,answer_key,scoring,grading_mode,current_version,learning_language,level,context_kind,reading_question_set_id,listening_question_set_id",
          )
          .in("id", questionIds)
          .eq("status", "active")
          .is("deleted_at", null)
      : { data: [], error: null };
    if (questionsResult.error) throw new Error(questionsResult.error.message);

    const { hydrateQuestionMedia } = await import("./media.server");
    const hydrated = await hydrateQuestionMedia(
      admin,
      (questionsResult.data ?? []) as never[],
      60 * 60,
    );
    const questionById = new Map(
      hydrated.map((row) => [row.id, publicPracticeQuestion(row as never)]),
    );

    const vocabularyIds = (vocabularyStateResult.data ?? []).map(
      (row) => row.entry_id,
    );
    const vocabularyResult = vocabularyIds.length
      ? await admin
          .from("vocabulary_entries")
          .select(
            "id,word,definition,ipa,part_of_speech,learning_language,level,vocabulary_translations(language,value),vocabulary_examples(sentence,translation,sort_order)",
          )
          .in("id", vocabularyIds)
          .eq("status", "active")
          .is("deleted_at", null)
      : { data: [], error: null };
    if (vocabularyResult.error) throw new Error(vocabularyResult.error.message);

    const stateByEntry = new Map(
      (vocabularyStateResult.data ?? []).map((row) => [row.entry_id, row]),
    );

    return {
      questions: wrongQuestionOutcomes.flatMap((outcome) => {
        const question = questionById.get(outcome.questionId);
        return question
          ? [
              {
                question,
                previousResponse: outcome.response,
                lastWrongAt: outcome.at,
                source: outcome.source,
              },
            ]
          : [];
      }),
      vocabulary: (vocabularyResult.data ?? []).map((entry) => {
        const state = stateByEntry.get(entry.id)!;
        return {
          id: entry.id,
          word: entry.word,
          definition: entry.definition,
          ipa: entry.ipa,
          part_of_speech: entry.part_of_speech,
          learning_language: entry.learning_language,
          level: entry.level,
          translations: (entry.vocabulary_translations ?? []) as Array<{
            language: string;
            value: string;
          }>,
          examples: (
            (entry.vocabulary_examples ?? []) as Array<{
              sentence: string;
              translation: string | null;
              sort_order: number;
            }>
          )
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((row) => ({
              sentence: row.sentence,
              translation: row.translation,
            })),
          learner_state: {
            state: "learning" as const,
            correct_count: state.correct_count,
            incorrect_count: state.incorrect_count,
            correct_streak: 0,
            last_result: false,
            last_mode: state.last_mode,
            last_practiced_at: state.last_practiced_at,
          },
        };
      }),
    };
  });
