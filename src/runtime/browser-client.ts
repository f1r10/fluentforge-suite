type RuntimeTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

type AuthEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "INITIAL_SESSION";

const STORAGE_KEY = "fluentforge.runtime.session.v1";
const listeners = new Set<
  (event: AuthEvent, session: unknown) => void
>();

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded =
      normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadTokens(): RuntimeTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as RuntimeTokens;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTokens(tokens: RuntimeTokens | null) {
  if (typeof window === "undefined") return;
  if (!tokens) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function sessionFrom(tokens: RuntimeTokens | null) {
  if (!tokens) return null;
  const claims = decodePayload(tokens.access_token);
  if (!claims?.["sub"]) return null;
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in ?? null,
    token_type: tokens.token_type ?? "bearer",
    expires_at:
      typeof claims["exp"] === "number"
        ? claims["exp"]
        : null,
    user: {
      id: String(claims["sub"]),
      email:
        typeof claims["email"] === "string"
          ? claims["email"]
          : undefined,
    },
  };
}

function emit(event: AuthEvent, tokens: RuntimeTokens | null) {
  const session = sessionFrom(tokens);
  for (const listener of listeners) {
    try {
      listener(event, session);
    } catch {
      // One UI subscriber must not break auth state delivery.
    }
  }
}

async function refreshIfNeeded(tokens: RuntimeTokens | null) {
  if (!tokens) return null;
  const claims = decodePayload(tokens.access_token);
  const exp =
    typeof claims?.["exp"] === "number" ? claims["exp"] : 0;
  const now = Math.floor(Date.now() / 1000);
  if (exp > now + 30) return tokens;

  try {
    const response = await fetch("/api/runtime-auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        refresh_token: tokens.refresh_token,
      }),
    });
    if (!response.ok) throw new Error("Refresh failed.");
    const next = (await response.json()) as RuntimeTokens;
    saveTokens(next);
    emit("TOKEN_REFRESHED", next);
    return next;
  } catch {
    saveTokens(null);
    emit("SIGNED_OUT", null);
    return null;
  }
}

export function createRuntimeBrowserClient() {
  return {
    auth: {
      async setSession(tokens: RuntimeTokens) {
        saveTokens(tokens);
        const session = sessionFrom(tokens);
        emit("SIGNED_IN", tokens);
        return {
          data: { session, user: session?.user ?? null },
          error: null,
        };
      },

      async getSession() {
        const tokens = await refreshIfNeeded(loadTokens());
        return {
          data: { session: sessionFrom(tokens) },
          error: null,
        };
      },

      async getUser() {
        const tokens = await refreshIfNeeded(loadTokens());
        const session = sessionFrom(tokens);
        if (!session) {
          return {
            data: { user: null },
            error: new Error("Auth session missing."),
          };
        }
        return {
          data: { user: session.user },
          error: null,
        };
      },

      async signOut() {
        const tokens = loadTokens();
        if (tokens?.refresh_token) {
          try {
            await fetch("/api/runtime-auth/logout", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                refresh_token: tokens.refresh_token,
              }),
            });
          } catch {
            // Local logout still proceeds if the server is unreachable.
          }
        }
        saveTokens(null);
        emit("SIGNED_OUT", null);
        return { error: null };
      },

      onAuthStateChange(
        callback: (event: AuthEvent, session: unknown) => void,
      ) {
        listeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                listeners.delete(callback);
              },
            },
          },
        };
      },
    },

    storage: {
      from(bucket: string) {
        return {
          async uploadToSignedUrl(
            path: string,
            token: string,
            file: Blob,
            options?: { contentType?: string; upsert?: boolean },
          ) {
            try {
              const response = await fetch(
                `/api/runtime-storage/upload?token=${encodeURIComponent(
                  token,
                )}`,
                {
                  method: "PUT",
                  headers: {
                    "content-type":
                      options?.contentType ||
                      file.type ||
                      "application/octet-stream",
                    "x-runtime-storage-path": path,
                    "x-runtime-storage-bucket": bucket,
                  },
                  body: file,
                },
              );
              if (!response.ok) {
                throw new Error(
                  (await response.text()) ||
                    `Upload failed with HTTP ${response.status}.`,
                );
              }
              return {
                data: { path },
                error: null,
              };
            } catch (error) {
              return {
                data: null,
                error:
                  error instanceof Error
                    ? error
                    : new Error(String(error)),
              };
            }
          },
        };
      },
    },
  };
}
