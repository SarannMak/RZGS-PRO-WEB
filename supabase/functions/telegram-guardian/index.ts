// Telegram webhook + scheduled scan for the RZGS-PRO guardian agent.
//   POST from Telegram  -> header x-telegram-bot-api-secret-token must match; chat id must be the owner's.
//   POST from scheduler -> header x-cron-secret must match; runs a scan and only messages on problems.
import { ask } from "./agent.ts";
import { safeEqual, sendMessage, sendTyping } from "./telegram.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const TOKEN = env("TELEGRAM_BOT_TOKEN");
const OWNER = env("TELEGRAM_OWNER_CHAT_ID");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const CRON_SECRET = env("CRON_SECRET");

const SCAN = "Run a full health and security scan now: check_site, github_activity, supabase_logs (auth_errors, api_5xx, postgres_errors) and supabase_security_advisors.";

const HELP = `Guardian commands
/scan - full security and health scan
/site - website status, TLS, headers
/repo - commits, issues, security alerts
/logs - Supabase auth/API/DB errors
/advisors - Supabase security advisors
Or just ask a question in plain text.`;

const SHORTCUTS: Record<string, string> = {
  "/scan": SCAN,
  "/site": "Check the website with check_site and report.",
  "/repo": "Use github_activity and report anything unusual or needing attention.",
  "/logs": "Check supabase_logs for auth_errors, api_5xx and postgres_errors and look for attack patterns.",
  "/advisors": "Run supabase_security_advisors and summarise by severity.",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Scheduled scan: stay silent unless something is wrong.
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null) {
    if (!CRON_SECRET || !safeEqual(cron, CRON_SECRET)) return new Response("forbidden", { status: 403 });
    const report = await ask(`${SCAN}\nThis is an unattended run. If everything is healthy reply with exactly: ALL_CLEAR. Otherwise reply with the report.`);
    if (report.trim() !== "ALL_CLEAR") await sendMessage(TOKEN, OWNER, `Scheduled scan\n\n${report}`);
    return new Response("done");
  }

  // Telegram webhook. Fail closed if anything is unconfigured.
  const hdr = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!TOKEN || !OWNER || !WEBHOOK_SECRET || !safeEqual(hdr, WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");

  // Everyone except the owner is ignored without a reply, so the bot reveals nothing.
  if (String(msg.chat?.id) !== OWNER || String(msg.from?.id) !== OWNER) return new Response("ok");

  const text: string = msg.text.trim().slice(0, 2000);
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === "/start" || cmd === "/help") {
    await sendMessage(TOKEN, OWNER, HELP);
    return new Response("ok");
  }

  await sendTyping(TOKEN, OWNER);
  // Respond to Telegram quickly; keep working in the background so it doesn't retry the update.
  const work = ask(SHORTCUTS[cmd] ?? text)
    .then((a) => sendMessage(TOKEN, OWNER, a))
    .catch((e) => sendMessage(TOKEN, OWNER, `Guardian error: ${String(e).slice(0, 200)}`));
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return new Response("ok");
});
