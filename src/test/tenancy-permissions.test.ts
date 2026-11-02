import { describe, expect, it } from "vitest";
import { mayPerformTenantAction as allowed } from "@/lib/tenancy-permissions";
const tenantA = "tenant-A"; const tenantB = "tenant-B";

describe("V1.1 planned role boundaries", () => {
  it("admin can manage teachers and view group/student summaries only", () => {
    const admin = { role: "platform_admin" } as const;
    for (const permission of [
      "teachers:list", "teachers:create", "teachers:archive",
      "teachers:reset_password", "teachers:summary",
      "groups:summary", "students:summary",
    ] as const) expect(allowed(admin, permission)).toBe(true);
    for (const permission of [
      "teacher:content_read", "teacher:content_write",
      "teacher:review_answers", "teacher:release_results",
      "student:learning_read", "student:attempt_write",
    ] as const) expect(allowed(admin, permission)).toBe(false);
  });

  it("teacher access is denied to other or absent tenant", () => {
    const a = { role: "teacher", tenantId: tenantA } as const;
    expect(allowed(a, "teacher:content_read", { tenantId: tenantA })).toBe(true);
    expect(allowed(a, "teacher:content_read", { tenantId: tenantB })).toBe(false);
    expect(allowed(a, "teacher:content_read")).toBe(false);
    expect(allowed(a, "teachers:reset_password", { tenantId: tenantA })).toBe(false);
  });

  it("student cannot read any other student, including their teacher's peers", () => {
    const student = { role: "student", tenantId: tenantA, studentId: "student-1" } as const;
    expect(allowed(student, "student:learning_read", {tenantId: tenantA, studentId:"student-1"})).toBe(true);
    expect(allowed(student, "student:learning_read", {tenantId: tenantA, studentId:"student-2"})).toBe(false);
    expect(allowed(student, "student:learning_read", {tenantId: tenantB, studentId:"student-1"})).toBe(false);
    expect(allowed(student, "teacher:content_read", {tenantId: tenantA, studentId:"student-1"})).toBe(false);
  });
});
