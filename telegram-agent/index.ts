// RZGS-PRO guard agent: a Telegram bot that watches the website, the Supabase project and the GitHub repo.
// Runs as one Supabase Edge Function (Deno). READ-ONLY by design: it reports, it never changes anything.
//
// Secrets (supabase secrets set ...):
//   TELEGRAM_BOT_TOKEN       from @BotFather
//   TELEGRAM_WEBHOOK_SECRET  long random string, also given to setWebhook as secret_token
//   OWNER_TELEGRAM_IDS       comma separated numeric Telegram user ids allowed to talk to the bot
//   CRON_SECRET              long random string, sent by the scheduler in the x-cron-secret header
//   SUPABASE_ACCESS_TOKEN    personal access token (Management API), used for read-only queries and logs
//   GITHUB_TOKEN             fine-grained, read-only: Issues, Dependabot alerts, Code scanning, Secret scanning
// Optional: SITE_URL, SUPABASE_PROJECT_REF, GITHUB_REPO

const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const OWNERS = new Set((Deno.env.get("OWNER_TELEGRAM_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const SB_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://rzgspro.com";
const REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? "zaziizzsbytkdlatoutv";
const REPO = Deno.env.get("GITHUB_REPO") ?? "sarannmak/rzgs-pro-web";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const OK = "✅", WARN = "⚠️", BAD = "🚨";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function send(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

async function timed(url: string, init: RequestInit = {}) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10000) });
    return { r, ms: Math.round(performance.now() - t), err: "" };
  } catch (e) {
    return { r: null, ms: Math.round(performance.now() - t), err: String(e) };
  }
}

async function sbSql(query: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${SB_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Supabase API ${r.status}`);
  return await r.json();
}

async function gh(path: string) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "rzgs-guard" },
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

// ---- checks: each returns { lines, bad } so the cron can alert only on problems ----
type Res = { lines: string[]; bad: boolean };

async function checkSite(): Promise<Res> {
  const lines: string[] = [];
  let bad = false;
  const { r, ms, err } = await timed(SITE);
  if (!r) return { lines: [`${BAD} Site DOWN: ${esc(err)}`], bad: true };
  const up = r.status >= 200 && r.status < 400;
  if (!up) bad = true;
  lines.push(`${up ? OK : BAD} ${esc(SITE)} → ${r.status} in ${ms} ms`);
  // GitHub Pages sets few headers; we can only report, not fix. Missing ones are advice, not failure.
  const h = r.headers;
  const missing = ["strict-transport-security", "x-content-type-options", "content-security-policy"].filter((k) => !h.get(k));
  if (missing.length) lines.push(`${WARN} Missing headers: ${missing.join(", ")} (consider a Cloudflare proxy for these)`);
  const http = await timed(SITE.replace("https://", "http://"));
  const loc = http.r?.headers.get("location") ?? "";
  if (!loc.startsWith("https://")) { lines.push(`${WARN} http:// does not redirect to https`); }
  // Pages that must never be indexed or exposed.
  for (const p of ["/.git/config", "/.env"]) {
    const x = await timed(SITE + p);
    if (x.r && x.r.status === 200) { bad = true; lines.push(`${BAD} Exposed: ${esc(p)}`); }
  }
  return { lines, bad };
}

async function checkDb(): Promise<Res> {
  if (!SB_TOKEN) return { lines: [`${WARN} SUPABASE_ACCESS_TOKEN not set`], bad: false };
  const lines: string[] = [];
  let bad = false;
  try {
    const noRls = await sbSql(`select schemaname||'.'||tablename as t from pg_tables where schemaname='public' and not rowsecurity`);
    if (noRls.length) { bad = true; lines.push(`${BAD} Tables WITHOUT row-level security: ${noRls.map((x: any) => esc(x.t)).join(", ")}`); }
    else lines.push(`${OK} RLS enabled on every public table`);
    const open = await sbSql(`select tablename||'.'||policyname as p from pg_policies where schemaname='public' and 'anon' = any(roles::text[]) and (qual='true' or with_check='true')`);
    if (open.length) { bad = true; lines.push(`${BAD} Policies open to anonymous users: ${open.map((x: any) => esc(x.p)).join(", ")}`); }
    const defs = await sbSql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
    if (defs[0]?.n) { bad = true; lines.push(`${BAD} ${defs[0].n} SECURITY DEFINER function(s) callable by anon`); }
  } catch (e) { bad = true; lines.push(`${BAD} Database check failed: ${esc(e)}`); }
  return { lines, bad };
}

async function checkAuthLogs(): Promise<Res> {
  if (!SB_TOKEN) return { lines: [], bad: false };
  try {
    const sql = encodeURIComponent(`select count(*) as n from auth_logs where timestamp > timestamp_sub(current_timestamp(), interval 1 hour) and metadata[safe_offset(0)].level='error'`);
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${sql}`, { headers: { authorization: `Bearer ${SB_TOKEN}` } });
    if (!r.ok) return { lines: [`${WARN} Auth logs unavailable (${r.status})`], bad: false };
    const n = Number((await r.json()).result?.[0]?.n ?? 0);
    const bad = n >= 20; // a burst of failed sign-ins in an hour looks like credential stuffing
    return { lines: [`${bad ? BAD : OK} Auth errors in the last hour: ${n}`], bad };
  } catch (e) { return { lines: [`${WARN} Auth log check failed: ${esc(e)}`], bad: false }; }
}

async function checkRepo(): Promise<Res> {
  if (!GH_TOKEN) return { lines: [`${WARN} GITHUB_TOKEN not set`], bad: false };
  const lines: string[] = [];
  let bad = false;
  const secrets = await gh("/secret-scanning/alerts?state=open");
  if (secrets.body?.length) { bad = true; lines.push(`${BAD} ${secrets.body.length} open secret-scanning alert(s)`); }
  const dep = await gh("/dependabot/alerts?state=open");
  if (dep.body?.length) { bad = true; lines.push(`${BAD} ${dep.body.length} open Dependabot alert(s)`); }
  const code = await gh("/code-scanning/alerts?state=open");
  if (code.body?.length) { bad = true; lines.push(`${BAD} ${code.body.length} open code-scanning alert(s)`); }
  const iss = await gh("/issues?state=open&per_page=100");
  const n = (iss.body ?? []).filter((i: any) => !i.pull_request).length;
  lines.push(`${n ? WARN : OK} ${n} open issue(s)`);
  if (!lines.some((l) => l.includes("alert"))) lines.unshift(`${OK} No open security alerts (where enabled)`);
  return { lines, bad };
}

async function runAll(): Promise<Res> {
  const parts = await Promise.all([checkSite(), checkDb(), checkAuthLogs(), checkRepo()]);
  return { lines: parts.flatMap((p) => p.lines), bad: parts.some((p) => p.bad) };
}

const HELP = `<b>RZGS guard</b> (read-only)
/status – everything at once
/site – website up, headers, exposed files
/db – RLS and open policies
/auth – failed sign-in burst
/repo – GitHub alerts and issues
/id – your Telegram id`;

async function handle(chatId: number, userId: string, text: string) {
  if (!OWNERS.has(userId)) {
    // Say nothing useful to strangers. Log only.
    console.warn("blocked user", userId);
    return;
  }
  const cmd = text.trim().split(/[\s@]/)[0].toLowerCase();
  const out = async (p: Promise<Res>) => send(chatId, (await p).lines.join("\n") || "no data");
  switch (cmd) {
    case "/status": return out(runAll());
    case "/site": return out(checkSite());
    case "/db": return out(checkDb());
    case "/auth": return out(checkAuthLogs());
    case "/repo": return out(checkRepo());
    default: return send(chatId, HELP);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Scheduler path: check everything, message the owners only when something is wrong.
  if (req.headers.get("x-cron-secret")) {
    if (!safeEqual(req.headers.get("x-cron-secret")!, CRON_SECRET)) return new Response("forbidden", { status: 403 });
    const res = await runAll();
    if (res.bad) for (const id of OWNERS) await send(id, `${BAD} <b>RZGS alert</b>\n${res.lines.join("\n")}`);
    return new Response(res.bad ? "alert" : "ok");
  }

  // Telegram path: only requests carrying our secret token are real Telegram updates.
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const u = await req.json();
    const m = u.message;
    if (m?.text && m.from?.id) {
      if (m.text.startsWith("/id")) await send(m.chat.id, `Your id: <code>${esc(m.from.id)}</code>`);
      else await handle(m.chat.id, String(m.from.id), m.text);
    }
  } catch (e) { console.error(e); }
  return new Response("ok"); // always 200 so Telegram does not retry
});
