import { describe, expect, it } from "vitest";
import {
  BACKUP_MAGIC,
  BACKUP_SCHEMA,
  BACKUP_TABLES,
  BACKUP_VERSION,
  parseBackupPackage,
  sanitizeBackupRow,
} from "@/lib/backup-format";

function emptyPackage() {
  const tables = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, []]),
  ) as Record<string, Array<Record<string, unknown>>>;
  const rowCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, 0]),
  );

  return {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    schema: BACKUP_SCHEMA,
    product: "FluentForge",
    created_at: "2026-10-06T12:00:00.000Z",
    security: { excluded: ["student_access_keys"] },
    manifest: {
      row_counts: rowCounts,
      storage_objects: 0,
      storage_bytes: 0,
    },
    tables,
    storage: [],
  };
}

describe("FluentForge backup format", () => {
  it("accepts a complete allowlisted empty package", () => {
    const parsed = parseBackupPackage(emptyPackage());
    expect(parsed.magic).toBe(BACKUP_MAGIC);
    expect(Object.keys(parsed.tables)).toHaveLength(BACKUP_TABLES.length);
  });

  it("rejects an unsupported table", () => {
    const payload = emptyPackage();
    payload.tables["admin_recovery_codes"] = [];
    payload.manifest.row_counts["admin_recovery_codes"] = 0;

    expect(() => parseBackupPackage(payload)).toThrow(
      /unsupported table/i,
    );
  });

  it("rejects unsafe storage paths", () => {
    const payload = emptyPackage();
    payload.storage = [
      {
        bucket: "media",
        path: "../secret",
        mime_type: "application/octet-stream",
        size_bytes: 1,
        sha256: "a".repeat(64),
        data_base64: "AA==",
      },
    ];
    payload.manifest.storage_objects = 1;
    payload.manifest.storage_bytes = 1;

    expect(() => parseBackupPackage(payload)).toThrow();
  });

  it("rejects row-count manifest mismatches", () => {
    const payload = emptyPackage();
    payload.manifest.row_counts["students"] = 1;

    expect(() => parseBackupPackage(payload)).toThrow(
      /row count mismatch/i,
    );
  });
});

describe("backup row sanitization", () => {
  it("removes student auth linkage", () => {
    const result = sanitizeBackupRow("students", {
      id: "student-id",
      username: "student",
      auth_user_id: "auth-user-id",
    });

    expect(result?.["auth_user_id"]).toBeNull();
  });

  it("removes the generated question search column", () => {
    const result = sanitizeBackupRow("questions", {
      id: "question-id",
      prompt: "Prompt",
      search: "generated value",
    });

    expect(result).not.toHaveProperty("search");
  });

  it("drops non-allowlisted system settings", () => {
    expect(
      sanitizeBackupRow("system_settings", {
        key: "private_api_secret",
        value: { token: "secret" },
      }),
    ).toBeNull();
  });

  it("keeps safe branding settings", () => {
    expect(
      sanitizeBackupRow("system_settings", {
        key: "branding",
        value: { system_name: "FluentForge" },
      }),
    ).not.toBeNull();
  });
});
