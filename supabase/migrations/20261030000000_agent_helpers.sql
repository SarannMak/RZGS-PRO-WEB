-- Read-only helper functions for the Telegram monitoring agent.
-- Callable ONLY by service_role (the Edge Function); never by anon/authenticated.

create or replace function public.agent_security_report()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '[]'::jsonb),
    'rls_tables_without_policies', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)), '[]'::jsonb),
    'security_definer_functions_exposed', coalesce((
      select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'execute')), '[]'::jsonb)
  );
$$;

create or replace function public.agent_activity_report(hours int default 24)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'window_hours', hours,
    'new_users', (select count(*) from auth.users where created_at > now() - make_interval(hours => hours)),
    'sign_ins', (select count(*) from auth.users where last_sign_in_at > now() - make_interval(hours => hours)),
    'total_users', (select count(*) from auth.users),
    'unconfirmed_users', (select count(*) from auth.users where email_confirmed_at is null),
    'failed_logins', (select count(*) from auth.audit_log_entries
        where created_at > now() - make_interval(hours => hours)
          and payload->>'action' in ('login_failed','user_signedup_failed'))
  );
$$;

revoke all on function public.agent_security_report() from public, anon, authenticated;
revoke all on function public.agent_activity_report(int) from public, anon, authenticated;
grant execute on function public.agent_security_report() to service_role;
grant execute on function public.agent_activity_report(int) to service_role;

-- Audit trail of every command the agent receives (denied attempts included).
create table if not exists public.agent_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  tg_user_id bigint,
  command text,
  allowed boolean not null
);
alter table public.agent_audit enable row level security;  -- no policies: service_role only
