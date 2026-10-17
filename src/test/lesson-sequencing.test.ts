import { describe, expect, it } from "vitest";
import { evaluateLessonProgress, validateLessonStepRules } from "@/lib/lesson-sequencing";

const steps = [
  { id: "theory", required: true, mode: "view" as const },
  { id: "words", required: false, mode: "attempt" as const },
  { id: "quiz", required: true, mode: "pass" as const, minScorePercent: 70 },
];

describe("lesson sequencing", () => {
  it("locks later activities after an unfinished required step", () => {
    const result = evaluateLessonProgress(steps, []);
    expect(result.steps.map((step) => step.state)).toEqual(["available", "locked", "locked"]);
    expect(result.complete).toBe(false);
    expect(result.nextStepId).toBe("theory");
  });
  it("an optional step does not block the next required step", () => {
    const result = evaluateLessonProgress(steps, [{ id: "theory", viewed: true }]);
    expect(result.steps.map((step) => step.state)).toEqual(["completed", "available", "available"]);
    expect(result.nextStepId).toBe("words");
  });
  it("requires passing grade, and preserves previous successful outcomes", () => {
    expect(evaluateLessonProgress(steps, [
      { id: "theory", viewed: true }, { id: "quiz", attempted: true, bestScorePercent: 69 },
    ]).complete).toBe(false);
    expect(evaluateLessonProgress(steps, [
      { id: "theory", viewed: true }, { id: "quiz", bestScorePercent: 70 },
    ]).complete).toBe(true);
  });
  it("supports free-order mode without allowing fake grades", () => {
    const result = evaluateLessonProgress(steps, [], false);
    expect(result.steps.every((step) => step.state === "available")).toBe(true);
    expect(result.complete).toBe(false);
  });
  it("rejects invalid lesson definitions", () => {
    expect(() => validateLessonStepRules([
      { id: "a", required: true, mode: "pass" },
    ])).toThrow(/threshold/i);
    expect(() => validateLessonStepRules([
      { id: "a", required: true, mode: "view" },
      { id: "a", required: true, mode: "view" },
    ])).toThrow(/unique/i);
  });
});
