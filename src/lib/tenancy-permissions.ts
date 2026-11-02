/** V1.1 authorization contract, NOT a substitute for server checks or RLS.
 * No platform admin login is enabled until tenant backfill and RLS hardening
 * are completed in a separate migration and all endpoints are audited.
 */
export type PlatformActor =
  | { role: "platform_admin" }
  | { role: "teacher"; tenantId: string }
  | { role: "student"; tenantId: string; studentId: string };

export type TenantCapability =
  | "teachers:list" | "teachers:create" | "teachers:archive"
  | "teachers:reset_password" | "teachers:summary"
  | "groups:summary" | "students:summary"
  | "teacher:content_read" | "teacher:content_write"
  | "teacher:review_answers" | "teacher:release_results"
  | "student:learning_read" | "student:attempt_write";

/** Pure policy for front-end affordances and future server-side assertions.
 * Missing or mismatched tenant IDs MUST DENY. Caller cannot choose target.
 */
export function mayPerformTenantAction(
  actor: PlatformActor,
  capability: TenantCapability,
  target: { tenantId?: string; studentId?: string } = {},
): boolean {
  if (actor.role === "platform_admin") {
    return [
      "teachers:list", "teachers:create", "teachers:archive",
      "teachers:reset_password", "teachers:summary",
      "groups:summary", "students:summary",
    ].includes(capability);
  }

  if (!target.tenantId || target.tenantId !== actor.tenantId) return false;

  if (actor.role === "teacher") {
    return [
      "groups:summary", "students:summary", "teacher:content_read",
      "teacher:content_write", "teacher:review_answers",
      "teacher:release_results",
    ].includes(capability);
  }

  return target.studentId === actor.studentId &&
    ["student:learning_read", "student:attempt_write"].includes(capability);
}
