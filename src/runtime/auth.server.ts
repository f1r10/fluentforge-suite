import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { signRuntimeJwt } from "./jwt.server";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;

type DataClient = any;

type RuntimeUser = {
  id: string;
  email: string;
  disabled: boolean;
};

function authError(message: string) {
  return new Error(message);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scrypt(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

export async function hashRuntimePassword(password: string) {
  if (password.length < 8 || password.length > 500) {
    throw authError("Password length is not valid.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt);
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyRuntimePassword(
  password: string,
  encoded: string,
) {
  const [algorithm, n, r, p, saltValue, hashValue, extra] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    extra ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(password, salt);
    return (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

async function issueSession(
  service: DataClient,
  user: RuntimeUser,
  sessionId = randomUUID(),
) {
  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(
    Date.now() + REFRESH_TTL_SECONDS * 1000,
  ).toISOString();

  const { error } = await service
    .from("runtime_refresh_tokens")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      token_hash: sha256(refreshToken),
      expires_at: expiresAt,
    });
  if (error) throw authError(error.message);

  return {
    access_token: signRuntimeJwt({
      sub: user.id,
      role: "authenticated",
      session_id: sessionId,
      email: user.email,
      aud: "authenticated",
      expiresInSeconds: ACCESS_TTL_SECONDS,
    }),
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL_SECONDS,
    token_type: "bearer",
  };
}

export function createRuntimeAdminAuth(service: DataClient) {
  return {
    admin: {
      async createUser(input: {
        email?: string;
        password?: string;
        email_confirm?: boolean;
      }) {
        try {
          const email = String(input.email ?? "").trim().toLowerCase();
          const password = String(input.password ?? "");
          if (!email) throw authError("Email is required.");

          const passwordHash = await hashRuntimePassword(password);
          const { data, error } = await service
            .from("runtime_auth_users")
            .insert({
              email,
              password_hash: passwordHash,
            })
            .select("id,email,disabled")
            .single();
          if (error || !data) throw authError(error?.message ?? "Create user failed.");

          return {
            data: {
              user: {
                id: data.id,
                email: data.email,
              },
            },
            error: null,
          };
        } catch (error) {
          return {
            data: { user: null },
            error: error instanceof Error ? error : authError(String(error)),
          };
        }
      },

      async getUserById(id: string) {
        const { data, error } = await service
          .from("runtime_auth_users")
          .select("id,email,disabled")
          .eq("id", id)
          .maybeSingle();
        return {
          data: {
            user: data
              ? {
                  id: data.id,
                  email: data.email,
                  banned_until: data.disabled ? "2999-01-01T00:00:00Z" : null,
                }
              : null,
          },
          error: error ? authError(error.message) : null,
        };
      },

      async updateUserById(
        id: string,
        input: { password?: string; email?: string },
      ) {
        try {
          const update: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (input.password != null) {
            update["password_hash"] = await hashRuntimePassword(
              input.password,
            );
          }
          if (input.email != null) {
            update["email"] = input.email.trim().toLowerCase();
          }

          const { data, error } = await service
            .from("runtime_auth_users")
            .update(update)
            .eq("id", id)
            .select("id,email,disabled")
            .maybeSingle();
          if (error || !data) {
            throw authError(error?.message ?? "User not found.");
          }

          if (input.password != null) {
            await service
              .from("runtime_refresh_tokens")
              .update({ revoked_at: new Date().toISOString() })
              .eq("user_id", id)
              .is("revoked_at", null);
          }

          return {
            data: {
              user: {
                id: data.id,
                email: data.email,
              },
            },
            error: null,
          };
        } catch (error) {
          return {
            data: { user: null },
            error: error instanceof Error ? error : authError(String(error)),
          };
        }
      },

      async deleteUser(id: string) {
        const { error } = await service
          .from("runtime_auth_users")
          .delete()
          .eq("id", id);
        return {
          data: { user: null },
          error: error ? authError(error.message) : null,
        };
      },
    },
  };
}

export function createRuntimePublicAuth(service: DataClient) {
  return {
    async signInWithPassword(input: {
      email: string;
      password: string;
    }) {
      try {
        const email = input.email.trim().toLowerCase();
        const { data: row, error } = await service
          .from("runtime_auth_users")
          .select("id,email,password_hash,disabled")
          .ilike("email", email)
          .maybeSingle();
        if (error) throw authError(error.message);
        if (
          !row ||
          row.disabled ||
          !(await verifyRuntimePassword(
            input.password,
            row.password_hash,
          ))
        ) {
          throw authError("Invalid login credentials");
        }

        const user: RuntimeUser = {
          id: row.id,
          email: row.email,
          disabled: row.disabled,
        };
        const tokens = await issueSession(service, user);

        return {
          data: {
            user: { id: user.id, email: user.email },
            session: {
              ...tokens,
              user: { id: user.id, email: user.email },
            },
          },
          error: null,
        };
      } catch (error) {
        return {
          data: { user: null, session: null },
          error: error instanceof Error ? error : authError(String(error)),
        };
      }
    },
  };
}

export async function refreshRuntimeSession(
  service: DataClient,
  refreshToken: string,
) {
  const hash = sha256(refreshToken);
  const { data: row, error } = await service
    .from("runtime_refresh_tokens")
    .select(
      "id,user_id,session_id,expires_at,revoked_at,runtime_auth_users!inner(id,email,disabled)",
    )
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !row) throw authError("Refresh token is not valid.");
  if (
    row.revoked_at ||
    Date.now() >= new Date(row.expires_at).getTime()
  ) {
    throw authError("Refresh token expired.");
  }

  const nested = row.runtime_auth_users as
    | RuntimeUser
    | RuntimeUser[]
    | null;
  const user = Array.isArray(nested) ? nested[0] : nested;
  if (!user || user.disabled) throw authError("Account is disabled.");

  const nextRefresh = randomBytes(48).toString("base64url");
  const expiresAt = new Date(
    Date.now() + REFRESH_TTL_SECONDS * 1000,
  ).toISOString();

  const { error: rotateError } = await service
    .from("runtime_refresh_tokens")
    .update({
      token_hash: sha256(nextRefresh),
      expires_at: expiresAt,
    })
    .eq("id", row.id)
    .eq("token_hash", hash);
  if (rotateError) throw authError(rotateError.message);

  return {
    access_token: signRuntimeJwt({
      sub: user.id,
      role: "authenticated",
      session_id: row.session_id,
      email: user.email,
      aud: "authenticated",
      expiresInSeconds: ACCESS_TTL_SECONDS,
    }),
    refresh_token: nextRefresh,
    expires_in: ACCESS_TTL_SECONDS,
    token_type: "bearer",
    user: { id: user.id, email: user.email },
  };
}

export async function revokeRuntimeRefreshToken(
  service: DataClient,
  refreshToken: string,
) {
  const { error } = await service
    .from("runtime_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", sha256(refreshToken))
    .is("revoked_at", null);
  if (error) throw authError(error.message);
}
