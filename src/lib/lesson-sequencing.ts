/** Domain rules only. Authorization, canonical grading and persistence live server-side. */
export type LessonCompletionMode = "view" | "attempt" | "pass";
export type LessonStepRule = {
  id: string;
  required: boolean;
  mode: LessonCompletionMode;
  minScorePercent?: number;
};

export type LessonStepOutcome = {
  id: string;
  viewed?: boolean;
  attempted?: boolean;
  bestScorePercent?: number | null;
  teacherApproved?: boolean;
};

export type LessonStepView = LessonStepRule & {
  state: "locked" | "available" | "completed";
};

export function validateLessonStepRules(steps: readonly LessonStepRule[]): void {
  if (steps.length > 100) throw new Error("Lesson exceeds the 100-step limit.");
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.id.trim() || seen.has(step.id)) throw new Error("Lesson step IDs must be unique and non-empty.");
    seen.add(step.id);
    if (step.mode === "pass") {
      if (
        typeof step.minScorePercent !== "number" ||
        !Number.isFinite(step.minScorePercent) ||
        step.minScorePercent < 0 ||
        step.minScorePercent > 100
      ) throw new Error("Passing steps require a score threshold of 0–100.");
    }
  }
}

export function evaluateLessonProgress(
  steps: readonly LessonStepRule[],
  outcomes: readonly LessonStepOutcome[],
  sequential = true,
): { steps: LessonStepView[]; complete: boolean; completedRequired: number; totalRequired: number; nextStepId: string | null } {
  validateLessonStepRules(steps);
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  let requiredBlocked = false;
  let completedRequired = 0;
  let totalRequired = 0;
  let nextStepId: string | null = null;
  const views = steps.map((step): LessonStepView => {
    const outcome = byId.get(step.id);
    const score = outcome?.bestScorePercent;
    const completed =
      outcome?.teacherApproved === true ||
      (step.mode === "view" && outcome?.viewed === true) ||
      (step.mode === "attempt" && outcome?.attempted === true) ||
      (step.mode === "pass" && typeof score === "number" &&
        Number.isFinite(score) && score >= (step.minScorePercent ?? 101));
    const locked = sequential && requiredBlocked && !completed;
    const state = completed ? "completed" : locked ? "locked" : "available";
    if (step.required) {
      totalRequired++;
      if (completed) completedRequired++;
      if (!completed) requiredBlocked = true;
    }
    if (nextStepId === null && state === "available") nextStepId = step.id;
    return { ...step, state };
  });
  return {
    steps: views,
    complete: completedRequired === totalRequired,
    completedRequired,
    totalRequired,
    nextStepId,
  };
}
