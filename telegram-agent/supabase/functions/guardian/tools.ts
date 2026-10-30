// Read-only tools for the guardian agent. Nothing here writes, deletes or changes anything.
// Anything returned from the outside world (issue text, page content) is attacker-controllable,
// so it is wrapped as data and the toolset has no write path a hostile text could abuse.

const SITE = Deno.env.get("SITE_URL") ?? "https://rzgspro.com";
const REPO = Deno.env.get("GITHUB_REPO") ?? "sarannmak/rzgs-pro-web";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? ""; // fine-grained, READ-ONLY
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAGES = ["/", "/login.html", "/signup.html", "/bot.html", "/app.html", "/dashboard.html", "/contact.html"];
const WANTED_HEADERS = ["strict-transport-security", "content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options"];

const clip = (s: string, n = 3000) => (s.length > n ? s.slice(0, n) + "\n…[truncated]" : s);
const wrap = (label: string, s: string) => `<untrusted_data source="${label}">\n${clip(s)}\n</untrusted_data>`;

async function timed(url: string) {
  const t = performance.now();
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return { url, status: r.status, ms: Math.round(performance.now() - t), headers: r.headers };
  } catch (e) {
    return { url, status: 0, ms: Math.round(performance.now() - t), error: String(e), headers: new Headers() };
  }
}

async function checkWebsite() {
  const res = await Promise.all(PAGES.map((p) => timed(SITE + p)));
  const missing = WANTED_HEADERS.filter((h) => !res[0].headers.has(h));
  const lines = res.map((r) => `${r.status || "DOWN"} ${r.ms}ms ${r.url}${r.error ? " " + r.error : ""}`);
  return `${lines.join("\n")}\nMissing security headers on /: ${missing.join(", ") || "none"}`;
}

async function checkSsl() {
  // Reachability over HTTPS is the check we can do from Deno; certificate expiry is reported by
  // the host as a fetch failure, and plain HTTP must redirect to HTTPS.
  const https = await timed(SITE);
  const http = await timed(SITE.replace("https://", "http://"));
  const loc = http.headers.get("location") ?? "";
  return `HTTPS: ${https.status || "FAILED " + https.error}\nHTTP->HTTPS redirect: ${http.status} ${loc.startsWith("https://") ? "ok" : "NOT redirecting to https"}`;
}

async function gh(path: string) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Accept: "application/vnd.github+json", ...(GH_TOKEN && { Authorization: `Bearer ${GH_TOKEN}` }) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { error: `GitHub ${r.status}` };
  return await r.json();
}

async function githubIssues() {
  const d = await gh("/issues?state=open&per_page=15");
  if (d.error) return d.error;
  return wrap("github-issues", d.map((i: any) => `#${i.number} ${i.title} (${i.user?.login})`).join("\n") || "no open issues");
}

async function githubActivity() {
  const d = await gh("/commits?per_page=10");
  if (d.error) return d.error;
  return wrap("github-commits", d.map((c: any) => `${c.sha.slice(0, 7)} ${c.commit.author?.name}: ${c.commit.message.split("\n")[0]}`).join("\n"));
}

async function githubSecurityAlerts() {
  const [dep, sec] = await Promise.all([gh("/dependabot/alerts?state=open&per_page=10"), gh("/secret-scanning/alerts?state=open&per_page=10")]);
  const f = (x: any, k: string) => (x.error ? `${k}: ${x.error}` : `${k}: ${x.length} open`);
  return `${f(dep, "Dependabot")}\n${f(sec, "Secret scanning")}`;
}

// Database access goes ONLY through fixed monitor_* functions (see sql/monitor.sql).
// No free-form SQL is ever executed on behalf of a chat message.
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? JSON.stringify(await r.json()) : `DB error ${r.status}`;
}

const hours = (i: any) => Math.min(Math.max(Number(i?.hours) || 24, 1), 168);

export const TOOLS = [
  { name: "check_website", description: "Status code and latency of the main site pages, plus missing security headers.", input_schema: { type: "object", properties: {} }, run: () => checkWebsite() },
  { name: "check_ssl", description: "HTTPS reachability and HTTP->HTTPS redirect.", input_schema: { type: "object", properties: {} }, run: () => checkSsl() },
  { name: "github_issues", description: "Open GitHub issues.", input_schema: { type: "object", properties: {} }, run: () => githubIssues() },
  { name: "github_activity", description: "Latest commits (unexpected pushes = possible compromise).", input_schema: { type: "object", properties: {} }, run: () => githubActivity() },
  { name: "github_security_alerts", description: "Open Dependabot and secret-scanning alerts.", input_schema: { type: "object", properties: {} }, run: () => githubSecurityAlerts() },
  { name: "db_security_audit", description: "Tables without row-level security, and anon-readable tables.", input_schema: { type: "object", properties: {} }, run: () => rpc("monitor_security_audit") },
  { name: "db_recent_signups", description: "Count of sign-ups and sign-ins per hour window (spot bot floods).", input_schema: { type: "object", properties: { hours: { type: "integer" } } }, run: (i: any) => rpc("monitor_recent_activity", { p_hours: hours(i) }) },
  { name: "db_auth_failures", description: "Failed login/recovery attempts grouped by IP (brute force detection).", input_schema: { type: "object", properties: { hours: { type: "integer" } } }, run: (i: any) => rpc("monitor_auth_failures", { p_hours: hours(i) }) },
];
