// Every tool here is READ-ONLY. The agent can look, never change. Results are untrusted data.

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'x-frame-options',
];

const clip = (v, n = 6000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
};

// Strip anything that looks like a credential before it can reach the model or the chat.
export function redact(text) {
  return text
    .replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[telegram-token]')
    .replace(/\b(sk-ant-|sb_secret_|ghp_|github_pat_|sbp_)[A-Za-z0-9_-]+/g, '[secret]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]');
}

// ---- Supabase (Management API, SELECT-only guard) ----------------------------------------
const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|vacuum|reindex|comment|lock|set|reset|listen|notify|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink)\b/i;

function assertReadOnlySql(sql) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (s.includes(';')) throw new Error('Only one statement allowed.');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Only SELECT queries are allowed.');
  if (FORBIDDEN_SQL.test(s.replace(/'[^']*'/g, "''"))) throw new Error('Query contains a forbidden keyword.');
  return s;
}

async function supabaseSql(env, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ---- GitHub ------------------------------------------------------------------------------
async function gh(env, path) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'rzgs-guardian-bot',
    },
  });
  if (res.status === 404 || res.status === 403) return { unavailable: `${res.status} (feature off or token lacks scope)` };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

// ---- Tool implementations ---------------------------------------------------------------
export const impl = {
  async check_website(env, { url } = {}) {
    const target = url || env.SITE_URL;
    if (new URL(target).hostname !== new URL(env.SITE_URL).hostname) throw new Error('Only the configured site may be checked.');
    const t0 = Date.now();
    const res = await fetch(target, { redirect: 'manual', headers: { 'user-agent': 'rzgs-guardian-bot' } });
    const ms = Date.now() - t0;
    const missing = SECURITY_HEADERS.filter((h) => !res.headers.has(h));
    const body = await res.text();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))))
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    // Scripts loaded from third-party hosts are the usual route for a defaced / skimmer-injected page.
    const hosts = [...new Set([...body.matchAll(/<script[^>]+src=["']https?:\/\/([^/"']+)/gi)].map((m) => m[1]))];
    return { url: target, status: res.status, latency_ms: ms, https: target.startsWith('https:'), missing_security_headers: missing, content_hash: hash, external_script_hosts: hosts };
  },

  async supabase_rls_audit(env) {
    const tables = await supabaseSql(env, `select c.relname as table, c.relrowsecurity as rls_enabled,
      (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    const permissive = await supabaseSql(env, `select tablename, policyname, cmd, roles, qual, with_check from pg_policies
      where schemaname = 'public' and (qual = 'true' or with_check = 'true') and 'anon' = any(roles::text[])`);
    return {
      tables_without_rls: tables.filter((t) => !t.rls_enabled).map((t) => t.table),
      tables_with_rls_but_no_policy: tables.filter((t) => t.rls_enabled && Number(t.policies) === 0).map((t) => t.table),
      anon_policies_allowing_everything: permissive,
      table_count: tables.length,
    };
  },

  async supabase_auth_activity(env, { hours = 24 } = {}) {
    const h = Math.min(Math.max(Number(hours) || 24, 1), 168);
    const [signups] = await supabaseSql(env, `select count(*) filter (where created_at > now() - interval '1 hour') as last_hour,
      count(*) filter (where created_at > now() - interval '${h} hours') as window, count(*) as total from auth.users`);
    const failed = await supabaseSql(env, `select ip_address, count(*) as hits from auth.audit_log_entries
      where created_at > now() - interval '${h} hours' and payload->>'action' in ('login_failed','user_recovery_requested','user_repeated_signup')
      group by 1 order by 2 desc limit 10`);
    return { signups, noisiest_ips_failed_or_repeated_auth: failed, window_hours: h };
  },

  async supabase_query(env, { sql }) {
    const safe = assertReadOnlySql(String(sql));
    return supabaseSql(env, `select * from (${safe}) q limit 100`);
  },

  async supabase_logs(env, { service = 'api', minutes = 60 } = {}) {
    const table = { api: 'edge_logs', auth: 'auth_logs', postgres: 'postgres_logs' }[service];
    if (!table) throw new Error('service must be api, auth or postgres');
    const end = new Date();
    const start = new Date(end - Math.min(Number(minutes) || 60, 1440) * 60000);
    const sql = `select timestamp, event_message from ${table} order by timestamp desc limit 50`;
    const qs = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
    const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/analytics/endpoints/logs.all?${qs}`, {
      headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Supabase logs ${res.status}`);
    return (await res.json()).result;
  },

  async github_issues(env, { state = 'open' } = {}) {
    const items = await gh(env, `/issues?state=${state === 'closed' ? 'closed' : 'open'}&per_page=20`);
    return Array.isArray(items) ? items.map((i) => ({ number: i.number, title: i.title, pr: !!i.pull_request, user: i.user?.login, created: i.created_at })) : items;
  },

  async github_security_alerts(env) {
    const [secrets, deps, code] = await Promise.all([
      gh(env, '/secret-scanning/alerts?state=open&per_page=20'),
      gh(env, '/dependabot/alerts?state=open&per_page=20'),
      gh(env, '/code-scanning/alerts?state=open&per_page=20'),
    ]);
    const slim = (a, f) => (Array.isArray(a) ? a.map(f) : a);
    return {
      secret_scanning: slim(secrets, (a) => ({ number: a.number, type: a.secret_type_display_name, created: a.created_at })),
      dependabot: slim(deps, (a) => ({ number: a.number, severity: a.security_advisory?.severity, package: a.dependency?.package?.name })),
      code_scanning: slim(code, (a) => ({ number: a.number, severity: a.rule?.security_severity_level, rule: a.rule?.id })),
    };
  },

  async github_recent_commits(env) {
    const c = await gh(env, '/commits?per_page=10');
    return Array.isArray(c) ? c.map((x) => ({ sha: x.sha.slice(0, 7), author: x.commit.author?.name, date: x.commit.author?.date, msg: x.commit.message.split('\n')[0] })) : c;
  },
};

export const definitions = [
  { name: 'check_website', description: 'Uptime, latency, TLS, missing security headers, content hash and third-party script hosts for the website.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Optional page on the configured site' } } } },
  { name: 'supabase_rls_audit', description: 'Find public tables with Row Level Security off, RLS with no policies, or anon policies that allow everything.', input_schema: { type: 'object', properties: {} } },
  { name: 'supabase_auth_activity', description: 'Signup counts and noisiest IPs for failed logins / repeated signups / recovery requests (brute-force and abuse detection).', input_schema: { type: 'object', properties: { hours: { type: 'number' } } } },
  { name: 'supabase_query', description: 'Run ONE read-only SELECT against the database (max 100 rows). Writes are rejected.', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
  { name: 'supabase_logs', description: 'Recent Supabase logs (api, auth or postgres).', input_schema: { type: 'object', properties: { service: { type: 'string', enum: ['api', 'auth', 'postgres'] }, minutes: { type: 'number' } } } },
  { name: 'github_issues', description: 'Open or closed issues and pull requests on the website repo.', input_schema: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'closed'] } } } },
  { name: 'github_security_alerts', description: 'Open secret-scanning, Dependabot and code-scanning alerts.', input_schema: { type: 'object', properties: {} } },
  { name: 'github_recent_commits', description: 'Last 10 commits (spot unexpected changes to the site).', input_schema: { type: 'object', properties: {} } },
];

export async function runTool(env, name, input) {
  const fn = impl[name];
  if (!fn) return `Unknown tool ${name}`;
  try {
    return redact(clip(await fn(env, input || {})));
  } catch (e) {
    return redact(`Tool error: ${e.message}`);
  }
}
