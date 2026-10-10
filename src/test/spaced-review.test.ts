import { describe, expect, it } from "vitest";
import { initialReviewSchedule, isReviewDue, nextReviewSchedule } from "@/lib/spaced-review";

describe("deterministic spaced reviews", () => {
  const day0 = new Date("2026-10-08T12:00:00.000Z");
  it("schedules 1, 3, 7, 14 days after successful due reviews", () => {
    let schedule = initialReviewSchedule();
    for (const [i, interval] of [1, 3, 7, 14].entries()) {
      const when = i === 0 ? day0 : new Date(schedule.dueAt!);
      schedule = nextReviewSchedule(schedule, "correct", when);
      expect(schedule.intervalDays).toBe(interval);
      expect(schedule.step).toBe(i + 1);
    }
  });
  it("does not advance correctly answered items repeatedly before due", () => {
    const once = nextReviewSchedule(initialReviewSchedule(), "correct", day0);
    expect(nextReviewSchedule(once, "correct", new Date("2026-10-08T13:00:00.000Z"))).toEqual(once);
    expect(isReviewDue(once, new Date("2026-10-09T12:00:00.000Z"))).toBe(true);
  });
  it("resets on failure and keeps lapse count", () => {
    const once = nextReviewSchedule(initialReviewSchedule(), "correct", day0);
    const reset = nextReviewSchedule(once, "incorrect", day0);
    expect(reset.step).toBe(0);
    expect(reset.intervalDays).toBe(1);
    expect(reset.lapses).toBe(1);
    expect(reset.lastReviewedAt).toBe(day0.toISOString());
  });
  it("keeps missed reviews due without automatic punishment", () => {
    const once = nextReviewSchedule(initialReviewSchedule(), "correct", day0);
    expect(isReviewDue(once, new Date("2027-01-01T00:00:00.000Z"))).toBe(true);
    expect(once.lapses).toBe(0);
  });
  it("rejects invalid timestamps", () => {
    expect(() => nextReviewSchedule(initialReviewSchedule(), "correct", new Date("invalid"))).toThrow(/Invalid review time/);
  });
});
