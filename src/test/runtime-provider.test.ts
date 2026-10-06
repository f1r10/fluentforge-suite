import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashRuntimePassword,
  verifyRuntimePassword,
} from "@/runtime/auth.server";
import {
  signRuntimeJwt,
  verifyRuntimeJwt,
} from "@/runtime/jwt.server";
import {
  createStorageCapability,
  validateRuntimeObjectPath,
  verifyStorageCapability,
} from "@/runtime/storage.server";

const previousJwt = process.env["APP_JWT_SECRET"];
const previousStorage = process.env["APP_STORAGE_SECRET"];

beforeEach(() => {
  process.env["APP_JWT_SECRET"] =
    "ci-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  process.env["APP_STORAGE_SECRET"] =
    "ci-storage-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
});

afterEach(() => {
  if (previousJwt === undefined) delete process.env["APP_JWT_SECRET"];
  else process.env["APP_JWT_SECRET"] = previousJwt;

  if (previousStorage === undefined) {
    delete process.env["APP_STORAGE_SECRET"];
  } else {
    process.env["APP_STORAGE_SECRET"] = previousStorage;
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
});
