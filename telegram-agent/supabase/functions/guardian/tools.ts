// Read-only tools the guardian agent can call. Nothing here writes to the site, the database or GitHub.
// Everything these tools return is untrusted data (issue text, commit messages, log lines can be written by attackers).

const env = (k: string) => Deno.env.get(k) ?? "";
const SITE_URL = env("SITE_URL") || "https://rzgspro.com";
const REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const PROJECT_REF = env("SUPABASE_PROJECT_REF") || "zaziizzsbytkdlatoutv";

const MAX_OUT = 6000;
const clip = (v: unknown) => {
  let s = typeof v === "string" ? v : JSON.stringify(v, null, 1);
  s = redact(s);
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n…[truncated]" : s;
};

// Never let a key or token reach Telegram or the model, even if a log line contains one.
export function redact(s: string): string {
  return s
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]")
    .replace(/(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\d{8,10}:[A-Za-z0-9_-]{30,}/g, "[redacted-telegram-token]");
}

async function gh(path: string) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "user-agent": "rzgs-guardian",
    },
  });
  if (!r.ok) return { error: `GitHub ${r.status}`, body: (await r.text()).slice(0, 300) };
  return await r.json();
}

async function mgmt(path: string, init?: RequestInit) {
  const r = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`,
      "content-type": "application/json",
    },
  });
  if (!r.ok) return { error: `Supabase ${r.status}`, body: (await r.text()).slice(0, 300) };
  return await r.json();
}

// Only a single plain SELECT/WITH statement is allowed. The read-only endpoint enforces this again server-side.
function assertReadOnlySql(sql: string) {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (s.includes(";")) throw new Error("one statement only");
  if (!/^(select|with)\b/i.test(s)) throw new Error("SELECT only");
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|vacuum|pg_read_file|pg_sleep|lo_import|dblink)\b/i.test(s)) {
    throw new Error("statement not allowed");
  }
  return s;
}

const SITE_PAGES = ["/", "/login.html", "/signup.html", "/dashboard.html", "/contact.html"];
const WANT_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
];

export const toolDefs = [
  {
    name: "check_site",
    description: "Check that the website and its key pages are up, how fast, and which security headers are present.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "github_issues",
    description: "List open issues and pull requests of the website repo.",
    input_schema: { type: "object", properties: { state: { type: "string", enum: ["open", "closed"] } } },
  },
  {
    name: "github_activity",
    description: "Recent commits, branches pushed and workflow runs on the website repo. Use to spot unexpected changes.",
    input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    name: "github_security",
    description: "Open Dependabot, code-scanning and secret-scanning alerts for the website repo.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "supabase_advisors",
    description: "Supabase security and performance advisors (missing RLS, exposed tables, weak settings).",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["security", "performance"] } }, required: ["type"] },
  },
  {
    name: "supabase_logs",
    description: "Recent Supabase logs. service: auth (logins, failures), api (requests, 4xx/5xx), postgres (db errors).",
    input_schema: {
      type: "object",
      properties: { service: { type: "string", enum: ["auth", "api", "postgres"] }, minutes: { type: "integer", minimum: 5, maximum: 1440 } },
      required: ["service"],
    },
  },
  {
    name: "db_query",
    description: "Run ONE read-only SELECT against the production database (max 50 rows returned). Use to check tables, row counts, recent signups.",
    input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
] as const;

export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "check_site": {
        const out = [];
        for (const p of SITE_PAGES) {
          const t = Date.now();
          try {
            const r = await fetch(SITE_URL + p, { redirect: "manual", signal: AbortSignal.timeout(10000) });
            await r.arrayBuffer();
            const missing = WANT_HEADERS.filter((h) => !r.headers.has(h));
            out.push({ page: p, status: r.status, ms: Date.now() - t, missingSecurityHeaders: missing });
          } catch (e) {
            out.push({ page: p, down: true, error: String(e) });
          }
        }
        return clip({
          pages: out,
          note: "GitHub Pages cannot set custom response headers; missing headers are expected unless a CDN such as Cloudflare sits in front.",
        });
      }
      case "github_issues": {
        const state = input.state === "closed" ? "closed" : "open";
        const items = await gh(`/repos/${REPO}/issues?state=${state}&per_page=20`);
        return clip(Array.isArray(items)
          ? items.map((i) => ({ n: i.number, title: i.title, by: i.user?.login, pr: !!i.pull_request, at: i.created_at }))
          : items);
      }
      case "github_activity": {
        const n = Math.min(Number(input.limit) || 10, 20);
        const [commits, runs] = await Promise.all([
          gh(`/repos/${REPO}/commits?per_page=${n}`),
          gh(`/repos/${REPO}/actions/runs?per_page=5`),
        ]);
        return clip({
          commits: Array.isArray(commits)
            ? commits.map((c) => ({ sha: c.sha.slice(0, 7), by: c.commit.author?.name, at: c.commit.author?.date, msg: c.commit.message.split("\n")[0] }))
            : commits,
          runs: runs?.workflow_runs?.map((r: any) => ({ name: r.name, status: r.status, conclusion: r.conclusion, at: r.created_at })) ?? runs,
        });
      }
      case "github_security": {
        const [dep, code, secret] = await Promise.all([
          gh(`/repos/${REPO}/dependabot/alerts?state=open&per_page=20`),
          gh(`/repos/${REPO}/code-scanning/alerts?state=open&per_page=20`),
          gh(`/repos/${REPO}/secret-scanning/alerts?state=open&per_page=20`),
        ]);
        return clip({ dependabot: dep, codeScanning: code, secretScanning: secret });
      }
      case "supabase_advisors":
        return clip(await mgmt(`/v1/projects/${PROJECT_REF}/advisors/${input.type === "performance" ? "performance" : "security"}`));
      case "supabase_logs": {
        const tables = { auth: "auth_logs", api: "edge_logs", postgres: "postgres_logs" } as const;
        const table = tables[input.service as keyof typeof tables];
        if (!table) return "unknown service";
        const mins = Math.min(Number(input.minutes) || 60, 1440);
        const end = new Date();
        const start = new Date(end.getTime() - mins * 60000);
        const sql = `select timestamp, event_message from ${table} order by timestamp desc limit 50`;
        const q = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
        return clip(await mgmt(`/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?${q}`));
      }
      case "db_query": {
        const sql = assertReadOnlySql(String(input.sql ?? ""));
        const res = await mgmt(`/v1/projects/${PROJECT_REF}/database/query/read-only`, {
          method: "POST",
          body: JSON.stringify({ query: sql }),
        });
        return clip(Array.isArray(res) ? res.slice(0, 50) : res);
      }
      default:
        return `unknown tool ${name}`;
    }
  } catch (e) {
    return `tool error: ${redact(String(e))}`;
  }
}
