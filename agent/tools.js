// Read-only tools for the security agent. Nothing here changes the website,
// database or GitHub repo. Every tool returns a JSON-serialisable object.

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
];

async function timedFetch(url, init = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(10000) });
  return { res, ms: Date.now() - t0 };
}

async function checkSite(env, { paths } = {}) {
  const base = env.SITE_URL;
  const list = paths?.length ? paths : (env.SITE_PATHS || "/,/login.html,/signup.html,/dashboard.html").split(",");
  const out = [];
  for (const p of list) {
    try {
      const { res, ms } = await timedFetch(new URL(p.trim(), base).href);
      const headers = {};
      for (const h of SECURITY_HEADERS) headers[h] = res.headers.get(h) ? "present" : "missing";
      out.push({ path: p, status: res.status, ms, location: res.headers.get("location"), headers });
    } catch (e) {
      out.push({ path: p, error: String(e) });
    }
  }
  // Files that must never be publicly reachable.
  const exposed = [];
  for (const p of ["/.git/config", "/.env", "/agent/worker.js", "/package.json", "/backup.sql"]) {
    try {
      const { res } = await timedFetch(new URL(p, base).href);
      if (res.status === 200) exposed.push(p);
    } catch {}
  }
  return { base, pages: out, exposed_sensitive_paths: exposed };
}

async function supabaseSql(env, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}`, detail: text.slice(0, 500) };
  return JSON.parse(text);
}

// Strict allow-list: one SELECT/WITH statement, no comments, no write keywords.
function isSafeSelect(q) {
  const s = q.trim().replace(/;+\s*$/, "");
  if (s.includes(";") || s.includes("--") || s.includes("/*")) return false;
  if (!/^(select|with)\b/i.test(s)) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|vacuum|pg_read_file|pg_sleep|lo_import|dblink)\b/i.test(s);
}

async function dbQuery(env, { sql }) {
  if (!isSafeSelect(sql)) return { error: "Rejected: only a single read-only SELECT is allowed." };
  const rows = await supabaseSql(env, sql);
  return Array.isArray(rows) ? { rows: rows.slice(0, 100), truncated: rows.length > 100 } : rows;
}

async function dbSecurityAudit(env) {
  const rls = await supabaseSql(env, `
    select c.relname as table, c.relrowsecurity as rls_enabled,
      (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1`);
  const grants = await supabaseSql(env, `
    select table_name, grantee, string_agg(privilege_type, ',') as privileges
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')
    group by 1,2 order by 1,2`);
  const definers = await supabaseSql(env, `
    select p.proname as function, p.prosecdef as security_definer, p.proconfig as config,
      has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef order by 1`);
  return { rls, grants, security_definer_functions: definers };
}

async function dbLogs(env, { service = "postgres", minutes = 60 }) {
  const allowed = ["postgres", "auth", "api", "edge_function"];
  if (!allowed.includes(service)) return { error: `service must be one of ${allowed.join(", ")}` };
  const end = new Date();
  const start = new Date(end - Math.min(minutes, 1440) * 60000);
  const sql = `select timestamp, event_message from ${service}_logs order by timestamp desc limit 100`;
  const url = new URL(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/analytics/endpoints/logs.all`);
  url.search = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { error: `HTTP ${res.status}`, detail: (await res.text()).slice(0, 500) };
  return (await res.json()).result?.slice(0, 100) ?? [];
}

async function gh(env, path) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rzgs-security-agent",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { error: `HTTP ${res.status} (feature disabled or token lacks scope)` };
  return res.json();
}

async function githubStatus(env) {
  const [issues, dependabot, secrets, commits] = await Promise.all([
    gh(env, "/issues?state=open&per_page=20"),
    gh(env, "/dependabot/alerts?state=open&per_page=20"),
    gh(env, "/secret-scanning/alerts?state=open&per_page=20"),
    gh(env, "/commits?per_page=10"),
  ]);
  const slim = (a, f) => (Array.isArray(a) ? a.map(f) : a);
  return {
    open_issues: slim(issues, (i) => ({ n: i.number, title: i.title, pr: !!i.pull_request, by: i.user?.login })),
    dependabot_alerts: slim(dependabot, (a) => ({ pkg: a.dependency?.package?.name, severity: a.security_advisory?.severity })),
    secret_scanning_alerts: slim(secrets, (a) => ({ type: a.secret_type_display_name, created: a.created_at })),
    recent_commits: slim(commits, (c) => ({ sha: c.sha.slice(0, 7), by: c.commit.author?.name, msg: c.commit.message.split("\n")[0] })),
  };
}

export const TOOLS = [
  { name: "check_site", description: "Probe the live website: status, latency, security headers, and whether sensitive files (.git, .env, source) are publicly reachable.",
    input_schema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } } }, run: checkSite },
  { name: "db_security_audit", description: "Supabase audit: RLS status and policies per public table, anon/authenticated grants, SECURITY DEFINER functions callable by anon.",
    input_schema: { type: "object", properties: {} }, run: dbSecurityAudit },
  { name: "db_logs", description: "Recent Supabase logs (postgres, auth, api, edge_function) to spot failed logins, errors, or abuse.",
    input_schema: { type: "object", properties: { service: { type: "string" }, minutes: { type: "number" } } }, run: dbLogs },
  { name: "db_query", description: "Run ONE read-only SELECT against the database (max 100 rows). Never returns write access.",
    input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] }, run: dbQuery },
  { name: "github_status", description: "Open issues/PRs, Dependabot alerts, secret-scanning alerts and recent commits for the website repo.",
    input_schema: { type: "object", properties: {} }, run: githubStatus },
];
