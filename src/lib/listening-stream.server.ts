import { timingSafeEqual } from "node:crypto";
import { adminClient, sha256 } from "./security.server";

export async function streamExamListening(
  request: Request,
  headOnly = false,
) {
  const url = new URL(request.url);
  const leaseId = url.searchParams.get("lease") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!isUuid(leaseId) || !/^[A-Za-z0-9]{48}$/.test(token)) {
    return textResponse("Invalid playback capability.", 400);
  }

  const range = request.headers.get("range");
  if (range && !/^bytes=\d*-\d*$/.test(range.trim())) {
    return new Response(null, { status: 416, headers: securityHeaders() });
  }

  const admin = await adminClient();
  const { data: lease, error: leaseError } = await admin
    .from("exam_listening_plays")
    .select(
      "id,attempt_id,student_id,listening_id,stream_token_hash,expires_at,completed_at",
    )
    .eq("id", leaseId)
    .maybeSingle();

  if (leaseError) return textResponse("Playback unavailable.", 500);
  if (!lease?.stream_token_hash) return textResponse("Playback not found.", 404);

  if (!safeHashEqual(sha256(token), lease.stream_token_hash)) {
    return textResponse("Playback capability rejected.", 403);
  }

  if (lease.completed_at || Date.now() >= new Date(lease.expires_at).getTime()) {
    return textResponse("Playback lease expired.", 410);
  }

  const { data: attempt, error: attemptError } = await admin
    .from("exam_attempts")
    .select("id,student_id,status,deadline_at,snapshot")
    .eq("id", lease.attempt_id)
    .eq("student_id", lease.student_id)
    .maybeSingle();

  if (attemptError) return textResponse("Playback unavailable.", 500);
  if (!attempt || attempt.status !== "in_progress") {
    return textResponse("Exam attempt is not active.", 410);
  }
  if (
    attempt.deadline_at &&
    Date.now() >= new Date(attempt.deadline_at).getTime()
  ) {
    return textResponse("Exam deadline expired.", 410);
  }

  const listening = findListening(attempt.snapshot, lease.listening_id);
  const media =
    listening?.["media"] && typeof listening["media"] === "object"
      ? (listening["media"] as Record<string, unknown>)
      : null;
  const storagePath =
    typeof media?.["storage_path"] === "string"
      ? media["storage_path"]
      : null;

  if (!storagePath) {
    return textResponse("Private listening media is unavailable.", 409);
  }

  const signedSeconds = Math.max(
    1,
    Math.min(
      60,
      Math.ceil((new Date(lease.expires_at).getTime() - Date.now()) / 1000),
    ),
  );
  const { data: signed, error: signedError } = await admin.storage
    .from("media")
    .createSignedUrl(storagePath, signedSeconds);
  if (signedError || !signed?.signedUrl) {
    return textResponse("Could not authorize media stream.", 502);
  }

  const upstreamHeaders = new Headers({ "accept-encoding": "identity" });
  if (range) upstreamHeaders.set("range", range);

  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      method: headOnly ? "HEAD" : "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch {
    return textResponse("Media storage is unavailable.", 502);
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(null, {
      status: upstream.status === 404 || upstream.status === 416
        ? upstream.status
        : 502,
      headers: securityHeaders(),
    });
  }

  const headers = securityHeaders();
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set(
      "content-type",
      typeof media?.["mime_type"] === "string"
        ? media["mime_type"]
        : "application/octet-stream",
    );
  }
  headers.set("content-disposition", "inline");

  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function findListening(
  value: unknown,
  listeningId: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findListening(child, listeningId);
      if (found) return found;
    }
    return null;
  }

  const row = value as Record<string, unknown>;
  if (
    row["kind"] === "listening" &&
    row["listening"] &&
    typeof row["listening"] === "object"
  ) {
    const listening = row["listening"] as Record<string, unknown>;
    if (String(listening["id"] ?? "") === listeningId) return listening;
  }

  for (const child of Object.values(row)) {
    const found = findListening(child, listeningId);
    if (found) return found;
  }
  return null;
}

function safeHashEqual(left: string, right: string) {
  if (
    !/^[a-f0-9]{64}$/.test(left) ||
    !/^[a-f0-9]{64}$/.test(right)
  ) {
    return false;
  }
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function securityHeaders() {
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function textResponse(message: string, status: number) {
  const headers = securityHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(message, { status, headers });
}
