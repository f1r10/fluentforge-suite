import { describe, expect, it } from "vitest";
import {
  validateBrandingAssetRequest,
  verifyBrandingAssetBytes,
} from "@/lib/branding-assets";

describe("branding asset request validation", () => {
  it("accepts supported logo formats", () => {
    expect(
      validateBrandingAssetRequest(
        "logo",
        "brand.jpeg",
        "image/jpeg",
        1000,
      ),
    ).toEqual({
      extension: "jpg",
      contentType: "image/jpeg",
    });
  });

  it("accepts supported login background formats", () => {
    expect(
      validateBrandingAssetRequest(
        "login_image",
        "login.webp",
        "image/webp",
        2048,
      ),
    ).toEqual({
      extension: "webp",
      contentType: "image/webp",
    });
  });

  it("rejects SVG logos", () => {
    expect(() =>
      validateBrandingAssetRequest(
        "logo",
        "brand.svg",
        "image/svg+xml",
        1000,
      ),
    ).toThrow(/PNG, JPEG or WebP/i);
  });

  it("allows ICO favicon when browser MIME is empty", () => {
    expect(
      validateBrandingAssetRequest("favicon", "favicon.ico", "", 1000),
    ).toEqual({
      extension: "ico",
      contentType: "image/x-icon",
    });
  });

  it("enforces favicon size limit", () => {
    expect(() =>
      validateBrandingAssetRequest(
        "favicon",
        "favicon.png",
        "image/png",
        1024 * 1024 + 1,
      ),
    ).toThrow(/1 MB/i);
  });
});

describe("branding asset byte signatures", () => {
  it("accepts a PNG signature", () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(verifyBrandingAssetBytes("logo", "logo/test.png", bytes)).toBe(
      "png",
    );
  });

  it("accepts an ICO signature only for favicon", () => {
    const bytes = Uint8Array.from([
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ]);
    expect(
      verifyBrandingAssetBytes(
        "favicon",
        "favicon/test.ico",
        bytes,
      ),
    ).toBe("ico");
    expect(() =>
      verifyBrandingAssetBytes("logo", "logo/test.ico", bytes),
    ).toThrow();
  });

  it("rejects extension/signature mismatch", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    expect(() =>
      verifyBrandingAssetBytes("logo", "logo/test.png", jpeg),
    ).toThrow(/does not match/i);
  });
});
