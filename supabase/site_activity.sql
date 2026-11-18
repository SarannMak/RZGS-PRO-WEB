-- Website activity numbers for the morning report (edge function site-activity).
-- Windows in Phnom Penh time: day = yesterday (full day), week = last 7 full days, month = last 30 full days.
create or replace function public.rz_site_activity()
returns jsonb
language sql stable security definer
set search_path to ''
as $$
  with
  k as (select (now() at time zone 'Asia/Phnom_Penh')::date as today),
  w(name, t_from, t_to) as (
    select 'day',   (today - 1)::timestamp  at time zone 'Asia/Phnom_Penh', today::timestamp at time zone 'Asia/Phnom_Penh' from k
    union all select 'week',  (today - 7)::timestamp  at time zone 'Asia/Phnom_Penh', today::timestamp at time zone 'Asia/Phnom_Penh' from k
    union all select 'month', (today - 30)::timestamp at time zone 'Asia/Phnom_Penh', today::timestamp at time zone 'Asia/Phnom_Penh' from k
    union all select 'prev_day', (today - 2)::timestamp at time zone 'Asia/Phnom_Penh', (today - 1)::timestamp at time zone 'Asia/Phnom_Penh' from k
  ),
  logins as (
    select user_id, created_at as at from auth.sessions
    union select id, last_sign_in_at from auth.users where last_sign_in_at is not null
  ),
  m as (
    select w.name, jsonb_build_object(
      'visitors',   (select count(distinct visitor) from public.web_activity a where a.kind = 'visit' and a.t >= w.t_from and a.t < w.t_to),
      'views',      (select count(*) from public.web_activity a where a.kind = 'visit' and a.t >= w.t_from and a.t < w.t_to),
      'signup',     (select count(*) from auth.users u where u.created_at >= w.t_from and u.created_at < w.t_to),
      'login',      (select count(distinct user_id) from logins l where l.at >= w.t_from and l.at < w.t_to),
      'interested', (select count(*) from public.web_activity a where a.kind = 'interested' and a.t >= w.t_from and a.t < w.t_to),
      'referral',   (select count(*) from public.web_activity a where a.kind = 'referral' and a.t >= w.t_from and a.t < w.t_to),
      'ref_signup', (select count(*) from public.web_users u where u.referred_by is not null and u.created_at >= w.t_from and u.created_at < w.t_to),
      'other',      (select count(*) from public.web_activity a where a.kind not in ('visit', 'interested', 'referral') and a.t >= w.t_from and a.t < w.t_to)
    ) as v
    from w
  ),
  wk as (select t_from, t_to from w where name = 'week')
  select jsonb_object_agg(m.name, m.v)
    || jsonb_build_object(
      'date', (select today - 1 from k),
      'users_total', (select count(*) from auth.users),
      'top_pages', coalesce((select jsonb_agg(x) from (
          select a.page, count(*) n from public.web_activity a, wk
          where a.kind = 'visit' and a.t >= wk.t_from and a.t < wk.t_to group by a.page order by n desc limit 5) x), '[]'),
      'top_clicks', coalesce((select jsonb_agg(x) from (
          select a.kind, a.target, count(*) n from public.web_activity a, wk
          where a.kind <> 'visit' and a.t >= wk.t_from and a.t < wk.t_to group by a.kind, a.target order by n desc limit 5) x), '[]'))
  from m
$$;
revoke all on function public.rz_site_activity() from public, anon, authenticated;

-- Sender + schedule: 07:30 Phnom Penh time (00:30 UTC) every day.
create or replace function public.rz_post_site_activity()
returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'report_fn_key';
  return net.http_post(
    url := 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/site-activity',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-key', k),
    timeout_milliseconds := 60000);
end $$;
revoke all on function public.rz_post_site_activity() from public, anon, authenticated;
select cron.schedule('rz-site-activity', '30 0 * * *', 'select public.rz_post_site_activity()');
