// Tools the guardian agent can call. Everything here is READ-ONLY on purpose:
// the agent can look, never change. Add write tools only behind a confirm button.

const env = (k: string) => Deno.env.get(k) ?? "";
const SITE_URL = env("SITE_URL") || "https://rzgspro.com";
const PROJECT_REF = env("SUPABASE_PROJECT_REF") || "zaziizzsbytkdlatoutv";
const REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";

const SB_API = "https://api.supabase.com/v1/projects/" + PROJECT_REF;
const sbHeaders = () => ({ Authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "Content-Type": "application/json" });
const ghHeaders = () => ({
  Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function getJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  if (!r.ok) return { error: `HTTP ${r.status}`, body: text.slice(0, 500) };
  try { return JSON.parse(text); } catch { return { text: text.slice(0, 2000) }; }
}

const SECURITY_HEADERS = [
  "strict-transport-security", "content-security-policy", "x-content-type-options",
  "x-frame-options", "referrer-policy", "permissions-policy",
];

// Only a single plain SELECT; nothing touching auth secrets, vault or system catalogs of other schemas.
function checkReadOnlySql(sql: string): string | null {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (s.includes(";")) return "Only one statement allowed.";
  if (!/^(select|with)\b/i.test(s)) return "Only SELECT queries are allowed.";
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|set|reset|vacuum|pg_sleep|pg_read|lo_|dblink)\b/i.test(s)) return "Statement contains a blocked keyword.";
  if (/\b(auth\.(users|identities|sessions|refresh_tokens|mfa_\w+)|vault\.|pg_authid|pg_shadow)\b/i.test(s)) return "Access to secrets/credentials tables is blocked.";
  return null;
}

export const toolDefs = [
  {
    name: "check_website",
    description: "Probe the public website: status, latency, redirects to HTTPS, security headers, and whether key pages respond. Use for uptime and hardening checks.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Path, default /" } } },
  },
  {
    name: "db_security_advisors",
    description: "Supabase security advisor findings for the database (missing RLS, exposed views, weak policies, etc.).",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["security", "performance"] } } },
  },
  {
    name: "db_query",
    description: "Run ONE read-only SELECT against the Supabase Postgres database (max 50 rows). Credential tables are blocked.",
    input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
  {
    name: "db_logs",
    description: "Query Supabase logs (auth, api, postgres, edge) for the last N hours to spot failed logins, 4xx/5xx spikes or odd IPs.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["auth_logs", "edge_logs", "postgres_logs", "function_edge_logs"] },
        hours: { type: "number", description: "Lookback hours, 1-24, default 1" },
        filter: { type: "string", description: "Optional text to match in event_message" },
      },
      required: ["source"],
    },
  },
  {
    name: "github_issues",
    description: "List open issues and pull requests on the website repo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_security",
    description: "GitHub security signals for the repo: Dependabot alerts, code-scanning alerts, secret-scanning alerts, and the most recent commits (to spot unexpected pushes).",
    input_schema: { type: "object", properties: {} },
  },
] as const;

type Input = Record<string, unknown>;

export async function runTool(name: string, input: Input): Promise<unknown> {
  try {
    switch (name) {
      case "check_website": {
        const url = SITE_URL.replace(/\/$/, "") + String(input.path ?? "/");
        const t0 = Date.now();
        const r = await fetch(url, { redirect: "manual" });
        const ms = Date.now() - t0;
        const headers: Record<string, string | null> = {};
        for (const h of SECURITY_HEADERS) headers[h] = r.headers.get(h);
        const http = await fetch(url.replace("https://", "http://"), { redirect: "manual" }).catch(() => null);
        return {
          url, status: r.status, latency_ms: ms,
          http_redirects_to_https: http ? (http.status >= 300 && http.status < 400 && (http.headers.get("location") ?? "").startsWith("https://")) : "unreachable",
          missing_security_headers: SECURITY_HEADERS.filter((h) => !headers[h]),
          server: r.headers.get("server"),
        };
      }
      case "db_security_advisors": {
        const type = input.type === "performance" ? "performance" : "security";
        return await getJson(`${SB_API}/advisors/${type}`, sbHeaders());
      }
      case "db_query": {
        const sql = String(input.sql ?? "");
        const bad = checkReadOnlySql(sql);
        if (bad) return { error: bad };
        const r = await fetch(`${SB_API}/database/query`, {
          method: "POST", headers: sbHeaders(),
          body: JSON.stringify({ query: `select * from (${sql.trim().replace(/;+\s*$/, "")}) q limit 50` }),
        });
        const text = await r.text();
        return r.ok ? JSON.parse(text) : { error: `HTTP ${r.status}`, body: text.slice(0, 500) };
      }
      case "db_logs": {
        const allowed = ["auth_logs", "edge_logs", "postgres_logs", "function_edge_logs"];
        const source = String(input.source);
        if (!allowed.includes(source)) return { error: "Unknown log source." };
        const hours = Math.min(24, Math.max(1, Number(input.hours ?? 1)));
        const filter = String(input.filter ?? "").replace(/[^\w .:@/-]/g, "");
        const end = new Date(), start = new Date(end.getTime() - hours * 3600_000);
        const where = filter ? `where event_message like '%${filter}%'` : "";
        const sql = `select timestamp, event_message from ${source} ${where} order by timestamp desc limit 40`;
        const qs = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
        return await getJson(`${SB_API}/analytics/endpoints/logs.all?${qs}`, sbHeaders());
      }
      case "github_issues": {
        const items = await getJson(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=20`, ghHeaders());
        return Array.isArray(items)
          ? items.map((i: any) => ({ number: i.number, title: i.title, pr: !!i.pull_request, by: i.user?.login, updated: i.updated_at }))
          : items;
      }
      case "github_security": {
        const base = `https://api.github.com/repos/${REPO}`;
        const [dependabot, code, secrets, commits] = await Promise.all([
          getJson(`${base}/dependabot/alerts?state=open&per_page=20`, ghHeaders()),
          getJson(`${base}/code-scanning/alerts?state=open&per_page=20`, ghHeaders()),
          getJson(`${base}/secret-scanning/alerts?state=open&per_page=20`, ghHeaders()),
          getJson(`${base}/commits?per_page=10`, ghHeaders()),
        ]);
        return {
          dependabot, code_scanning: code, secret_scanning: secrets,
          recent_commits: Array.isArray(commits)
            ? commits.map((c: any) => ({ sha: c.sha.slice(0, 7), by: c.commit.author?.name, date: c.commit.author?.date, msg: c.commit.message.split("\n")[0] }))
            : commits,
        };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: String(e) };
  }
}
