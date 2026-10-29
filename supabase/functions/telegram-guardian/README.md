# RZGS-PRO Guardian (Telegram bot agent)

Read-only Telegram bot that watches the website (rzgspro.com), the Supabase project and this GitHub repo.
It reports; it never changes anything. Runs as a Supabase Edge Function (Deno).

## Commands (owner only, private chat)
`/status` full scan · `/site` uptime/HTTPS/exposed files/headers · `/security` Supabase advisors + GitHub alerts ·
`/activity` signups/sign-ins 24h · `/issues` open issues, PRs, failed CI · `/ask <question>` plain-language (optional)

A scheduled scan (`POST /?job=scan`) messages you **only when something is wrong**.

## Safety design
- Webhook accepts only requests carrying `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET`.
- Scheduled job requires `X-Cron-Secret` = `CRON_SECRET`. Secrets compared in constant time.
- Only `OWNER_CHAT_ID` (private chat) is answered; other users trigger an alert to you (throttled 1/min).
- Owner rate limit: 20 commands/minute. No write tools; `/ask` tools are read-only and tool output is treated as data.

## Setup
1. Create the bot with @BotFather, get the token. Get your numeric chat id (e.g. via @userinfobot).
2. Set secrets (Supabase dashboard > Edge Functions > Secrets, or `supabase secrets set`):
   `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, `WEBHOOK_SECRET` (random 32+ chars), `CRON_SECRET` (random 32+ chars),
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional: `GITHUB_TOKEN` (read-only, security_events scope),
   `SUPABASE_ACCESS_TOKEN` (advisors), `ANTHROPIC_API_KEY` (/ask), `SITE_URL`, `GITHUB_REPO`.
   Never commit these values.
3. Deploy: `supabase functions deploy telegram-guardian --no-verify-jwt`
4. Register webhook:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian -d secret_token=<WEBHOOK_SECRET>`
5. Schedule scans (pg_cron + pg_net, or any cron): every 15 min `POST .../telegram-guardian?job=scan` with header `X-Cron-Secret`.

Note: the service-role key is powerful. Keep it only in Edge Function secrets, and keep this function read-only.
