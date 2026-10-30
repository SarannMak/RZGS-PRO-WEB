-- Fixed, read-only monitoring functions. The agent can call only these; callable by service_role only.

create or replace function public.monitor_security_audit()
returns jsonb language sql security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'tables_without_rls', (select coalesce(jsonb_agg(tablename), '[]') from pg_tables where schemaname = 'public' and not rowsecurity),
    'anon_can_select', (select coalesce(jsonb_agg(distinct table_name), '[]') from information_schema.role_table_grants
                        where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT')
  );
$$;

create or replace function public.monitor_recent_activity(p_hours int default 24)
returns jsonb language sql security definer set search_path = public, auth, pg_catalog as $$
  select jsonb_build_object(
    'signups', (select count(*) from auth.users where created_at > now() - make_interval(hours => p_hours)),
    'sign_ins', (select count(*) from auth.users where last_sign_in_at > now() - make_interval(hours => p_hours)),
    'unconfirmed_signups', (select count(*) from auth.users where email_confirmed_at is null and created_at > now() - make_interval(hours => p_hours))
  );
$$;

create or replace function public.monitor_auth_failures(p_hours int default 24)
returns jsonb language sql security definer set search_path = public, auth, pg_catalog as $$
  select coalesce(jsonb_agg(r), '[]') from (
    select ip_address, count(*) as attempts
    from auth.audit_log_entries
    where created_at > now() - make_interval(hours => p_hours)
      and payload->>'action' in ('login_failed', 'user_recovery_requested')
    group by ip_address order by attempts desc limit 10
  ) r;
$$;

revoke all on function public.monitor_security_audit(), public.monitor_recent_activity(int), public.monitor_auth_failures(int) from public, anon, authenticated;
grant execute on function public.monitor_security_audit(), public.monitor_recent_activity(int), public.monitor_auth_failures(int) to service_role;
