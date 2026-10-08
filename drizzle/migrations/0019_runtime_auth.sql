-- Provider-neutral auth storage used by RUNTIME_BACKEND=postgres.
-- Supabase-backed deployments leave these tables unused.

create table if not exists public.runtime_auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists runtime_auth_users_email_lower_uidx
  on public.runtime_auth_users(lower(email));

create table if not exists public.runtime_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.runtime_auth_users(id)
    on delete cascade,
  session_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists runtime_refresh_tokens_user_active_idx
  on public.runtime_refresh_tokens(user_id, expires_at desc)
  where revoked_at is null;

alter table public.runtime_auth_users enable row level security;
alter table public.runtime_refresh_tokens enable row level security;

revoke all on public.runtime_auth_users from anon, authenticated;
revoke all on public.runtime_refresh_tokens from anon, authenticated;

grant all on public.runtime_auth_users to service_role;
grant all on public.runtime_refresh_tokens to service_role;
