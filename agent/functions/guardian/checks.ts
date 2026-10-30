// Read-only health and security checks. Nothing here writes to the site, database or repo.

const env = (k: string) => Deno.env.get(k) ?? "";

export const SITE_URL = env("SITE_URL") || "https://rzgspro.com";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY"); // the publishable key already shipped in auth.js
const GH_REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const GH_TOKEN = env("GITHUB_TOKEN");

export type Finding = { level: "ok" | "warn" | "crit"; text: string };
const icon = { ok: "✅", warn: "⚠️", crit: "🚨" };
export const render = (title: string, f: Finding[]) =>
  `<b>${title}</b>\n` + f.map((x) => `${icon[x.level]} ${x.text}`).join("\n");

async function timed(url: string, init: RequestInit = {}) {
  const t = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "manual" });
  return { res, ms: Date.now() - t };
}

const PAGES = ["/", "/login.html", "/signup.html", "/app.html", "/dashboard.html"];
const WANTED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
];

export async function checkSite(): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const p of PAGES) {
    try {
      const { res, ms } = await timed(SITE_URL + p);
      const level = res.status >= 500 ? "crit" : res.status >= 400 || ms > 3000 ? "warn" : "ok";
      out.push({ level, text: `${p} → ${res.status} in ${ms}ms` });
    } catch (e) {
      out.push({ level: "crit", text: `${p} unreachable (${(e as Error).message})` });
    }
  }
  return out;
}

export async function checkSecurity(): Promise<Finding[]> {
  const out: Finding[] = [];
  // HTTPS enforced?
  try {
    const { res } = await timed(SITE_URL.replace("https://", "http://"));
    const loc = res.headers.get("location") ?? "";
    out.push(loc.startsWith("https://")
      ? { level: "ok", text: "HTTP redirects to HTTPS" }
      : { level: "crit", text: "HTTP does not redirect to HTTPS" });
  } catch { out.push({ level: "warn", text: "Could not test HTTP→HTTPS redirect" }); }

  // Security headers (GitHub Pages can't set these; a Cloudflare proxy can.)
  try {
    const { res } = await timed(SITE_URL + "/");
    const missing = WANTED_HEADERS.filter((h) => !res.headers.has(h));
    out.push(missing.length
      ? { level: "warn", text: `Missing headers: ${missing.join(", ")}` }
      : { level: "ok", text: "Security headers present" });
  } catch { /* reported by checkSite */ }

  // Files that must never be public.
  for (const p of ["/.env", "/.git/config", "/.git/HEAD", "/backup.zip", "/database.sql"]) {
    try {
      const { res } = await timed(SITE_URL + p);
      if (res.status === 200) out.push({ level: "crit", text: `Sensitive path exposed: ${p}` });
    } catch { /* unreachable = fine */ }
  }

  // Anonymous access probe: with only the public key, protected tables must return nothing.
  if (SUPABASE_URL && ANON_KEY) {
    for (const table of ["web_users"]) {
      try {
        const { res } = await timed(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        });
        const rows = res.ok ? await res.json() : [];
        out.push(Array.isArray(rows) && rows.length
          ? { level: "crit", text: `RLS leak: anonymous key can read "${table}"` }
          : { level: "ok", text: `"${table}" is not readable anonymously` });
      } catch { out.push({ level: "warn", text: `Could not probe "${table}"` }); }
    }
  }

  // Secrets committed to the repo.
  if (GH_TOKEN) {
    const alerts = await gh(`/repos/${GH_REPO}/secret-scanning/alerts?state=open`);
    if (Array.isArray(alerts)) {
      out.push(alerts.length
        ? { level: "crit", text: `${alerts.length} open secret-scanning alert(s)` }
        : { level: "ok", text: "No open secret-scanning alerts" });
    }
    const dep = await gh(`/repos/${GH_REPO}/dependabot/alerts?state=open`);
    if (Array.isArray(dep) && dep.length) out.push({ level: "warn", text: `${dep.length} open Dependabot alert(s)` });
  }
  return out;
}

export async function checkDatabase(): Promise<Finding[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [{ level: "warn", text: "Supabase not configured" }];
  const out: Finding[] = [];
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    const { res, ms } = await timed(`${SUPABASE_URL}/auth/v1/health`, { headers: h });
    out.push({ level: res.ok ? (ms > 2000 ? "warn" : "ok") : "crit", text: `Auth service ${res.status} in ${ms}ms` });
  } catch (e) { out.push({ level: "crit", text: `Auth unreachable (${(e as Error).message})` }); }
  try {
    const { res, ms } = await timed(`${SUPABASE_URL}/rest/v1/web_users?select=id&limit=1`, { headers: h });
    out.push({ level: res.ok ? (ms > 2000 ? "warn" : "ok") : "crit", text: `Database API ${res.status} in ${ms}ms` });
  } catch (e) { out.push({ level: "crit", text: `Database unreachable (${(e as Error).message})` }); }
  return out;
}

export async function checkActivity(): Promise<Finding[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [{ level: "warn", text: "Supabase not configured" }];
  const out: Finding[] = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    const { users = [] } = await res.json();
    const since = Date.now() - 24 * 3600_000;
    const signups = users.filter((u: any) => Date.parse(u.created_at) > since);
    const logins = users.filter((u: any) => u.last_sign_in_at && Date.parse(u.last_sign_in_at) > since);
    const unconfirmed = signups.filter((u: any) => !u.email_confirmed_at);
    out.push({ level: "ok", text: `${signups.length} signup(s), ${logins.length} login(s) in 24h (newest 200 users)` });
    // Mass signups of unconfirmed addresses = bot/spam wave.
    if (signups.length >= 20 && unconfirmed.length / signups.length > 0.8) {
      out.push({ level: "warn", text: `Possible signup spam: ${unconfirmed.length}/${signups.length} unconfirmed` });
    }
  } catch (e) { out.push({ level: "warn", text: `Activity check failed (${(e as Error).message})` }); }
  return out;
}

async function gh(path: string) {
  try {
    const res = await fetch("https://api.github.com" + path, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function checkIssues(): Promise<Finding[]> {
  if (!GH_TOKEN) return [{ level: "warn", text: "GITHUB_TOKEN not set" }];
  const issues = await gh(`/repos/${GH_REPO}/issues?state=open&per_page=10`);
  if (!Array.isArray(issues)) return [{ level: "warn", text: "Could not read GitHub issues" }];
  if (!issues.length) return [{ level: "ok", text: "No open issues" }];
  return issues.map((i: any) => ({ level: "warn" as const, text: `#${i.number} ${esc(i.title)}` }));
}

export async function checkCommits(): Promise<Finding[]> {
  if (!GH_TOKEN) return [{ level: "warn", text: "GITHUB_TOKEN not set" }];
  const cs = await gh(`/repos/${GH_REPO}/commits?per_page=5`);
  if (!Array.isArray(cs)) return [{ level: "warn", text: "Could not read commits" }];
  return cs.map((c: any) => ({
    level: "ok" as const,
    text: `${c.sha.slice(0, 7)} ${esc(c.commit.message.split("\n")[0])} — ${esc(c.commit.author?.name ?? "?")}`,
  }));
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Run everything; used by /status and the scheduled alert job. */
export async function fullReport() {
  const [site, sec, db, act] = await Promise.all([checkSite(), checkSecurity(), checkDatabase(), checkActivity()]);
  const all = [...site, ...sec, ...db, ...act];
  return {
    text: [render("🌐 Website", site), render("🔒 Security", sec), render("🗄 Database", db), render("📈 Activity", act)].join("\n\n"),
    worst: all.some((f) => f.level === "crit") ? "crit" : all.some((f) => f.level === "warn") ? "warn" : "ok",
    problems: all.filter((f) => f.level !== "ok"),
  };
}
