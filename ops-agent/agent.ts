// RZGS-PRO ops agent: a Telegram bot that watches the website, GitHub and Supabase for its owner.
// Web-standard APIs only, so the same file runs as a Supabase Edge Function (Deno), a Cloudflare Worker or on Bun.
//
// Safety rules, in order of importance:
//   1. Only OWNER_CHAT_IDS can talk to it; everyone else is ignored without an answer.
//   2. Telegram must present WEBHOOK_SECRET, and the cron endpoint must present CRON_SECRET.
//   3. Every action is read-only. It reports and recommends; it never changes the site, the database or GitHub.
//   4. Secrets come from environment variables only and are never printed in a reply.

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string; // same value as secret_token in Telegram setWebhook
  CRON_SECRET: string; // sent as "Authorization: Bearer ..." by the scheduler
  OWNER_CHAT_IDS: string; // comma-separated numeric Telegram ids
  SITE_URL?: string; // default https://rzgspro.com
  GITHUB_TOKEN?: string; // fine-grained, read-only: Issues, Contents, Metadata, Secret scanning, Dependabot alerts
  GITHUB_REPO?: string; // default sarannmak/rzgs-pro-web
  SUPABASE_ACCESS_TOKEN?: string; // personal access token (Management API), used read-only
  SUPABASE_PROJECT_REF?: string; // default zaziizzsbytkdlatoutv
}

type Level = "ok" | "warn" | "bad";
interface Finding { level: Level; text: string }

const ICON: Record<Level, string> = { ok: "🟢", warn: "🟡", bad: "🔴" };
const PAGES = ["/", "/login.html", "/signup.html", "/dashboard.html", "/contact.html", "/privacy.html"];
// Secret-shaped strings that must never be served to browsers. The sb_publishable_ key is meant to be public.
const LEAK_PATTERNS: [string, RegExp][] = [
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/],
  ["service_role JWT", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/],
  ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// ---------- helpers ----------

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ownerIds = (env: Env) => env.OWNER_CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean);
const render = (title: string, f: Finding[]) =>
  `<b>${esc(title)}</b>\n` + f.map((x) => `${ICON[x.level]} ${x.text}`).join("\n");

async function timed(url: string, init: RequestInit = {}, ms = 10000) {
  const t = Date.now();
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(ms) });
  return { res, ms: Date.now() - t };
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

// ---------- checks ----------

/** Is the site up, fast, on HTTPS, and free of leaked secrets? */
export async function checkSite(env: Env): Promise<Finding[]> {
  const base = (env.SITE_URL ?? "https://rzgspro.com").replace(/\/$/, "");
  const out: Finding[] = [];
  if (!base.startsWith("https://")) out.push({ level: "bad", text: `Site URL is not HTTPS: ${esc(base)}` });

  // Plain-HTTP must bounce to HTTPS.
  try {
    const { res } = await timed(base.replace("https://", "http://") + "/");
    const loc = res.headers.get("location") ?? "";
    out.push(res.status >= 300 && res.status < 400 && loc.startsWith("https://")
      ? { level: "ok", text: "HTTP redirects to HTTPS" }
      : { level: "bad", text: `HTTP does not redirect to HTTPS (status ${res.status})` });
  } catch { out.push({ level: "warn", text: "Could not test the HTTP→HTTPS redirect" }); }

  const scripts = new Set<string>();
  for (const p of PAGES) {
    try {
      const { res, ms } = await timed(base + p, { redirect: "follow" });
      if (!res.ok) { out.push({ level: "bad", text: `${p} answered ${res.status}` }); continue; }
      const html = await res.text();
      out.push({ level: ms > 3000 ? "warn" : "ok", text: `${p} ${res.status} in ${ms} ms (hash ${await sha256(html)})` });
      for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
        const src = new URL(m[1], base + p);
        if (src.origin === new URL(base).origin) scripts.add(src.href);
        else if (!/^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)$/.test(src.hostname) && !src.search.includes("integrity"))
          out.push({ level: "warn", text: `${p} loads a script from ${esc(src.hostname)}; confirm it is yours` });
      }
      for (const [name, re] of LEAK_PATTERNS) if (re.test(html)) out.push({ level: "bad", text: `${name} found in ${p}. Rotate it now.` });
    } catch { out.push({ level: "bad", text: `${p} unreachable` }); }
  }
  for (const href of scripts) {
    try {
      const { res } = await timed(href, { redirect: "follow" });
      const js = await res.text();
      for (const [name, re] of LEAK_PATTERNS) if (re.test(js)) out.push({ level: "bad", text: `${name} found in ${esc(new URL(href).pathname)}. Rotate it now.` });
    } catch { /* a missing script is reported by the page check above */ }
  }
  if (!out.some((f) => f.level === "bad" && f.text.includes("found in"))) out.push({ level: "ok", text: `No secrets in ${scripts.size} script files` });

  // GitHub Pages cannot set response headers, so a missing CSP is advice, not an alarm.
  try {
    const { res } = await timed(base + "/", { redirect: "follow" });
    const missing = ["content-security-policy", "x-content-type-options", "strict-transport-security"].filter((h) => !res.headers.has(h));
    if (missing.length) out.push({ level: "warn", text: `Missing headers: ${missing.join(", ")}. Put Cloudflare in front of the site to add them.` });
  } catch { /* already reported */ }
  return out;
}

async function gh(env: Env, path: string) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO ?? "sarannmak/rzgs-pro-web"}${path}`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "rzgs-ops-agent" },
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

/** Open issues, exposed secrets, vulnerable dependencies and pushes from unfamiliar authors. */
export async function checkGithub(env: Env): Promise<Finding[]> {
  if (!env.GITHUB_TOKEN) return [{ level: "warn", text: "GITHUB_TOKEN not set; GitHub checks skipped" }];
  const out: Finding[] = [];
  const issues = await gh(env, "/issues?state=open&per_page=10");
  if (issues.body) {
    const real = (issues.body as { number: number; title: string; pull_request?: unknown }[]).filter((i) => !i.pull_request);
    out.push(real.length ? { level: "warn", text: `${real.length} open issue(s): ` + real.slice(0, 5).map((i) => `#${i.number} ${esc(i.title)}`).join("; ") } : { level: "ok", text: "No open issues" });
  } else out.push({ level: "warn", text: `Issues unavailable (HTTP ${issues.status})` });

  const secrets = await gh(env, "/secret-scanning/alerts?state=open&per_page=1");
  if (secrets.body) out.push((secrets.body as unknown[]).length ? { level: "bad", text: "Open secret-scanning alert. A key was committed; rotate it." } : { level: "ok", text: "No exposed secrets" });
  const deps = await gh(env, "/dependabot/alerts?state=open&per_page=5");
  if (deps.body) out.push((deps.body as unknown[]).length ? { level: "warn", text: `${(deps.body as unknown[]).length}+ open dependency alert(s)` } : { level: "ok", text: "No vulnerable dependencies" });

  const commits = await gh(env, "/commits?per_page=5");
  if (commits.body) {
    const list = commits.body as { sha: string; commit: { message: string; author: { name: string; date: string } }; author?: { login: string } | null }[];
    const unsigned = list.filter((c) => !c.author).length;
    out.push({ level: unsigned ? "warn" : "ok", text: "Latest: " + list.slice(0, 3).map((c) => `${c.sha.slice(0, 7)} ${esc(c.commit.message.split("\n")[0].slice(0, 50))} (${esc(c.commit.author.name)})`).join("; ") + (unsigned ? ` · ${unsigned} commit(s) by an account GitHub cannot match` : "") });
  }
  return out;
}

async function supa(env: Env, path: string, init?: RequestInit) {
  const ref = env.SUPABASE_PROJECT_REF ?? "zaziizzsbytkdlatoutv";
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

/** Database security: RLS coverage, Supabase advisors and sign-in failures. All queries are SELECT-only. */
export async function checkDatabase(env: Env): Promise<Finding[]> {
  if (!env.SUPABASE_ACCESS_TOKEN) return [{ level: "warn", text: "SUPABASE_ACCESS_TOKEN not set; database checks skipped" }];
  const out: Finding[] = [];
  const q = (query: string) => supa(env, "/database/query", { method: "POST", body: JSON.stringify({ query, read_only: true }) });

  const rls = await q("select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  if (rls.body) {
    const rows = rls.body as { t: string }[];
    out.push(rows.length ? { level: "bad", text: `Tables without row-level security (anyone with the public key can read them): ${rows.map((r) => esc(r.t)).join(", ")}` } : { level: "ok", text: "Row-level security is on for every public table" });
  } else out.push({ level: "warn", text: `RLS check unavailable (HTTP ${rls.status})` });

  const adv = await supa(env, "/advisors/security");
  if (adv.body) {
    const lints = ((adv.body as { lints?: { level: string; title: string }[] }).lints ?? []).filter((l) => l.level === "ERROR" || l.level === "WARN");
    out.push(lints.length ? { level: lints.some((l) => l.level === "ERROR") ? "bad" : "warn", text: `Supabase advisor: ` + [...new Set(lints.map((l) => esc(l.title)))].slice(0, 5).join("; ") } : { level: "ok", text: "Supabase security advisor is clean" });
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const fails = await q(`select count(*)::int as n, count(distinct ip_address)::int as ips from auth.audit_log_entries where created_at > '${since}' and payload->>'action'='login_failed'`);
  if (fails.body) {
    const { n, ips } = (fails.body as { n: number; ips: number }[])[0] ?? { n: 0, ips: 0 };
    out.push({ level: n > 100 ? "bad" : n > 20 ? "warn" : "ok", text: `${n} failed sign-ins in 24 h from ${ips} address(es)${n > 20 ? ". Possible password guessing; consider CAPTCHA and tighter rate limits." : ""}` });
  }
  const signups = await q(`select count(*)::int as n from auth.users where created_at > '${since}'`);
  if (signups.body) {
    const n = (signups.body as { n: number }[])[0]?.n ?? 0;
    out.push({ level: n > 50 ? "warn" : "ok", text: `${n} new account(s) in 24 h${n > 50 ? ". Unusual spike; check for bot sign-ups." : ""}` });
  }
  return out;
}

async function fullReport(env: Env) {
  const [site, git, db] = await Promise.all([checkSite(env), checkGithub(env), checkDatabase(env)].map((p) => p.catch((e) => [{ level: "bad" as Level, text: `Check crashed: ${esc(String(e))}` }])));
  return { site, git, db, all: [...site, ...git, ...db] };
}

// ---------- Telegram ----------

async function send(env: Env, chatId: string | number, html: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

const HELP = `<b>RZGS-PRO ops agent</b>
/status – full health and security report
/site – website uptime, redirects, leaked secrets
/security – everything that is red or yellow
/issues – GitHub issues, secret alerts, dependencies
/activity – sign-ins, sign-ups, recent commits
/db – database and Supabase security
/help – this message

It only reads. It never changes your site, data or code.`;

async function command(env: Env, cmd: string): Promise<string> {
  switch (cmd) {
    case "/start": case "/help": return HELP;
    case "/site": return render("Website", await checkSite(env));
    case "/issues": return render("GitHub", await checkGithub(env));
    case "/db": return render("Database", await checkDatabase(env));
    case "/activity": {
      const db = (await checkDatabase(env)).filter((f) => /sign-in|account/.test(f.text));
      return render("Activity (24 h)", [...db, ...(await checkGithub(env)).filter((f) => f.text.startsWith("Latest"))]);
    }
    case "/security": {
      const r = await fullReport(env);
      const bad = r.all.filter((f) => f.level !== "ok");
      return render("Needs attention", bad.length ? bad : [{ level: "ok", text: "Nothing to fix right now" }]);
    }
    case "/status": {
      const r = await fullReport(env);
      const n = (l: Level) => r.all.filter((f) => f.level === l).length;
      return `${render("Website", r.site)}\n\n${render("GitHub", r.git)}\n\n${render("Database", r.db)}\n\n${ICON.bad} ${n("bad")}  ${ICON.warn} ${n("warn")}  ${ICON.ok} ${n("ok")}`;
    }
    default: return "Unknown command. Send /help.";
  }
}

// ---------- entry point ----------

const hits = new Map<string, number[]>();
function limited(id: string) { // 20 commands per minute per chat, per warm instance
  const now = Date.now(), list = (hits.get(id) ?? []).filter((t) => now - t < 60000);
  list.push(now); hits.set(id, list);
  return list.length > 20;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST") return new Response("ok");

  // Scheduler: pings the owner only when something is red, so quiet days stay quiet.
  if (url.pathname.endsWith("/cron")) {
    if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return new Response("forbidden", { status: 403 });
    const r = await fullReport(env);
    const bad = r.all.filter((f) => f.level === "bad");
    if (bad.length) for (const id of ownerIds(env)) await send(env, id, "🚨 " + render("Security alert", bad) + "\n\nSend /status for the full report.");
    return Response.json({ alerts: bad.length });
  }

  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env.WEBHOOK_SECRET)) return new Response("forbidden", { status: 403 });
  const update = await req.json().catch(() => null) as { message?: { chat: { id: number }; from?: { id: number }; text?: string } } | null;
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  // Strangers get no reply at all, so the bot looks dead to anyone probing it.
  if (!ownerIds(env).includes(String(msg.chat.id)) || !ownerIds(env).includes(String(msg.from?.id ?? ""))) return new Response("ok");
  if (limited(String(msg.chat.id))) return new Response("ok");

  const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
  try { await send(env, msg.chat.id, await command(env, cmd)); }
  catch (e) { await send(env, msg.chat.id, `Command failed: ${esc(String(e)).slice(0, 200)}`); }
  return new Response("ok");
}

// Supabase Edge Functions and Deno Deploy start here; Workers and Bun use the export below.
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve((req: Request) => handle(req, D.env.toObject() as unknown as Env));

export default { fetch: (req: Request, env: Env) => handle(req, env) };
