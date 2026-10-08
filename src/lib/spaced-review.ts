/**
 * Deterministic, no-AI V1.0 spaced review algorithm.
 * This is NOT Anki FSRS; promotion must only follow a trusted graded answer.
 * Persistence must enforce unique (student, entity) and idempotent event IDs.
 */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120, 240, 365] as const;
const DAY_MS = 86_400_000;

export type ReviewSchedule = {
  step: number;
  intervalDays: number;
  lapses: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
};
export type ReviewResult = "correct" | "incorrect";

export function initialReviewSchedule(): ReviewSchedule {
  return { step: 0, intervalDays: 0, lapses: 0, dueAt: null, lastReviewedAt: null };
}

export function isReviewDue(schedule: ReviewSchedule, at: Date): boolean {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid date.");
  return schedule.dueAt === null || new Date(schedule.dueAt).getTime() <= at.getTime();
}

export function nextReviewSchedule(
  schedule: ReviewSchedule,
  result: ReviewResult,
  at: Date,
): ReviewSchedule {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid review time.");
  if (result !== "correct" && result !== "incorrect") throw new Error("Invalid review result.");
  // Multiple correct answers before the next due date must not create an
  // infinite acceleration loophole. Incorrect answers may still reset it.
  if (result === "correct" && !isReviewDue(schedule, at)) return schedule;
  const step = result === "correct" ? Math.min(schedule.step + 1, REVIEW_INTERVAL_DAYS.length) : 0;
  const intervalDays = result === "correct"
    ? REVIEW_INTERVAL_DAYS[Math.min(step - 1, REVIEW_INTERVAL_DAYS.length - 1)]!
    : 1;
  return {
    step,
    intervalDays,
    lapses: schedule.lapses + (result === "incorrect" ? 1 : 0),
    lastReviewedAt: at.toISOString(),
    dueAt: new Date(at.getTime() + intervalDays * DAY_MS).toISOString(),
  };
}
