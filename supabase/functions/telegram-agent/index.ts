// RZGS PRO security & health agent — Telegram webhook on a Supabase Edge Function.
// Read-only by design: it observes and reports, it never changes data or config.
//
// Secrets (supabase secrets set ...):
//   TELEGRAM_BOT_TOKEN       from @BotFather
//   TELEGRAM_WEBHOOK_SECRET  random string; also passed to setWebhook as secret_token
//   TELEGRAM_ALLOWED_IDS     comma-separated numeric Telegram user IDs (owner only)
//   CRON_SECRET              random string; the scheduler sends it as x-cron-secret
//   SUPABASE_ACCESS_TOKEN    Management API token (advisors + logs, read only use)
//   SUPABASE_PROJECT_REF     zaziizzsbytkdlatoutv
//   GITHUB_TOKEN             fine-grained, read-only: Issues, Metadata, Dependabot/code scanning alerts
//   GITHUB_REPO              sarannmak/rzgs-pro-web
//   SITE_URL                 https://rzgspro.com

const env = (k: string) => Deno.env.get(k) ?? "";
const TOKEN = env("TELEGRAM_BOT_TOKEN");
const SITE = env("SITE_URL") || "https://rzgspro.com";
const REF = env("SUPABASE_PROJECT_REF");
const REPO = env("GITHUB_REPO");
const ALLOWED = new Set(env("TELEGRAM_ALLOWED_IDS").split(",").map((s) => s.trim()).filter(Boolean));

// Constant-time string compare so secrets can't be guessed byte by byte.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0 && x.length > 0;
}

async function send(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
}

const timed = (url: string, init: RequestInit = {}, ms = 8000) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

// ---- checks -----------------------------------------------------------------

async function checkSite(): Promise<{ ok: boolean; text: string }> {
  const lines: string[] = [];
  let ok = true;
  try {
    const t0 = Date.now();
    const r = await timed(SITE, { redirect: "follow" });
    const ms = Date.now() - t0;
    lines.push(`${r.ok ? "✅" : "🚨"} ${SITE} → ${r.status} in ${ms}ms`);
    if (!r.ok) ok = false;
    if (ms > 3000) { ok = false; lines.push("⚠️ slow response"); }
    // GitHub Pages can't set custom headers, so only report what's observable.
    const hsts = r.headers.get("strict-transport-security");
    lines.push(hsts ? "✅ HSTS present" : "ℹ️ no HSTS header (put the site behind Cloudflare to add security headers)");
  } catch (e) {
    ok = false;
    lines.push(`🚨 ${SITE} unreachable: ${(e as Error).message}`);
  }
  try {
    const r = await timed(`https://${REF}.supabase.co/auth/v1/health`);
    lines.push(`${r.ok ? "✅" : "🚨"} Supabase auth health → ${r.status}`);
    if (!r.ok) ok = false;
  } catch (e) {
    ok = false;
    lines.push(`🚨 Supabase auth unreachable: ${(e as Error).message}`);
  }
  return { ok, text: lines.join("\n") };
}

const mgmt = (path: string) =>
  timed(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    headers: { authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}` },
  }, 15000);

async function checkAdvisors(): Promise<{ ok: boolean; text: string }> {
  // Flags things like tables without RLS, exposed views, weak auth settings.
  const r = await mgmt("/advisors/security");
  if (!r.ok) return { ok: false, text: `🚨 advisors request failed (${r.status})` };
  const body = await r.json();
  const items: Array<{ level?: string; title?: string; name?: string; detail?: string }> =
    body.lints ?? body.result ?? body ?? [];
  const bad = items.filter((i) => ["ERROR", "WARN"].includes((i.level ?? "").toUpperCase()));
  if (!bad.length) return { ok: true, text: "✅ Supabase security advisors: no warnings" };
  const lines = bad.slice(0, 10).map((i) => `• [${i.level}] ${i.title ?? i.name}`);
  const hasError = bad.some((i) => (i.level ?? "").toUpperCase() === "ERROR");
  return { ok: !hasError, text: `${hasError ? "🚨" : "⚠️"} ${bad.length} advisor finding(s)\n${lines.join("\n")}` };
}

async function checkAuthLogs(): Promise<{ ok: boolean; text: string }> {
  // Failed-login burst = likely credential stuffing / brute force.
  const sql = `select count(*) as n from auth_logs
    cross join unnest(metadata) as m
    where event_message like '%invalid%' or event_message like '%failed%'`;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const r = await mgmt(`/analytics/endpoints/logs.all?iso_timestamp_start=${since}&sql=${encodeURIComponent(sql)}`);
  if (!r.ok) return { ok: false, text: `🚨 auth log query failed (${r.status})` };
  const n = Number((await r.json()).result?.[0]?.n ?? 0);
  const hot = n >= 50;
  return { ok: !hot, text: `${hot ? "🚨" : "✅"} failed auth events, last hour: ${n}${hot ? " (possible brute force)" : ""}` };
}

const gh = (path: string) =>
  timed(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "user-agent": "rzgs-agent",
    },
  });

async function checkGithub(): Promise<{ ok: boolean; text: string }> {
  const lines: string[] = [];
  let ok = true;
  const issues = await gh("/issues?state=open&per_page=5");
  if (issues.ok) {
    const list = (await issues.json()).filter((i: { pull_request?: unknown }) => !i.pull_request);
    lines.push(`📌 open issues: ${list.length ? "" : "none"}`);
    for (const i of list) lines.push(`• #${i.number} ${i.title}`);
  }
  const dep = await gh("/dependabot/alerts?state=open&per_page=5");
  if (dep.ok) {
    const n = (await dep.json()).length;
    if (n) ok = false;
    lines.push(`${n ? "🚨" : "✅"} Dependabot alerts: ${n}`);
  }
  const scan = await gh("/secret-scanning/alerts?state=open&per_page=5");
  if (scan.ok) {
    const n = (await scan.json()).length;
    if (n) ok = false;
    lines.push(`${n ? "🚨" : "✅"} leaked-secret alerts: ${n}`);
  }
  return { ok, text: lines.join("\n") || "GitHub: no data (check GITHUB_TOKEN scopes)" };
}

async function runAll() {
  const results = await Promise.allSettled([checkSite(), checkAdvisors(), checkAuthLogs(), checkGithub()]);
  const parts = results.map((r) => r.status === "fulfilled" ? r.value : { ok: false, text: `🚨 check crashed: ${r.reason}` });
  return { ok: parts.every((p) => p.ok), text: parts.map((p) => p.text).join("\n\n") };
}

// ---- entrypoint -------------------------------------------------------------

const HELP = `RZGS agent (read-only)
/status  site + Supabase uptime
/security  advisors, failed-login burst, leaked secrets
/issues  open GitHub issues + Dependabot
/report  everything above
/id  show your Telegram ID`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Scheduled run (pg_cron / external scheduler): alert only when something is wrong.
  if (req.headers.has("x-cron-secret")) {
    if (!safeEqual(req.headers.get("x-cron-secret")!, env("CRON_SECRET"))) return new Response("forbidden", { status: 403 });
    const { ok, text } = await runAll();
    if (!ok) for (const id of ALLOWED) await send(id, `🚨 RZGS alert\n\n${text}`);
    return new Response("done");
  }

  // Telegram webhook: reject anything without the secret Telegram was told to send.
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env("TELEGRAM_WEBHOOK_SECRET"))) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  const from = String(msg.from?.id ?? "");
  const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();

  if (cmd === "/id") { await send(msg.chat.id, `Your ID: ${from}`); return new Response("ok"); }
  // Strangers get no reply at all, so the bot's existence/behavior isn't exposed.
  if (!ALLOWED.has(from)) return new Response("ok");

  try {
    if (cmd === "/status") await send(msg.chat.id, (await checkSite()).text);
    else if (cmd === "/security") {
      const r = await Promise.all([checkAdvisors(), checkAuthLogs()]);
      await send(msg.chat.id, r.map((x) => x.text).join("\n\n"));
    } else if (cmd === "/issues") await send(msg.chat.id, (await checkGithub()).text);
    else if (cmd === "/report") await send(msg.chat.id, (await runAll()).text);
    else await send(msg.chat.id, HELP);
  } catch (e) {
    await send(msg.chat.id, `🚨 agent error: ${(e as Error).message}`);
  }
  return new Response("ok");
});
