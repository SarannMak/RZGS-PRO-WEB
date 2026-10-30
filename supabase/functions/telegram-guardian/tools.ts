// Read-only tools the agent can call. Nothing here can change the site, database or repo.
// Every result is untrusted data (page content, issue text, log lines) and is labelled that way for the model.

const SITE = Deno.env.get("SITE_URL") ?? "https://rzgspro.com";
const REPO = Deno.env.get("GITHUB_REPO") ?? "sarannmak/rzgs-pro-web";
const PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? "zaziizzsbytkdlatoutv";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN");
const SB_MGMT_TOKEN = Deno.env.get("SUPABASE_MGMT_TOKEN");

const EXPECTED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

async function gh(path: string) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "rzgs-guardian",
      ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
  });
  if (!r.ok) return { error: `GitHub ${r.status} on ${path}` };
  return await r.json();
}

// Named, fixed queries only: the model never writes SQL.
const LOG_QUERIES: Record<string, string> = {
  auth_errors:
    "select timestamp, event_message from auth_logs where metadata[0].level in ('error','warning') order by timestamp desc limit 30",
  api_5xx:
    "select timestamp, event_message from edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r where r.status_code >= 500 order by timestamp desc limit 30",
  postgres_errors:
    "select timestamp, event_message from postgres_logs where parsed.error_severity in ('ERROR','FATAL','PANIC') order by timestamp desc limit 30",
};

async function mgmt(path: string, init?: RequestInit) {
  if (!SB_MGMT_TOKEN) return { error: "SUPABASE_MGMT_TOKEN not configured" };
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${SB_MGMT_TOKEN}`, "content-type": "application/json" },
  });
  if (!r.ok) return { error: `Supabase ${r.status} on ${path}` };
  return await r.json();
}

export const toolDefs = [
  {
    name: "check_site",
    description: "Fetch the production site: status, latency, redirect to HTTPS, TLS validity and presence of security headers.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "github_activity",
    description: "Recent commits, open issues, open PRs and security alerts (Dependabot, code scanning, secret scanning) on the website repo.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "supabase_logs",
    description: "Recent Supabase log lines for one fixed category (last 24h).",
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: Object.keys(LOG_QUERIES) } },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "supabase_security_advisors",
    description: "Supabase security advisor findings (e.g. tables without RLS, exposed views, weak auth settings).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "check_site": {
      const out: Record<string, unknown> = { url: SITE };
      try {
        const t0 = Date.now();
        const r = await fetch(SITE, { redirect: "manual" });
        out.status = r.status;
        out.latency_ms = Date.now() - t0;
        out.missing_security_headers = EXPECTED_HEADERS.filter((h) => !r.headers.has(h));
        out.server = r.headers.get("server");
        const http = await fetch(SITE.replace("https://", "http://"), { redirect: "manual" }).catch(() => null);
        out.http_redirects_to_https = !!http && [301, 302, 307, 308].includes(http.status) &&
          (http.headers.get("location") ?? "").startsWith("https://");
        out.tls_ok = true; // fetch() to https:// throws on an invalid/expired certificate
      } catch (e) {
        out.tls_ok_or_reachable = false;
        out.error = String(e);
      }
      return out;
    }
    case "github_activity": {
      const [commits, issues, pulls, dependabot, codeql, secrets] = await Promise.all([
        gh("/commits?per_page=8"),
        gh("/issues?state=open&per_page=10"),
        gh("/pulls?state=open&per_page=10"),
        gh("/dependabot/alerts?state=open&per_page=10"),
        gh("/code-scanning/alerts?state=open&per_page=10"),
        gh("/secret-scanning/alerts?state=open&per_page=10"),
      ]);
      const slim = (xs: unknown, f: (x: any) => unknown) => Array.isArray(xs) ? xs.map(f) : xs;
      return {
        commits: slim(commits, (c) => ({ sha: c.sha.slice(0, 7), by: c.commit.author.name, at: c.commit.author.date, msg: c.commit.message.split("\n")[0] })),
        open_issues: slim(issues, (i) => ({ n: i.number, title: i.title, pr: !!i.pull_request })),
        open_prs: slim(pulls, (p) => ({ n: p.number, title: p.title, by: p.user.login })),
        dependabot: slim(dependabot, (a) => ({ pkg: a.dependency?.package?.name, severity: a.security_advisory?.severity })),
        code_scanning: slim(codeql, (a) => ({ rule: a.rule?.id, severity: a.rule?.security_severity_level })),
        secret_scanning: slim(secrets, (a) => ({ type: a.secret_type_display_name })),
      };
    }
    case "supabase_logs": {
      const sql = LOG_QUERIES[String(input.kind)];
      if (!sql) return { error: "unknown log kind" };
      const now = new Date();
      const q = new URLSearchParams({
        sql,
        iso_timestamp_start: new Date(now.getTime() - 24 * 3600e3).toISOString(),
        iso_timestamp_end: now.toISOString(),
      });
      return await mgmt(`/analytics/endpoints/logs.all?${q}`);
    }
    case "supabase_security_advisors":
      return await mgmt("/advisors/security");
    default:
      return { error: `unknown tool ${name}` };
  }
}
