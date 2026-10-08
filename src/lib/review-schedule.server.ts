/**
 * Server-only bridge between trusted grading and the review calendar.
 * The SQL RPC itself checks the event's graded result; browser controls never
 * receive this function. activity_events.id is BIGINT in this project.
 */
type Admin = Awaited<ReturnType<typeof import("./security.server")["adminClient"]>>;

export async function recordReviewEvents(
  admin: Admin,
  events: ReadonlyArray<{ id: string | number }>,
): Promise<void> {
  for (const event of events) {
    const id = Number(event.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid graded activity ID.");
    const { error } = await admin.rpc("record_review_from_event", { p_event_id: id });
    if (error) throw new Error(error.message);
  }
}
