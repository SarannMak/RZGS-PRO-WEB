// Telegram monitoring agent for rzgspro.com (Supabase Edge Function, Deno).
// Read-only by design: it reports, it never mutates data or settings.
//
// Hardening: webhook secret header (constant-time) + owner-ID allowlist +
// per-minute rate limit + audit log. Unknown senders get no reply at all.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";
const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const OWNER_IDS = env("TELEGRAM_OWNER_IDS").split(",").map((s) => s.trim()).filter(Boolean);
const CRON_SECRET = env("AGENT_CRON_SECRET");
const SITE_URL = env("SITE_URL") || "https://rzgspro.com";
const GH_REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const GH_TOKEN = env("GITHUB_TOKEN"); // fine-grained, read-only (Issues, Contents, Metadata)

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const eq = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

async function tg(chat: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

const esc = (s: unknown) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

async function gh(path: string) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}${path}`, {
    headers: { accept: "application/vnd.github+json", ...(GH_TOKEN && { authorization: `Bearer ${GH_TOKEN}` }) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

// ---- checks -------------------------------------------------------------

async function checkSite(): Promise<{ ok: boolean; text: string }> {
  const t = Date.now();
  try {
    const r = await fetch(SITE_URL, { redirect: "manual" });
    const ms = Date.now() - t;
    const ok = r.status === 200 && ms < 3000;
    return { ok, text: `${ok ? "✅" : "🔴"} Site ${r.status} in ${ms}ms` };
  } catch (e) {
    return { ok: false, text: `🔴 Site unreachable: ${esc((e as Error).message)}` };
  }
}

async function checkDb(): Promise<{ ok: boolean; text: string }> {
  const t = Date.now();
  const { error } = await db.rpc("agent_activity_report", { hours: 1 });
  const ms = Date.now() - t;
  return error
    ? { ok: false, text: `🔴 Database error: ${esc(error.message)}` }
    : { ok: ms < 2000, text: `${ms < 2000 ? "✅" : "🟠"} Database OK (${ms}ms)` };
}

const WANTED_HEADERS = ["strict-transport-security", "x-content-type-options", "content-security-policy", "referrer-policy"];

async function checkSecurity(): Promise<{ ok: boolean; text: string }> {
  const lines: string[] = [];
  let ok = true;

  const { data, error } = await db.rpc("agent_security_report");
  if (error) { ok = false; lines.push(`🔴 DB audit failed: ${esc(error.message)}`); }
  else {
    const r = data as Record<string, string[]>;
    if (r.tables_without_rls.length) { ok = false; lines.push(`🔴 RLS OFF: ${esc(r.tables_without_rls.join(", "))}`); }
    if (r.rls_tables_without_policies.length) lines.push(`🟠 RLS but no policy: ${esc(r.rls_tables_without_policies.join(", "))}`);
    if (r.security_definer_functions_exposed.length) lines.push(`🟠 anon can run SECURITY DEFINER fns: ${esc(r.security_definer_functions_exposed.join(", "))}`);
  }

  try {
    const res = await fetch(SITE_URL);
    if (!SITE_URL.startsWith("https://")) { ok = false; lines.push("🔴 SITE_URL is not HTTPS"); }
    const missing = WANTED_HEADERS.filter((h) => !res.headers.has(h));
    // GitHub Pages cannot set custom headers; report as info, not failure.
    if (missing.length) lines.push(`ℹ️ Missing headers: ${missing.join(", ")}`);
    for (const p of ["/.env", "/.git/config", "/supabase/.env"]) {
      const x = await fetch(SITE_URL + p, { redirect: "manual" });
      const body = x.status === 200 ? await x.text() : "";
      if (x.status === 200 && !/<html/i.test(body)) { ok = false; lines.push(`🔴 Exposed file: ${p}`); }
    }
  } catch (e) { ok = false; lines.push(`🔴 Site check failed: ${esc((e as Error).message)}`); }

  if (GH_TOKEN) {
    try {
      const alerts = await gh("/dependabot/alerts?state=open&per_page=1").catch(() => []);
      if (Array.isArray(alerts) && alerts.length) lines.push("🟠 Open Dependabot alerts");
    } catch { /* optional */ }
  }
  return { ok, text: (ok && !lines.length ? "✅ Security checks clean" : lines.join("\n")) };
}

async function issues() {
  const list = await gh("/issues?state=open&per_page=10");
  const items = (list as Array<{ number: number; title: string; pull_request?: unknown }>).filter((i) => !i.pull_request);
  return items.length ? items.map((i) => `#${i.number} ${esc(i.title)}`).join("\n") : "✅ No open issues";
}

async function activity() {
  const { data, error } = await db.rpc("agent_activity_report", { hours: 24 });
  if (error) return `🔴 ${esc(error.message)}`;
  const a = data as Record<string, number>;
  let commits = "";
  try {
    const c = await gh("/commits?per_page=3") as Array<{ commit: { message: string; author: { name: string } } }>;
    commits = "\n\n<b>Latest commits</b>\n" + c.map((x) => `• ${esc(x.commit.message.split("\n")[0])} — ${esc(x.commit.author.name)}`).join("\n");
  } catch { /* optional */ }
  return `<b>Last 24h</b>\nNew users: ${a.new_users}\nSign-ins: ${a.sign_ins}\nFailed logins: ${a.failed_logins}\nTotal users: ${a.total_users} (${a.unconfirmed_users} unconfirmed)${commits}`;
}

async function fullReport() {
  const [s, d, sec] = await Promise.all([checkSite(), checkDb(), checkSecurity()]);
  return { ok: s.ok && d.ok && sec.ok, text: [s.text, d.text, sec.text].join("\n") };
}

// ---- command router -----------------------------------------------------

const HELP = `<b>RZGS Pro agent</b> (read-only)
/status – site + database health
/security – RLS, exposed files, headers
/issues – open GitHub issues
/activity – users, logins, commits
/report – everything`;

async function handle(cmd: string): Promise<string> {
  switch (cmd) {
    case "/start": case "/help": return HELP;
    case "/status": { const [s, d] = await Promise.all([checkSite(), checkDb()]); return `${s.text}\n${d.text}`; }
    case "/security": return (await checkSecurity()).text;
    case "/issues": return await issues();
    case "/activity": return await activity();
    case "/report": return (await fullReport()).text;
    default: return "Unknown command. /help";
  }
}

const recent = new Map<string, number[]>();
const limited = (id: string) => {
  const now = Date.now();
  const hits = (recent.get(id) ?? []).filter((t) => now - t < 60_000);
  hits.push(now); recent.set(id, hits);
  return hits.length > 10;
};

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Scheduled watch: pings the owner ONLY when something is wrong.
  if (url.searchParams.get("cron") === "1") {
    if (!eq(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return new Response("forbidden", { status: 403 });
    const r = await fullReport();
    if (!r.ok) for (const id of OWNER_IDS) await tg(id, `🚨 <b>Alert</b>\n${r.text}`);
    return new Response("ok");
  }

  if (req.method !== "POST" || !eq(req.headers.get("x-telegram-bot-api-secret-token") ?? "", WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");

  const from = String(msg.from?.id ?? "");
  const cmd = String(msg.text).trim().split(/[\s@]/)[0].toLowerCase();
  const allowed = OWNER_IDS.includes(from) && msg.chat?.type === "private";
  await db.from("agent_audit").insert({ tg_user_id: Number(from) || null, command: cmd.slice(0, 64), allowed });
  if (!allowed) return new Response("ok"); // silent: don't reveal the bot to strangers

  if (limited(from)) { await tg(msg.chat.id, "Slow down."); return new Response("ok"); }
  try { await tg(msg.chat.id, await handle(cmd)); }
  catch (e) { await tg(msg.chat.id, `🔴 ${esc((e as Error).message)}`); }
  return new Response("ok");
});
