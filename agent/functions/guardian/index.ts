// RZGS-PRO Guardian: a Telegram bot that watches the website, database and repo.
// Deployed as a Supabase Edge Function. Read-only by design: it reports, it never changes anything.
//
//   POST /guardian        Telegram webhook (needs X-Telegram-Bot-Api-Secret-Token)
//   POST /guardian?cron=1 Scheduled alert check (needs X-Cron-Secret); messages you only on problems

import { checkActivity, checkCommits, checkDatabase, checkIssues, checkSecurity, checkSite, esc, fullReport, render } from "./checks.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const TOKEN = env("TELEGRAM_BOT_TOKEN");
const OWNER = Number(env("TELEGRAM_OWNER_ID")); // only this Telegram user may talk to the bot
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const CRON_SECRET = env("CRON_SECRET");
const ANTHROPIC_KEY = env("ANTHROPIC_API_KEY"); // optional: enables /ask

// Constant-time compare so secrets can't be guessed by timing.
function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function send(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

const HELP = `<b>RZGS-PRO Guardian</b>
/status – full report (site, security, database, activity)
/site – page availability and speed
/security – HTTPS, headers, exposed files, RLS probe, secret alerts
/db – Supabase health
/activity – signups and logins, last 24h
/issues – open GitHub issues
/commits – latest commits
/ask &lt;question&gt; – ask the AI about the latest report`;

async function handle(cmd: string, arg: string, chat: number) {
  switch (cmd) {
    case "/start": case "/help": return send(chat, HELP);
    case "/status": return send(chat, (await fullReport()).text);
    case "/site": return send(chat, render("🌐 Website", await checkSite()));
    case "/security": return send(chat, render("🔒 Security", await checkSecurity()));
    case "/db": return send(chat, render("🗄 Database", await checkDatabase()));
    case "/activity": return send(chat, render("📈 Activity", await checkActivity()));
    case "/issues": return send(chat, render("🐞 Issues", await checkIssues()));
    case "/commits": return send(chat, render("📝 Commits", await checkCommits()));
    case "/ask": return send(chat, await ask(arg));
    default: return send(chat, HELP);
  }
}

// The AI only ever sees the read-only report text. It has no tools and no credentials.
async function ask(question: string) {
  if (!ANTHROPIC_KEY) return "Set ANTHROPIC_API_KEY to enable /ask.";
  if (!question.trim()) return "Usage: /ask &lt;question&gt;";
  const report = (await fullReport()).text;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 700,
      system: "You are a security and operations assistant for the website rzgspro.com. Answer briefly and concretely from the report. Suggest fixes the owner can make; never claim you changed anything.",
      messages: [{ role: "user", content: `Report:\n${report}\n\nQuestion: ${question}` }],
    }),
  });
  if (!res.ok) return "AI request failed.";
  const j = await res.json();
  return esc(j.content?.[0]?.text ?? "No answer.");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const url = new URL(req.url);

  // Scheduled job: alert only when something is wrong.
  if (url.searchParams.has("cron")) {
    if (!same(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return new Response("forbidden", { status: 403 });
    const r = await fullReport();
    if (r.worst !== "ok") await send(OWNER, `🚨 <b>Guardian alert</b>\n${r.problems.map((p) => "• " + p.text).join("\n")}`);
    return new Response("done");
  }

  // Telegram webhook: reject anything that isn't Telegram, then anyone who isn't the owner.
  if (!same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const msg = (await req.json().catch(() => ({}))).message;
  if (!msg?.text) return new Response("ok");
  if (msg.from?.id !== OWNER || msg.chat?.id !== OWNER) return new Response("ok"); // silent to strangers

  const [first, ...rest] = msg.text.trim().split(/\s+/);
  const cmd = first.split("@")[0].toLowerCase();
  try { await handle(cmd, rest.join(" "), msg.chat.id); }
  catch (e) { await send(msg.chat.id, `Check failed: ${esc((e as Error).message)}`); }
  return new Response("ok");
});
