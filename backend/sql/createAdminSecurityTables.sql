create table if not exists public.admin_sessions (
  id bigserial primary key,
  token_hash text not null unique,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  last_used_at timestamp with time zone,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone default now()
);

create index if not exists admin_sessions_token_hash_idx
on public.admin_sessions(token_hash);

create index if not exists admin_sessions_active_idx
on public.admin_sessions(expires_at, revoked_at);

create table if not exists public.admin_audit_logs (
  id bigserial primary key,
  session_id bigint references public.admin_sessions(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  request_json jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone default now()
);

create index if not exists admin_audit_logs_created_at_idx
on public.admin_audit_logs(created_at desc);

create index if not exists admin_audit_logs_entity_idx
on public.admin_audit_logs(entity_type, entity_id);
