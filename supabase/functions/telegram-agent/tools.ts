import { cfg } from './config.ts';
import { admin, mgmtSql } from './db.ts';

export type Finding = { id: string; severity: 'critical' | 'high' | 'medium' | 'info'; text: string };
export type Report = { title: string; lines: string[]; findings: Finding[] };

const maskEmail = (e?: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '?');
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// ---------- website ----------
export async function siteHealth(): Promise<Report> {
  const url = cfg.siteUrl();
  const findings: Finding[] = [];
  const lines: string[] = [];
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const ms = Date.now() - t0;
    lines.push(`${url} → HTTP ${res.status} in ${ms} ms`);
    if (res.status >= 500 || res.status === 404) findings.push({ id: 'site-down', severity: 'critical', text: `Website returned HTTP ${res.status}` });
    else if (ms > 4000) findings.push({ id: 'site-slow', severity: 'medium', text: `Website is slow (${ms} ms)` });
    const body = res.status === 200 ? await res.text() : '';
    // a defacement or injected script shows up as an unexpected external script host
    const hosts = new Set([...body.matchAll(/<script[^>]+src=["']https?:\/\/([^/"']+)/gi)].map((m) => m[1].toLowerCase()));
    const allowed = (Deno.env.get('ALLOWED_SCRIPT_HOSTS') ?? 'cdnjs.cloudflare.com,cdn.jsdelivr.net,unpkg.com,esm.sh').split(',');
    const unknown = [...hosts].filter((h) => !allowed.some((a) => h === a.trim() || h.endsWith('.' + a.trim())));
    lines.push(`External script hosts: ${hosts.size ? [...hosts].join(', ') : 'none'}`);
    if (unknown.length) findings.push({ id: 'site-script:' + unknown.sort().join(','), severity: 'high', text: `Unexpected external script host on homepage: ${unknown.join(', ')}` });
  } catch (e) {
    findings.push({ id: 'site-unreachable', severity: 'critical', text: `Website unreachable: ${(e as Error).message}` });
    lines.push('Website unreachable');
  }
  return { title: 'Website', lines, findings };
}

// ---------- database & users ----------
export async function dbOverview(): Promise<Report> {
  const db = admin();
  const lines: string[] = [];
  const findings: Finding[] = [];
  const { data: users, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const list = users.users;
  const last24 = list.filter((u) => u.created_at > ago(24));
  const lastHour = list.filter((u) => u.created_at > ago(1));
  const unconfirmed = list.filter((u) => !u.email_confirmed_at).length;
  const banned = list.filter((u) => (u as { banned_until?: string }).banned_until).length;
  lines.push(`Users: ${list.length} total, ${last24.length} new in 24h, ${lastHour.length} in last hour`);
  lines.push(`Unconfirmed emails: ${unconfirmed}, banned: ${banned}`);
  const recent = last24.slice(0, 8).map((u) => `${maskEmail(u.email)} (${u.id.slice(0, 8)})`);
  if (recent.length) lines.push('Recent signups: ' + recent.join(', '));
  if (lastHour.length >= 15) findings.push({ id: 'signup-spike', severity: 'high', text: `Signup spike: ${lastHour.length} accounts in the last hour (bot attack?)` });
  const { count } = await db.from('web_users').select('*', { count: 'exact', head: true });
  if (count !== null) lines.push(`web_users rows: ${count}`);
  return { title: 'Database & users', lines, findings };
}

// Fixed read-only audit queries (never built from chat input).
const AUDIT = {
  noRls: `select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
  openPolicies: `select tablename||'.'||policyname as p from pg_policies
          where schemaname='public' and roles && array['anon','public']::name[]
          and (qual='true' or with_check='true')`,
  publicBuckets: `select name from storage.buckets where public`,
  definerNoPath: `select p.proname as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.prosecdef and (p.proconfig is null or not exists
          (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
};

export async function securityAudit(): Promise<Report> {
  const findings: Finding[] = [];
  const lines: string[] = [];
  if (!cfg.mgmtToken()) return { title: 'Security audit', lines: ['SUPABASE_ACCESS_TOKEN not set, so the database audit is off.'], findings: [] };
  const [noRls, open, buckets, definer] = await Promise.all([
    mgmtSql<{ t: string }>(AUDIT.noRls),
    mgmtSql<{ p: string }>(AUDIT.openPolicies),
    mgmtSql<{ name: string }>(AUDIT.publicBuckets),
    mgmtSql<{ f: string }>(AUDIT.definerNoPath),
  ]);
  lines.push(`Tables without RLS: ${noRls.length ? noRls.map((r) => r.t).join(', ') : 'none'}`);
  lines.push(`Wide-open anon policies: ${open.length ? open.map((r) => r.p).join(', ') : 'none'}`);
  lines.push(`Public buckets: ${buckets.length ? buckets.map((r) => r.name).join(', ') : 'none'}`);
  lines.push(`SECURITY DEFINER without search_path: ${definer.length ? definer.map((r) => r.f).join(', ') : 'none'}`);
  for (const r of noRls) findings.push({ id: 'no-rls:' + r.t, severity: 'critical', text: `Table public.${r.t} has RLS disabled. Anyone with the publishable key can read it.` });
  for (const r of open) findings.push({ id: 'open-policy:' + r.p, severity: 'high', text: `Policy ${r.p} lets anonymous users through unconditionally` });
  for (const r of definer) findings.push({ id: 'definer:' + r.f, severity: 'medium', text: `Function ${r.f}() is SECURITY DEFINER without a fixed search_path` });
  // avatars bucket is public by design; anything else public is worth a look
  for (const r of buckets) if (!/avatar/i.test(r.name)) findings.push({ id: 'bucket:' + r.name, severity: 'medium', text: `Storage bucket "${r.name}" is public` });
  return { title: 'Security audit', lines, findings };
}

export async function authActivity(): Promise<Report> {
  const lines: string[] = [];
  const findings: Finding[] = [];
  if (!cfg.mgmtToken()) return { title: 'Auth activity', lines: ['SUPABASE_ACCESS_TOKEN not set, so auth logs are off.'], findings };
  const sql = encodeURIComponent('select event_message from auth_logs order by timestamp desc limit 500');
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${cfg.projectRef()}/analytics/endpoints/logs.all?sql=${sql}&iso_timestamp_start=${encodeURIComponent(ago(1))}`,
    { headers: { authorization: `Bearer ${cfg.mgmtToken()}` } },
  );
  if (!res.ok) throw new Error(`Logs API ${res.status}`);
  const rows: { event_message: string }[] = (await res.json()).result ?? [];
  const failed = rows.filter((r) => /invalid_credentials|Invalid login credentials/i.test(r.event_message));
  const byIp = new Map<string, number>();
  for (const r of failed) {
    const ip = r.event_message.match(/"remote_addr":"([^"]+)"/)?.[1] ?? 'unknown';
    byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
  }
  const top = [...byIp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push(`Auth events (last hour, max 500): ${rows.length}, failed logins: ${failed.length}`);
  if (top.length) lines.push('Top failing IPs: ' + top.map(([ip, n]) => `${ip} ×${n}`).join(', '));
  if (failed.length >= 30) findings.push({ id: 'login-flood', severity: 'high', text: `${failed.length} failed logins in the last hour` });
  for (const [ip, n] of top) if (n >= 10) findings.push({ id: 'brute-force:' + ip, severity: 'high', text: `Possible brute force: ${ip} failed ${n} logins in the last hour` });
  return { title: 'Auth activity', lines, findings };
}

// ---------- GitHub ----------
async function gh(path: string) {
  const token = cfg.githubToken();
  const res = await fetch(`https://api.github.com/repos/${cfg.githubRepo()}${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'rzgs-telegram-agent' },
  });
  if (res.status === 404 || res.status === 403) return null; // feature off or token lacks scope
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return await res.json();
}

export async function githubOverview(): Promise<Report> {
  const lines: string[] = [];
  const findings: Finding[] = [];
  const issues = ((await gh('/issues?state=open&per_page=30')) ?? []) as { number: number; title: string; pull_request?: unknown }[];
  const prs = issues.filter((i) => i.pull_request);
  const only = issues.filter((i) => !i.pull_request);
  lines.push(`Open issues: ${only.length}, open PRs: ${prs.length}`);
  for (const i of only.slice(0, 8)) lines.push(`#${i.number} ${i.title}`);
  const dep = (await gh('/dependabot/alerts?state=open&per_page=30')) as { number: number; security_advisory: { severity: string; summary: string } }[] | null;
  const sec = (await gh('/secret-scanning/alerts?state=open&per_page=30')) as { number: number; secret_type_display_name: string }[] | null;
  const code = (await gh('/code-scanning/alerts?state=open&per_page=30')) as { number: number; rule: { severity: string; description: string } }[] | null;
  lines.push(`Dependabot: ${dep ? dep.length : 'n/a'}, secret scanning: ${sec ? sec.length : 'n/a'}, code scanning: ${code ? code.length : 'n/a'}`);
  for (const a of dep ?? []) if (['critical', 'high'].includes(a.security_advisory.severity))
    findings.push({ id: 'dependabot:' + a.number, severity: a.security_advisory.severity as 'critical' | 'high', text: `Dependabot ${a.security_advisory.severity}: ${a.security_advisory.summary}` });
  for (const a of sec ?? []) findings.push({ id: 'secret:' + a.number, severity: 'critical', text: `Leaked secret in repo: ${a.secret_type_display_name}. Rotate it now.` });
  for (const a of code ?? []) if (['critical', 'high', 'error'].includes(a.rule.severity))
    findings.push({ id: 'code:' + a.number, severity: 'high', text: `Code scanning: ${a.rule.description}` });
  return { title: 'GitHub', lines, findings };
}

export const render = (r: Report) => `${r.title}\n${r.lines.map((l) => '• ' + l).join('\n')}`;

/** Run every check; one failing check never hides the others. */
export async function runAll(): Promise<Report[]> {
  const checks = [siteHealth, dbOverview, securityAudit, authActivity, githubOverview];
  return await Promise.all(checks.map(async (c) => {
    try { return await c(); }
    catch (e) { return { title: c.name, lines: [`check failed: ${(e as Error).message}`], findings: [{ id: 'check-failed:' + c.name, severity: 'medium', text: `Check "${c.name}" failed to run: ${(e as Error).message}` }] } as Report; }
  }));
}
