import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hashRuntimePassword,
  verifyRuntimePassword,
} from "@/runtime/auth.server";
import {
  signRuntimeJwt,
  verifyRuntimeJwt,
} from "@/runtime/jwt.server";
import {
  createRuntimeStorageServer,
  createStorageCapability,
  validateRuntimeObjectPath,
  verifyStorageCapability,
} from "@/runtime/storage.server";

const previousJwt = process.env["APP_JWT_SECRET"];
const previousStorage = process.env["APP_STORAGE_SECRET"];
const previousStorageRoot = process.env["LOCAL_STORAGE_ROOT"];
let runtimeStorageRoot: string | null = null;

beforeEach(async () => {
  process.env["APP_JWT_SECRET"] =
    "ci-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  process.env["APP_STORAGE_SECRET"] =
    "ci-storage-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  runtimeStorageRoot = await mkdtemp(
    path.join(tmpdir(), "fluentforge-storage-test-"),
  );
  process.env["LOCAL_STORAGE_ROOT"] = runtimeStorageRoot;
});

afterEach(async () => {
  if (previousJwt === undefined) delete process.env["APP_JWT_SECRET"];
  else process.env["APP_JWT_SECRET"] = previousJwt;

  if (previousStorage === undefined) {
    delete process.env["APP_STORAGE_SECRET"];
  } else {
    process.env["APP_STORAGE_SECRET"] = previousStorage;
  }

  if (runtimeStorageRoot) {
    await rm(runtimeStorageRoot, { recursive: true, force: true });
    runtimeStorageRoot = null;
  }
  if (previousStorageRoot === undefined) {
    delete process.env["LOCAL_STORAGE_ROOT"];
  } else {
    process.env["LOCAL_STORAGE_ROOT"] = previousStorageRoot;
  }
});

describe("plain runtime password hashing", () => {
  it("verifies the correct password and rejects another one", async () => {
    const encoded = await hashRuntimePassword("CorrectHorseBattery9!");
    expect(encoded).not.toContain("CorrectHorseBattery9!");
    await expect(
      verifyRuntimePassword("CorrectHorseBattery9!", encoded),
    ).resolves.toBe(true);
    await expect(
      verifyRuntimePassword("wrong-password", encoded),
    ).resolves.toBe(false);
  });

  it("uses a fresh salt for each password hash", async () => {
    const first = await hashRuntimePassword("SamePassword123!");
    const second = await hashRuntimePassword("SamePassword123!");
    expect(first).not.toBe(second);
  });
});

describe("plain runtime JWT", () => {
  it("round-trips authenticated claims", () => {
    const token = signRuntimeJwt({
      sub: "c8f2fc95-6013-4fe3-8c8d-5da898cc87aa",
      role: "authenticated",
      session_id: "36b10409-a1c4-41cf-8ba8-1e314dd331a3",
      email: "teacher@example.local",
      expiresInSeconds: 300,
    });

    const claims = verifyRuntimeJwt(token);
    expect(claims.sub).toBe(
      "c8f2fc95-6013-4fe3-8c8d-5da898cc87aa",
    );
    expect(claims.role).toBe("authenticated");
    expect(claims.session_id).toBe(
      "36b10409-a1c4-41cf-8ba8-1e314dd331a3",
    );
  });

  it("rejects a modified signature", () => {
    const token = signRuntimeJwt({
      sub: "c8f2fc95-6013-4fe3-8c8d-5da898cc87aa",
      role: "authenticated",
      expiresInSeconds: 300,
    });
    const tampered =
      token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(() => verifyRuntimeJwt(tampered)).toThrow(/invalid token/i);
  });
});

describe("plain runtime storage capabilities", () => {
  it("round-trips a scoped upload capability", () => {
    const token = createStorageCapability(
      "upload",
      "media",
      "audio/2026/10/test.mp3",
      300,
    );
    expect(verifyStorageCapability(token, "upload")).toMatchObject({
      op: "upload",
      bucket: "media",
      path: "audio/2026/10/test.mp3",
    });
    expect(() => verifyStorageCapability(token, "read")).toThrow(
      /operation mismatch/i,
    );
  });

  it("blocks path traversal", () => {
    expect(() => validateRuntimeObjectPath("../secret")).toThrow();
    expect(() => validateRuntimeObjectPath("a/../../secret")).toThrow();
    expect(() => validateRuntimeObjectPath("/absolute/path")).toThrow();
    expect(() => validateRuntimeObjectPath("safe/file.pdf")).not.toThrow();
  });

  it("lists uploaded objects inside nested source folders", async () => {
    const storage = createRuntimeStorageServer();
    const source = storage.from("sources");
    const object = "2026/10/import-fixture.pdf";

    const upload = await source.upload(
      object,
      Buffer.from("pdf fixture", "utf8"),
      { contentType: "application/pdf", upsert: false },
    );
    expect(upload.error).toBeNull();

    const listed = await source.list("2026/10", {
      search: "import-fixture.pdf",
      limit: 10,
    });
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(1);
    expect(listed.data?.[0]?.name).toBe("import-fixture.pdf");
    expect(Number(listed.data?.[0]?.metadata?.["size"])).toBeGreaterThan(0);
  });
});
