export type ResultVisibility =
  | "never"
  | "after_submit"
  | "after_close"
  | "after_approval";

export function calculateExamDeadline(
  startedAt: Date,
  durationMinutes: number | null,
  closeAt: string | null,
  fullDurationAfterStart: boolean,
) {
  const durationDeadline =
    durationMinutes == null
      ? null
      : new Date(startedAt.getTime() + durationMinutes * 60_000);
  const closeDeadline = closeAt ? new Date(closeAt) : null;

  if (fullDurationAfterStart) {
    return durationDeadline ?? closeDeadline;
  }

  if (durationDeadline && closeDeadline) {
    return durationDeadline.getTime() <= closeDeadline.getTime()
      ? durationDeadline
      : closeDeadline;
  }

  return durationDeadline ?? closeDeadline;
}

export function isExamDeadlineExpired(
  deadlineAt: string | null,
  now = Date.now(),
) {
  return !!deadlineAt && now >= new Date(deadlineAt).getTime();
}

export function isResultContentVisible(
  mode: ResultVisibility,
  input: {
    submittedAt: string | null;
    closeAt: string | null;
    resultReleased: boolean;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();

  if (mode === "never") return false;
  if (mode === "after_submit") return !!input.submittedAt;
  if (mode === "after_close") {
    return !!input.closeAt && now >= new Date(input.closeAt).getTime();
  }
  return input.resultReleased;
}

export function tabSwitchLimitExceeded(
  tabHiddenCount: number,
  maxTabSwitches: number | null,
) {
  return maxTabSwitches != null && tabHiddenCount > maxTabSwitches;
}
