// Read-only monitoring checks. Nothing here writes to the site, database or repo.

const SITE = Deno.env.get("SITE_URL") ?? "https://rzgspro.com";
const REPO = Deno.env.get("GITHUB_REPO") ?? "sarannmak/rzgs-pro-web";
const SB_REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? "";

const REQUIRED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
];

async function mgmt(path: string) {
  const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  if (!token || !SB_REF) throw new Error("SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set");
  const r = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Supabase API ${r.status}`);
  return r.json();
}

async function gh(path: string) {
  const token = Deno.env.get("GITHUB_TOKEN");
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}

export async function siteStatus(): Promise<string> {
  const pages = ["/", "/login.html", "/app.html", "/dashboard.html"];
  const lines: string[] = [];
  for (const p of pages) {
    const t = Date.now();
    try {
      const r = await fetch(SITE + p, { redirect: "manual" });
      lines.push(`${r.status < 400 ? "✅" : "❌"} ${p} — ${r.status} (${Date.now() - t}ms)`);
    } catch (e) {
      lines.push(`❌ ${p} — unreachable (${(e as Error).message})`);
    }
  }
  return `Site ${SITE}\n` + lines.join("\n");
}

export async function securityHeaders(): Promise<string> {
  const r = await fetch(SITE);
  const lines = REQUIRED_HEADERS.map((h) => `${r.headers.has(h) ? "✅" : "⚠️ missing"} ${h}`);
  const https = SITE.startsWith("https://") ? "✅ HTTPS" : "❌ not HTTPS";
  return `${https}\n` + lines.join("\n") +
    "\nNote: GitHub Pages cannot set custom headers; put Cloudflare in front to add them.";
}

export async function dbAdvisors(): Promise<string> {
  const out: string[] = [];
  for (const type of ["security", "performance"]) {
    try {
      const d = await mgmt(`/advisors/${type}`);
      const items = (d.lints ?? d) as Array<{ level: string; title: string; name: string }>;
      out.push(`${type}: ${items.length} finding(s)`);
      for (const i of items.slice(0, 8)) out.push(`  • [${i.level}] ${i.title ?? i.name}`);
    } catch (e) {
      out.push(`${type}: ${(e as Error).message}`);
    }
  }
  return out.join("\n");
}

export async function authActivity(): Promise<string> {
  // Fixed, read-only query. The bot never accepts SQL from chat.
  const sql = encodeURIComponent(
    "select count(*) filter (where msg ilike '%login%' and level='error') as failed_logins, " +
      "count(*) as total from auth_logs where timestamp > now() - interval '24 hours'",
  );
  try {
    const d = await mgmt(`/analytics/endpoints/logs.all?sql=${sql}`);
    return "Auth (24h): " + JSON.stringify(d.result ?? d).slice(0, 500);
  } catch (e) {
    return "Auth logs unavailable: " + (e as Error).message;
  }
}

export async function recentErrors(): Promise<string> {
  const sql = encodeURIComponent(
    "select timestamp, event_message from edge_logs where timestamp > now() - interval '1 hour' " +
      "order by timestamp desc limit 20",
  );
  try {
    const d = await mgmt(`/analytics/endpoints/logs.all?sql=${sql}`);
    const rows = (d.result ?? []) as Array<{ event_message: string }>;
    return rows.length ? rows.slice(0, 10).map((r) => "• " + r.event_message.slice(0, 160)).join("\n") : "No recent log rows.";
  } catch (e) {
    return "Logs unavailable: " + (e as Error).message;
  }
}

export async function openIssues(): Promise<string> {
  const d = await gh("/issues?state=open&per_page=10");
  if (!d.length) return "No open issues/PRs.";
  return d.map((i: { number: number; title: string }) => `#${i.number} ${i.title}`).join("\n");
}

export async function ciAndAlerts(): Promise<string> {
  const out: string[] = [];
  try {
    const runs = await gh("/actions/runs?per_page=5");
    for (const r of runs.workflow_runs ?? []) out.push(`${r.conclusion ?? r.status} — ${r.name}`);
  } catch (e) { out.push("CI: " + (e as Error).message); }
  try {
    const a = await gh("/dependabot/alerts?state=open&per_page=10");
    out.push(`Dependabot: ${a.length} open`);
  } catch { out.push("Dependabot: unavailable"); }
  try {
    const a = await gh("/secret-scanning/alerts?state=open&per_page=10");
    out.push(`Secret scanning: ${a.length} open`);
  } catch { out.push("Secret scanning: unavailable"); }
  return out.join("\n") || "Nothing to report.";
}

export const TOOLS: Record<string, { desc: string; run: () => Promise<string> }> = {
  site_status: { desc: "Uptime and latency of key site pages", run: siteStatus },
  security_headers: { desc: "HTTPS and security header check", run: securityHeaders },
  db_advisors: { desc: "Supabase security/performance advisor findings", run: dbAdvisors },
  auth_activity: { desc: "Failed logins / auth activity in last 24h", run: authActivity },
  recent_errors: { desc: "Recent edge/API log lines", run: recentErrors },
  open_issues: { desc: "Open GitHub issues and PRs", run: openIssues },
  ci_and_alerts: { desc: "Recent CI runs, Dependabot and secret-scanning alerts", run: ciAndAlerts },
};

/** Cheap pass used by the scheduled sweep: returns problem lines only. */
export async function sweep(): Promise<string[]> {
  const problems: string[] = [];
  const s = await siteStatus();
  if (s.includes("❌")) problems.push(s);
  const h = await securityHeaders().catch((e) => "headers check failed: " + e.message);
  if (h.includes("❌")) problems.push(h);
  const c = await ciAndAlerts().catch(() => "");
  if (/failure/.test(c) || /(Dependabot|Secret scanning): [1-9]/.test(c)) problems.push(c);
  return problems;
}
