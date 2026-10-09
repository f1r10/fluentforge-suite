/**
 * Server-only bridge between trusted grading and the review calendar.
 * Grading must never fail merely because an older deployment has not loaded
 * the optional spaced-review RPC into PostgREST's schema cache yet.
 */
type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

export async function recordReviewEvents(
  admin: Admin,
  events: ReadonlyArray<{ id: string | number }>,
): Promise<void> {
  for (const event of events) {
    const id = Number(event.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("Invalid graded activity ID.");
    }

    const { error } = await admin.rpc("record_review_from_event", {
      p_event_id: id,
    });
    if (!error) continue;

    if (!isMissingReviewRpc(error)) {
      throw new Error(readErrorMessage(error, "Could not update review schedule."));
    }

    try {
      await fallbackRecordReviewEvent(admin, id);
    } catch (fallbackError) {
      // Review scheduling is secondary to grading. Older local installations
      // may be missing both the RPC and the review table; in that case keep
      // answer checking functional and let the next migration restore reviews.
      if (isMissingReviewStorage(fallbackError)) continue;
      throw fallbackError;
    }
  }
}

async function fallbackRecordReviewEvent(admin: Admin, eventId: number) {
  const { data: event, error: eventError } = await admin
    .from("activity_events")
    .select(
      "id,student_id,category,event_type,entity_type,entity_id,is_correct,details,created_at",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) throw new Error(readErrorMessage(eventError, "Could not read graded activity."));
  if (!event) return;

  const details =
    event.details && typeof event.details === "object"
      ? (event.details as Record<string, unknown>)
      : {};
  const needsReview = details["needs_review"] === true;

  if (
    event.category !== "practice" ||
    !event.student_id ||
    !event.entity_id ||
    !["question", "vocabulary"].includes(event.entity_type) ||
    event.is_correct == null ||
    needsReview ||
    (event.entity_type === "question" &&
      event.event_type !== "practice_answer") ||
    (event.entity_type === "vocabulary" &&
      event.event_type !== "vocabulary_answer")
  ) {
    return;
  }

  const key = {
    student_id: event.student_id,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
  };

  const { data: existing, error: existingError } = await admin
    .from("student_review_schedules")
    .select(
      "student_id,entity_type,entity_id,step,interval_days,lapses,due_at,last_reviewed_at,last_event_id",
    )
    .eq("student_id", key.student_id)
    .eq("entity_type", key.entity_type)
    .eq("entity_id", key.entity_id)
    .maybeSingle();
  if (existingError) {
    throw new Error(readErrorMessage(existingError, "Could not read review schedule."));
  }

  let previous = existing;
  if (!previous) {
    const { data: created, error: createError } = await admin
      .from("student_review_schedules")
      .insert({
        ...key,
        due_at: event.created_at,
      })
      .select(
        "student_id,entity_type,entity_id,step,interval_days,lapses,due_at,last_reviewed_at,last_event_id",
      )
      .single();
    if (createError || !created) {
      // A concurrent request may have created it. Re-read once.
      const { data: raced, error: raceError } = await admin
        .from("student_review_schedules")
        .select(
          "student_id,entity_type,entity_id,step,interval_days,lapses,due_at,last_reviewed_at,last_event_id",
        )
        .eq("student_id", key.student_id)
        .eq("entity_type", key.entity_type)
        .eq("entity_id", key.entity_id)
        .maybeSingle();
      if (raceError || !raced) {
        throw new Error(
          readErrorMessage(
            createError ?? raceError,
            "Could not create review schedule.",
          ),
        );
      }
      previous = raced;
    } else {
      previous = created;
    }
  }

  const previousEventId =
    previous.last_event_id == null ? null : Number(previous.last_event_id);
  if (
    previousEventId != null &&
    Number.isFinite(previousEventId) &&
    eventId <= previousEventId
  ) {
    return;
  }

  const eventTime = new Date(event.created_at).getTime();
  const dueTime = new Date(previous.due_at).getTime();
  if (event.is_correct === true && dueTime > eventTime) {
    const { error } = await admin
      .from("student_review_schedules")
      .update({
        last_event_id: eventId,
        updated_at: new Date().toISOString(),
      })
      .eq("student_id", key.student_id)
      .eq("entity_type", key.entity_type)
      .eq("entity_id", key.entity_id);
    if (error) {
      throw new Error(readErrorMessage(error, "Could not update review schedule."));
    }
    return;
  }

  const intervals = [1, 3, 7, 14, 30, 60, 120, 240, 365];
  const currentStep = Math.max(0, Math.min(9, Number(previous.step) || 0));
  const targetStep = event.is_correct === true ? Math.min(currentStep + 1, 9) : 0;
  const targetDays =
    event.is_correct === true
      ? intervals[Math.max(0, targetStep - 1)] ?? 365
      : 1;
  const dueAt = new Date(eventTime + targetDays * 86_400_000).toISOString();

  const { error: updateError } = await admin
    .from("student_review_schedules")
    .update({
      step: targetStep,
      interval_days: targetDays,
      lapses:
        (Number(previous.lapses) || 0) + (event.is_correct === true ? 0 : 1),
      last_reviewed_at: event.created_at,
      due_at: dueAt,
      last_event_id: eventId,
      updated_at: new Date().toISOString(),
    })
    .eq("student_id", key.student_id)
    .eq("entity_type", key.entity_type)
    .eq("entity_id", key.entity_id);
  if (updateError) {
    throw new Error(readErrorMessage(updateError, "Could not update review schedule."));
  }
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const value = String(error ?? "").trim();
  return value && value !== "[object Object]" ? value : fallback;
}

function isMissingReviewRpc(error: unknown) {
  const source =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code = String(source["code"] ?? "");
  const message = readErrorMessage(error, "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (message.includes("record_review_from_event") &&
      (message.includes("could not find") ||
        message.includes("does not exist") ||
        message.includes("schema cache")))
  );
}

function isMissingReviewStorage(error: unknown) {
  const message = readErrorMessage(error, "").toLowerCase();
  return (
    message.includes("student_review_schedules") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}
