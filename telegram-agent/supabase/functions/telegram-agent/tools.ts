// Read-only tools the guardian agent can call. Nothing here changes the site, the database or GitHub.
// Everything an attacker could influence (issue text, log lines, page content) is returned as data only.

const env = (k: string) => Deno.env.get(k) ?? "";
const SITE = env("SITE_URL") || "https://rzgspro.com";
const REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const PROJECT_REF = env("SUPABASE_PROJECT_REF") || "zaziizzsbytkdlatoutv";

const cap = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + "\n…[truncated]" : s);
const j = (v: unknown) => cap(JSON.stringify(v, null, 1));

async function gh(path: string) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!r.ok) return { error: `GitHub ${r.status}` };
  return await r.json();
}

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "content-type": "application/json" },
  });
  if (!r.ok) return { error: `Supabase ${r.status}` };
  return await r.json();
}

// Fixed, named, read-only SQL. The model picks a name; it never writes SQL.
const QUERIES: Record<string, string> = {
  tables_without_rls:
    "select schemaname, tablename from pg_tables where schemaname='public' and not rowsecurity",
  signups_last_24h: "select count(*) as n from auth.users where created_at > now() - interval '24 hours'",
  signups_last_7d_by_day:
    "select date_trunc('day', created_at)::date d, count(*) n from auth.users where created_at > now() - interval '7 days' group by 1 order by 1",
  unconfirmed_users: "select count(*) as n from auth.users where email_confirmed_at is null",
  failed_logins_1h:
    "select count(*) as n from auth.audit_log_entries where created_at > now() - interval '1 hour' and payload->>'action' in ('login_failed','user_signedup_failed')",
  db_size: "select pg_size_pretty(pg_database_size(current_database())) as size",
  active_connections: "select state, count(*) n from pg_stat_activity group by 1",
};

export const TOOLS = [
  {
    name: "check_site",
    description: "Fetch the public site and report status, latency, TLS/redirect and security headers.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Path, default /" } } },
  },
  {
    name: "github_issues",
    description: "List open issues and PRs on the website repo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_recent_commits",
    description: "Recent commits on the default branch (who changed what). Unexpected authors are suspicious.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_security_alerts",
    description: "Open Dependabot, code-scanning and secret-scanning alerts for the repo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "supabase_advisors",
    description: "Supabase security and performance advisor findings (missing RLS, exposed views, etc.).",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["security", "performance"] } }, required: ["type"] },
  },
  {
    name: "supabase_auth_logs",
    description: "Recent Supabase Auth log lines (failed logins, signup bursts) from the last hour.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "db_check",
    description: `Run a named read-only database check. Names: ${Object.keys(QUERIES).join(", ")}`,
    input_schema: { type: "object", properties: { name: { type: "string", enum: Object.keys(QUERIES) } }, required: ["name"] },
  },
];

const WANT_HEADERS = [
  "strict-transport-security", "content-security-policy", "x-content-type-options",
  "x-frame-options", "referrer-policy", "permissions-policy",
];

export async function runTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "check_site": {
        const path = typeof input?.path === "string" && input.path.startsWith("/") ? input.path : "/";
        const t = Date.now();
        const r = await fetch(SITE + path, { redirect: "manual" });
        const ms = Date.now() - t;
        const h: Record<string, string | null> = {};
        for (const k of WANT_HEADERS) h[k] = r.headers.get(k);
        return j({ url: SITE + path, status: r.status, ms, location: r.headers.get("location"), headers: h });
      }
      case "github_issues": {
        const r: any = await gh(`/repos/${REPO}/issues?state=open&per_page=20`);
        return Array.isArray(r)
          ? j(r.map((i: any) => ({ n: i.number, title: i.title, by: i.user?.login, pr: !!i.pull_request, at: i.created_at })))
          : j(r);
      }
      case "github_recent_commits": {
        const r: any = await gh(`/repos/${REPO}/commits?per_page=10`);
        return Array.isArray(r)
          ? j(r.map((c: any) => ({ sha: c.sha.slice(0, 7), by: c.commit.author?.name, login: c.author?.login, at: c.commit.author?.date, msg: c.commit.message.split("\n")[0] })))
          : j(r);
      }
      case "github_security_alerts": {
        const [dep, code, sec] = await Promise.all([
          gh(`/repos/${REPO}/dependabot/alerts?state=open&per_page=20`),
          gh(`/repos/${REPO}/code-scanning/alerts?state=open&per_page=20`),
          gh(`/repos/${REPO}/secret-scanning/alerts?state=open&per_page=20`),
        ]);
        const slim = (a: any, f: (x: any) => unknown) => (Array.isArray(a) ? a.map(f) : a);
        return j({
          dependabot: slim(dep, (x) => ({ pkg: x.dependency?.package?.name, sev: x.security_advisory?.severity })),
          code_scanning: slim(code, (x) => ({ rule: x.rule?.id, sev: x.rule?.security_severity_level })),
          secret_scanning: slim(sec, (x) => ({ type: x.secret_type_display_name })), // never the secret itself
        });
      }
      case "supabase_advisors": {
        const t = input?.type === "performance" ? "performance" : "security";
        return j(await sb(`/advisors/${t}`));
      }
      case "supabase_auth_logs": {
        const sql = "select timestamp, event_message from auth_logs where event_message like '%error%' or event_message like '%failed%' order by timestamp desc limit 30";
        const end = new Date(), start = new Date(end.getTime() - 3600_000);
        return j(await sb(`/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`));
      }
      case "db_check": {
        const q = QUERIES[input?.name];
        if (!q) return "unknown check";
        return j(await sb("/database/query", { method: "POST", body: JSON.stringify({ query: q, read_only: true }) }));
      }
      default:
        return "unknown tool";
    }
  } catch (e) {
    return `tool failed: ${(e as Error).message}`;
  }
}
