import { describe, expect, it } from "vitest";
import {
  calculateExamDeadline,
  isExamDeadlineExpired,
  isResultContentVisible,
  tabSwitchLimitExceeded,
} from "@/lib/exam-policy";

describe("exam timing policy", () => {
  const start = new Date("2026-10-06T10:00:00.000Z");

  it("gives the full duration after start when that policy is enabled", () => {
    const deadline = calculateExamDeadline(
      start,
      60,
      "2026-10-06T10:30:00.000Z",
      true,
    );
    expect(deadline?.toISOString()).toBe("2026-10-06T11:00:00.000Z");
  });

  it("uses the earlier exam close time when full-duration-after-start is disabled", () => {
    const deadline = calculateExamDeadline(
      start,
      60,
      "2026-10-06T10:30:00.000Z",
      false,
    );
    expect(deadline?.toISOString()).toBe("2026-10-06T10:30:00.000Z");
  });

  it("uses the close time when there is no per-attempt duration", () => {
    const deadline = calculateExamDeadline(
      start,
      null,
      "2026-10-06T12:00:00.000Z",
      true,
    );
    expect(deadline?.toISOString()).toBe("2026-10-06T12:00:00.000Z");
  });

  it("treats the exact deadline as expired", () => {
    expect(
      isExamDeadlineExpired(
        "2026-10-06T10:30:00.000Z",
        new Date("2026-10-06T10:30:00.000Z").getTime(),
      ),
    ).toBe(true);
  });
});

describe("result content visibility", () => {
  const submittedAt = "2026-10-06T10:15:00.000Z";
  const closeAt = "2026-10-06T11:00:00.000Z";

  it("never exposes hidden content", () => {
    expect(
      isResultContentVisible("never", {
        submittedAt,
        closeAt,
        resultReleased: true,
      }),
    ).toBe(false);
  });

  it("allows after-submit content after submission", () => {
    expect(
      isResultContentVisible("after_submit", {
        submittedAt,
        closeAt,
        resultReleased: false,
      }),
    ).toBe(true);
  });

  it("does not expose after-close content before the close time", () => {
    expect(
      isResultContentVisible("after_close", {
        submittedAt,
        closeAt,
        resultReleased: true,
        now: new Date("2026-10-06T10:59:59.000Z").getTime(),
      }),
    ).toBe(false);
  });

  it("exposes after-close content at or after the close time", () => {
    expect(
      isResultContentVisible("after_close", {
        submittedAt,
        closeAt,
        resultReleased: true,
        now: new Date("2026-10-06T11:00:00.000Z").getTime(),
      }),
    ).toBe(true);
  });

  it("uses result release as the approval gate", () => {
    expect(
      isResultContentVisible("after_approval", {
        submittedAt,
        closeAt,
        resultReleased: false,
      }),
    ).toBe(false);
    expect(
      isResultContentVisible("after_approval", {
        submittedAt,
        closeAt,
        resultReleased: true,
      }),
    ).toBe(true);
  });
});

describe("tab switch policy", () => {
  it("permits the configured number and blocks the next one", () => {
    expect(tabSwitchLimitExceeded(2, 2)).toBe(false);
    expect(tabSwitchLimitExceeded(3, 2)).toBe(true);
  });

  it("does not enforce a limit when none is configured", () => {
    expect(tabSwitchLimitExceeded(100, null)).toBe(false);
  });
});
