import { PostgrestClient } from "@supabase/postgrest-js";
import {
  createRuntimeAdminAuth,
  createRuntimePublicAuth,
} from "./auth.server";
import {
  serviceRoleJwt,
  verifyRuntimeJwt,
} from "./jwt.server";
import { createRuntimeStorageServer } from "./storage.server";

function restUrl() {
  const value = process.env["POSTGREST_URL"]?.trim();
  if (!value) {
    throw new Error(
      "POSTGREST_URL is required when RUNTIME_BACKEND=postgres.",
    );
  }
  return value.replace(/\/$/, "");
}

function restClient(token?: string) {
  return new PostgrestClient(restUrl(), {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : {},
  });
}

function compatibleClient(
  data: ReturnType<typeof restClient>,
  extra: Record<string, unknown>,
) {
  return {
    from: data.from.bind(data),
    rpc: data.rpc.bind(data),
    schema: data.schema.bind(data),
    ...extra,
  };
}

export function createRuntimeAdminClient() {
  const serviceData = restClient(serviceRoleJwt());
  return compatibleClient(serviceData, {
    storage: createRuntimeStorageServer(),
    auth: createRuntimeAdminAuth(serviceData),
  });
}

export function createRuntimePublicClient() {
  const anonymousData = restClient();
  const serviceData = restClient(serviceRoleJwt());
  return compatibleClient(anonymousData, {
    auth: createRuntimePublicAuth(serviceData),
  });
}

export function createRuntimeAuthenticatedClient(token: string) {
  const claims = verifyRuntimeJwt(token);
  if (claims.role !== "authenticated") {
    throw new Error("Unauthorized: invalid runtime role.");
  }
  const data = restClient(token);
  return {
    client: compatibleClient(data, {}),
    claims,
  };
}

export function runtimeServiceDataClient() {
  return restClient(serviceRoleJwt());
}
