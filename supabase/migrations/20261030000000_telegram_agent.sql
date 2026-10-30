-- Storage for the Telegram guardian agent (edge function: telegram-agent).
-- Only the service role touches these tables: RLS is on and there are no policies.

create table if not exists public.agent_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_audit (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text not null,
  kind   text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists agent_audit_at_idx on public.agent_audit (at desc);

create table if not exists public.agent_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_pending (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  params     jsonb not null,
  summary    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  used_at    timestamptz
);

alter table public.agent_updates enable row level security;
alter table public.agent_audit   enable row level security;
alter table public.agent_state   enable row level security;
alter table public.agent_pending enable row level security;

revoke all on public.agent_updates, public.agent_audit, public.agent_state, public.agent_pending from anon, authenticated;
