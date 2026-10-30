// RZGS Guardian — Telegram webhook agent (Supabase Edge Function, Deno).
// Read-only watchdog for the website, Supabase database and GitHub repo.
//
// Routes:
//   POST /          Telegram webhook (needs secret-token header + owner id)
//   POST /cron      Scheduled scan; messages the owner only when something is wrong
//
// Safety model: owner-only allowlist, constant-time secret checks, fixed
// read-only SQL (no user-supplied queries), no write actions of any kind.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;

const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const CRON_SECRET = env("CRON_SECRET");
const OWNERS = env("TELEGRAM_OWNER_IDS").split(",").map((s) => s.trim()).filter(Boolean);
const ALERT_CHAT_ID = env("ALERT_CHAT_ID"); // group/channel for scheduled alerts (defaults to owners)
const SITE_URL = env("SITE_URL", "https://rzgspro.com").replace(/\/$/, "");
const GH_REPO = env("GITHUB_REPO", "sarannmak/rzgs-pro-web");
const GH_TOKEN = env("GITHUB_TOKEN");
const SB_REF = env("SUPABASE_PROJECT_REF", "zaziizzsbytkdlatoutv");
const SB_MGMT_TOKEN = env("SUPABASE_ACCESS_TOKEN"); // personal access token, read-only use

const PAGES = ["/", "/login.html", "/signup.html", "/dashboard.html", "/app.html", "/bot.html", "/contact.html"];
const SENSITIVE_PATHS = ["/.git/config", "/.env", "/.git/HEAD", "/backup.zip", "/db.sql", "/.DS_Store"];

type Finding = { level: "ok" | "warn" | "crit"; text: string };
const ICON = { ok: "✅", warn: "⚠️", crit: "🚨" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function send(chatId: string | number, text: string) {
  // Telegram limit is 4096 chars.
  for (let i = 0; i < text.length; i += 3900) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: text.slice(i, i + 3900),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

const render = (title: string, f: Finding[]) =>
  `<b>${esc(title)}</b>\n` + (f.length ? f.map((x) => `${ICON[x.level]} ${x.text}`).join("\n") : "✅ Nothing to report");

const worst = (f: Finding[]) => f.some((x) => x.level === "crit") ? "crit" : f.some((x) => x.level === "warn") ? "warn" : "ok";

// ---------- checks ----------

async function checkSite(): Promise<Finding[]> {
  const out: Finding[] = [];
  const pages = await Promise.all(PAGES.map(async (p) => {
    const t = Date.now();
    try {
      const r = await fetch(SITE_URL + p, { redirect: "follow", signal: AbortSignal.timeout(10000) });
      return { p, status: r.status, ms: Date.now() - t };
    } catch (e) {
      return { p, status: 0, ms: Date.now() - t, err: String(e) };
    }
  }));
  for (const r of pages) {
    if (r.status === 0) out.push({ level: "crit", text: `${esc(r.p)} unreachable (${esc(r.err ?? "")})` });
    else if (r.status >= 500) out.push({ level: "crit", text: `${esc(r.p)} → HTTP ${r.status}` });
    else if (r.status >= 400) out.push({ level: "warn", text: `${esc(r.p)} → HTTP ${r.status}` });
    else if (r.ms > 3000) out.push({ level: "warn", text: `${esc(r.p)} slow: ${r.ms}ms` });
  }
  // Exposed secrets / VCS data must 404.
  const leaks = await Promise.all(SENSITIVE_PATHS.map(async (p) => {
    try {
      const r = await fetch(SITE_URL + p, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      return r.status === 200 ? p : null;
    } catch { return null; }
  }));
  for (const p of leaks) if (p) out.push({ level: "crit", text: `Sensitive path publicly readable: ${esc(p)}` });

  // Homepage tampering heuristics: unexpected external scripts.
  try {
    const html = await (await fetch(SITE_URL + "/", { signal: AbortSignal.timeout(10000) })).text();
    const allowed = [new URL(SITE_URL).hostname, "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com", "esm.sh"];
    const hosts = new Set([...html.matchAll(/<script[^>]+src=["'](https?:)?\/\/([^\/"']+)/gi)].map((m) => m[2].toLowerCase()));
    for (const h of hosts) if (!allowed.some((a) => h === a || h.endsWith("." + a))) out.push({ level: "warn", text: `Unknown external script host on homepage: ${esc(h)}` });
    if (/eval\(atob\(|document\.write\(unescape/i.test(html)) out.push({ level: "crit", text: "Homepage contains obfuscated-script pattern (possible defacement/injection)" });
  } catch { /* covered by reachability check */ }

  if (!out.length) out.push({ level: "ok", text: `${PAGES.length} pages up, no exposed sensitive paths` });
  return out;
}

async function gh(path: string) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "rzgs-guardian",
      ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  return { status: r.status, data: r.ok ? await r.json() : null };
}

async function checkIssues(): Promise<Finding[]> {
  const out: Finding[] = [];
  const [issues, prs] = await Promise.all([gh("/issues?state=open&per_page=30"), gh("/pulls?state=open&per_page=30")]);
  if (!issues.data) return [{ level: "warn", text: `GitHub API error ${issues.status}` }];
  const realIssues = (issues.data as any[]).filter((i) => !i.pull_request);
  out.push({ level: realIssues.length ? "warn" : "ok", text: `${realIssues.length} open issue(s)` });
  for (const i of realIssues.slice(0, 8)) out.push({ level: "warn", text: `<a href="${i.html_url}">#${i.number}</a> ${esc(i.title)}` });
  const p = (prs.data ?? []) as any[];
  out.push({ level: "ok", text: `${p.length} open PR(s)` });
  for (const x of p.slice(0, 5)) out.push({ level: "ok", text: `<a href="${x.html_url}">PR #${x.number}</a> ${esc(x.title)} (${esc(x.user.login)})` });
  return out;
}

async function checkRepoSecurity(): Promise<Finding[]> {
  const out: Finding[] = [];
  if (!GH_TOKEN) return [{ level: "warn", text: "GITHUB_TOKEN not set — repo security alerts skipped" }];
  for (const [name, path] of [["Dependabot", "/dependabot/alerts?state=open&per_page=30"], ["Secret scanning", "/secret-scanning/alerts?state=open&per_page=30"], ["Code scanning", "/code-scanning/alerts?state=open&per_page=30"]] as const) {
    const r = await gh(path);
    if (r.status === 404 || r.status === 403) { out.push({ level: "warn", text: `${name}: not enabled/accessible` }); continue; }
    const n = (r.data as any[] ?? []).length;
    out.push({ level: n ? (name === "Secret scanning" ? "crit" : "warn") : "ok", text: `${name}: ${n} open alert(s)` });
  }
  // Recent commits — surface anything not from the owner for review.
  const c = await gh("/commits?per_page=10");
  const since = Date.now() - 24 * 3600e3;
  for (const x of (c.data ?? []) as any[]) {
    if (new Date(x.commit.author.date).getTime() > since) {
      out.push({ level: "ok", text: `Commit ${x.sha.slice(0, 7)} by ${esc(x.commit.author.name)}: ${esc(x.commit.message.split("\n")[0].slice(0, 70))}` });
    }
  }
  return out;
}

async function sql<T = any>(query: string): Promise<T[] | null> {
  if (!SB_MGMT_TOKEN) return null;
  const r = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${SB_MGMT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
    signal: AbortSignal.timeout(15000),
  });
  return r.ok ? await r.json() : null;
}

async function checkDb(): Promise<Finding[]> {
  const out: Finding[] = [];
  if (!SB_MGMT_TOKEN) return [{ level: "warn", text: "SUPABASE_ACCESS_TOKEN not set — database checks skipped" }];
  // Health
  const h = await fetch(`https://${SB_REF}.supabase.co/auth/v1/health`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  out.push(h?.ok ? { level: "ok", text: "Auth service healthy" } : { level: "crit", text: "Auth service not responding" });

  // Tables in public without RLS = anyone with the publishable key can read/write them.
  const noRls = await sql<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and not rowsecurity");
  if (noRls === null) out.push({ level: "warn", text: "Could not query database (check token/permissions)" });
  else for (const t of noRls) out.push({ level: "crit", text: `Table <code>public.${esc(t.tablename)}</code> has RLS DISABLED` });

  // RLS enabled but zero policies (locked or misconfigured) and overly open policies.
  const open = await sql<{ tablename: string; policyname: string; cmd: string }>(
    "select tablename, policyname, cmd from pg_policies where schemaname='public' and 'anon' = any(roles::text[]) and (qual='true' or with_check='true') and cmd <> 'SELECT'");
  for (const p of open ?? []) out.push({ level: "crit", text: `Anonymous ${esc(p.cmd)} allowed unconditionally on <code>${esc(p.tablename)}</code> (${esc(p.policyname)})` });

  // Auth activity
  const act = await sql<{ day: number; week: number; total: number; unconfirmed: number }>(
    "select count(*) filter (where created_at > now()-interval '1 day')::int day, count(*) filter (where created_at > now()-interval '7 days')::int week, count(*)::int total, count(*) filter (where email_confirmed_at is null)::int unconfirmed from auth.users");
  if (act?.[0]) {
    const a = act[0];
    out.push({ level: a.day > 50 ? "warn" : "ok", text: `Users: ${a.total} total, +${a.day} today, +${a.week} this week, ${a.unconfirmed} unconfirmed${a.day > 50 ? " (signup spike — possible bot abuse)" : ""}` });
  }
  const fails = await sql<{ n: number }>(
    "select count(*)::int n from auth.audit_log_entries where created_at > now()-interval '1 hour' and payload->>'action' in ('login_failed','user_signedup_failed')");
  if (fails?.[0]) out.push({ level: fails[0].n > 30 ? "crit" : fails[0].n > 10 ? "warn" : "ok", text: `Failed auth events last hour: ${fails[0].n}${fails[0].n > 30 ? " (possible brute force)" : ""}` });

  // Supabase's own security advisor (best effort).
  const adv = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/advisors/security`, {
    headers: { authorization: `Bearer ${SB_MGMT_TOKEN}` }, signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (adv?.ok) {
    const lints = ((await adv.json()).lints ?? []) as any[];
    const bad = lints.filter((l) => l.level === "ERROR");
    out.push({ level: bad.length ? "crit" : lints.length ? "warn" : "ok", text: `Supabase advisor: ${bad.length} error(s), ${lints.length - bad.length} other` });
    for (const l of bad.slice(0, 5)) out.push({ level: "crit", text: esc(l.title ?? l.name) });
  }
  return out;
}

// ---------- commands ----------

const HELP = `<b>RZGS Guardian</b> (read-only)
/status – full scan (site + db + repo)
/site – website uptime, exposed files, tampering
/db – RLS, open policies, auth activity, advisors
/security – repo alerts and recent commits
/issues – open GitHub issues &amp; PRs
/whoami – your Telegram id`;

async function handle(chatId: number, text: string) {
  const cmd = text.trim().split(/[\s@]/)[0].toLowerCase();
  switch (cmd) {
    case "/start": case "/help": return send(chatId, HELP);
    case "/whoami": return send(chatId, `Your id: <code>${chatId}</code>`);
    case "/site": return send(chatId, render("🌐 Website", await checkSite()));
    case "/db": return send(chatId, render("🗄 Database", await checkDb()));
    case "/security": return send(chatId, render("🔐 Repo security", await checkRepoSecurity()));
    case "/issues": return send(chatId, render("📋 Issues & PRs", await checkIssues()));
    case "/status": {
      await send(chatId, "Scanning…");
      const [s, d, r] = await Promise.all([checkSite(), checkDb(), checkRepoSecurity()]);
      return send(chatId, [render("🌐 Website", s), render("🗄 Database", d), render("🔐 Repo security", r)].join("\n\n"));
    }
    default: return send(chatId, "Unknown command. /help");
  }
}

async function scheduledScan() {
  const [s, d, r] = await Promise.all([checkSite(), checkDb(), checkRepoSecurity()]);
  const problems = (t: string, f: Finding[]) => render(t, f.filter((x) => x.level !== "ok"));
  const all = [...s, ...d, ...r];
  if (worst(all) === "ok") return; // stay silent when healthy
  const msg = `${ICON[worst(all)]} <b>Guardian alert</b>\n\n` + [
    worst(s) !== "ok" ? problems("🌐 Website", s) : "",
    worst(d) !== "ok" ? problems("🗄 Database", d) : "",
    worst(r) !== "ok" ? problems("🔐 Repo", r) : "",
  ].filter(Boolean).join("\n\n");
  for (const o of ALERT_CHAT_ID ? [ALERT_CHAT_ID] : OWNERS) await send(o, msg);
}

// ---------- entry ----------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!BOT_TOKEN || !OWNERS.length) return new Response("not configured", { status: 500 });
  const path = new URL(req.url).pathname;

  if (path.endsWith("/cron")) {
    if (!safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return new Response("forbidden", { status: 403 });
    await scheduledScan();
    return new Response("done");
  }

  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  if (msg.chat?.type !== "private") return new Response("ok"); // group is alert-output only
  const from = String(msg.from?.id ?? "");
  if (msg.text.trim().toLowerCase().startsWith("/whoami") && msg.chat?.type === "private") {
    return send(msg.chat.id, `Your id: <code>${esc(from)}</code>`).then(() => new Response("ok")); // id only, no data
  }
  if (!OWNERS.includes(from) || msg.chat?.type !== "private") {
    // Never reveal anything to strangers; just tell the owner someone probed the bot.
    for (const o of OWNERS) await send(o, `🚨 Unauthorized bot access attempt from id <code>${esc(from)}</code> (@${esc(msg.from?.username ?? "?")})`);
    return new Response("ok");
  }
  try {
    await handle(msg.chat.id, msg.text);
  } catch (e) {
    await send(msg.chat.id, `Error: ${esc(String(e).slice(0, 300))}`);
  }
  return new Response("ok");
});
