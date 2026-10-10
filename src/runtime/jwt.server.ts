import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export type RuntimeJwtClaims = {
  sub: string;
  role: "authenticated" | "service_role";
  session_id?: string;
  email?: string;
  iat: number;
  exp: number;
  aud?: string;
};

function secret() {
  const value = process.env["APP_JWT_SECRET"] ?? "";
  if (value.length < 32) {
    throw new Error(
      "APP_JWT_SECRET must contain at least 32 characters in postgres runtime.",
    );
  }
  return value;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(input: string) {
  return createHmac("sha256", secret())
    .update(input, "utf8")
    .digest("base64url");
}

export function signRuntimeJwt(
  claims: Omit<RuntimeJwtClaims, "iat" | "exp"> & {
    expiresInSeconds: number;
  },
) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: claims.sub,
    role: claims.role,
    session_id: claims.session_id,
    email: claims.email,
    aud: claims.aud,
    iat: now,
    exp: now + Math.max(30, claims.expiresInSeconds),
  });
  const input = `${header}.${payload}`;
  return `${input}.${signature(input)}`;
}

export function verifyRuntimeJwt(token: string): RuntimeJwtClaims {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) {
    throw new Error("Invalid token.");
  }

  const input = `${headerPart}.${payloadPart}`;
  const expected = Buffer.from(signature(input), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new Error("Invalid token.");
  }

  let header: Record<string, unknown>;
  let claims: RuntimeJwtClaims;
  try {
    header = JSON.parse(
      Buffer.from(headerPart, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as RuntimeJwtClaims;
  } catch {
    throw new Error("Invalid token.");
  }

  if (header["alg"] !== "HS256") throw new Error("Invalid token.");
  if (
    !claims.sub ||
    (claims.role !== "authenticated" &&
      claims.role !== "service_role")
  ) {
    throw new Error("Invalid token.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now) {
    throw new Error("Token expired.");
  }

  return claims;
}

export function serviceRoleJwt() {
  return signRuntimeJwt({
    sub: "00000000-0000-0000-0000-000000000000",
    role: "service_role",
    aud: "service_role",
    expiresInSeconds: 60 * 60,
  });
}
