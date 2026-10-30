// Read-only monitoring tools. Nothing here can change the site, the database or the repo.
// Every tool returns short plain text and never throws.

const env = (k: string) => Deno.env.get(k) ?? "";
const SITE_URL = () => env("SITE_URL") || "https://rzgspro.com";
const REPO = () => env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const SB_REF = () => env("SUPABASE_PROJECT_REF") || "zaziizzsbytkdlatoutv";

async function get(url: string, headers: Record<string, string> = {}, ms = 10000) {
  const t0 = Date.now();
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms), redirect: "manual" });
  return { res, ms: Date.now() - t0 };
}

const safe = (name: string, fn: () => Promise<string>) => async () => {
  try { return await fn(); } catch (e) { return `${name}: error - ${(e as Error).message}`; }
};

const PAGES = ["/", "/login.html", "/bot.html", "/app.html"];
const WANT_HEADERS = ["strict-transport-security", "x-content-type-options", "content-security-policy", "x-frame-options", "referrer-policy"];

export const checkSite = safe("site", async () => {
  const out: string[] = [];
  for (const p of PAGES) {
    const { res, ms } = await get(SITE_URL() + p);
    const ok = res.status >= 200 && res.status < 400;
    out.push(`${ok ? "OK " : "BAD"} ${p} -> ${res.status} (${ms}ms)`);
    await res.body?.cancel();
  }
  return out.join("\n");
});

export const checkSecurityHeaders = safe("headers", async () => {
  const { res } = await get(SITE_URL() + "/");
  await res.body?.cancel();
  const missing = WANT_HEADERS.filter((h) => !res.headers.has(h));
  const notes = [`https: ${SITE_URL().startsWith("https://") ? "yes" : "NO"}`];
  notes.push(missing.length ? `missing headers: ${missing.join(", ")}` : "all key headers present");
  notes.push("note: GitHub Pages cannot set custom headers; put Cloudflare in front to add them.");
  return notes.join("\n");
});

export const checkSupabase = safe("supabase", async () => {
  const base = `https://${SB_REF()}.supabase.co`;
  const key = env("SUPABASE_ANON_KEY");
  const h = key ? { apikey: key } : {};
  const a = await get(`${base}/auth/v1/health`, h);
  await a.res.body?.cancel();
  const r = await get(`${base}/rest/v1/`, h);
  await r.res.body?.cancel();
  return `auth: ${a.res.status} (${a.ms}ms)\nrest: ${r.res.status} (${r.ms}ms)`;
});

async function mgmt(path: string) {
  const token = env("SUPABASE_ACCESS_TOKEN");
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN not set");
  const { res } = await get(`https://api.supabase.com/v1/projects/${SB_REF()}${path}`, { Authorization: `Bearer ${token}` }, 20000);
  if (!res.ok) throw new Error(`management API ${res.status}`);
  return res.json();
}

async function logQuery(sql: string) {
  const end = new Date(), start = new Date(end.getTime() - 24 * 3600e3);
  const q = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
  return (await mgmt(`/analytics/endpoints/logs.all?${q}`)).result ?? [];
}

export const authFailures = safe("auth", async () => {
  const rows = await logQuery(
    "select count(*) as n from auth_logs cross join unnest(metadata) as m where m.level = 'error' or m.status >= 400",
  );
  return `auth errors / failed logins, last 24h: ${rows[0]?.n ?? 0}`;
});

export const apiErrors = safe("api", async () => {
  const rows = await logQuery(
    "select count(*) as n from edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r where r.status_code >= 500",
  );
  return `API 5xx responses, last 24h: ${rows[0]?.n ?? 0}`;
});

export const dbAdvisors = safe("advisors", async () => {
  const j = await mgmt("/advisors/security");
  const items = (j.lints ?? j ?? []) as Array<{ name?: string; level?: string; title?: string }>;
  if (!Array.isArray(items) || !items.length) return "Supabase security advisor: no findings";
  return "Supabase security advisor:\n" + items.slice(0, 10).map((i) => `- [${i.level}] ${i.title ?? i.name}`).join("\n");
});

async function gh(path: string) {
  const token = env("GITHUB_TOKEN");
  const { res } = await get(`https://api.github.com/repos/${REPO()}${path}`, {
    Accept: "application/vnd.github+json",
    "User-Agent": "rzgs-guardian",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path.split("?")[0]}`);
  return res.json();
}

export const githubIssues = safe("issues", async () => {
  const issues = (await gh("/issues?state=open&per_page=10")) as Array<{ number: number; title: string; pull_request?: unknown }>;
  const lines = issues.map((i) => `#${i.number} ${i.pull_request ? "[PR] " : ""}${i.title}`);
  return lines.length ? "Open issues/PRs:\n" + lines.join("\n") : "No open issues or PRs";
});

export const githubSecurity = safe("gh-security", async () => {
  const parts: string[] = [];
  for (const [label, path] of [["dependabot", "/dependabot/alerts"], ["secret scanning", "/secret-scanning/alerts"], ["code scanning", "/code-scanning/alerts"]]) {
    try {
      const a = await gh(`${path}?state=open&per_page=30`);
      parts.push(`${label}: ${a.length} open`);
    } catch (e) { parts.push(`${label}: unavailable (${(e as Error).message})`); }
  }
  return parts.join("\n");
});

export const githubActivity = safe("activity", async () => {
  const c = (await gh("/commits?per_page=5")) as Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>;
  return "Recent commits:\n" + c.map((x) => `${x.sha.slice(0, 7)} ${x.commit.author.date.slice(0, 16)} ${x.commit.author.name}: ${x.commit.message.split("\n")[0]}`).join("\n");
});

export const TOOLS: Record<string, { desc: string; run: () => Promise<string> }> = {
  site_status: { desc: "HTTP status and latency of the main website pages", run: checkSite },
  security_headers: { desc: "HTTPS and browser security header check of the website", run: checkSecurityHeaders },
  supabase_health: { desc: "Supabase auth and REST API reachability", run: checkSupabase },
  auth_failures: { desc: "Count of failed login/auth errors in the last 24h", run: authFailures },
  api_errors: { desc: "Count of Supabase API 5xx errors in the last 24h", run: apiErrors },
  db_security_advisor: { desc: "Supabase security advisor findings (e.g. tables without RLS)", run: dbAdvisors },
  github_issues: { desc: "Open GitHub issues and pull requests", run: githubIssues },
  github_security_alerts: { desc: "Open Dependabot, secret-scanning and code-scanning alerts", run: githubSecurity },
  recent_activity: { desc: "Latest commits to the repository", run: githubActivity },
};

// Used by the scheduled watch job: returns only the problems, empty string if all is well.
export async function watch(): Promise<string> {
  const problems: string[] = [];
  const site = await checkSite();
  if (site.includes("BAD") || site.includes("error")) problems.push(site);
  const sb = await checkSupabase();
  if (/: (?!2)\d{3}/.test(sb) || sb.includes("error")) problems.push(sb);
  const sec = await githubSecurity();
  if (/(dependabot|secret scanning|code scanning): [1-9]/.test(sec)) problems.push(sec);
  const auth = await authFailures();
  const n = Number(auth.match(/: (\d+)$/)?.[1] ?? 0);
  if (n >= Number(env("AUTH_FAIL_THRESHOLD") || 50)) problems.push(auth + " (possible brute force)");
  return problems.join("\n\n");
}
