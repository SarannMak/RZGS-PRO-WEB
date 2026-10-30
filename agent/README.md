# RZGS-PRO Guardian (Telegram agent)

A serverless Telegram bot that watches rzgspro.com, the Supabase backend and the GitHub repo.
It is **read-only**: it reports and alerts, it cannot change the site, data or code.

## What it checks
- **Website** – key pages up, status codes, response time
- **Security** – HTTP→HTTPS redirect, security headers, exposed `/.env` `/.git` etc., anonymous-key RLS probe on `web_users`, GitHub secret-scanning and Dependabot alerts
- **Database** – Supabase Auth and REST health and latency
- **Activity** – signups/logins in 24h, signup-spam pattern
- **Repo** – open issues, latest commits
- `/ask` – optional AI answers from the live report (the AI gets report text only, no tools or keys)

## Safety model
- Webhook requires Telegram's secret header; every message must come from `TELEGRAM_OWNER_ID`, strangers get no reply.
- Secrets compared in constant time; cron endpoint has its own secret.
- Use a **read-only** fine-grained GitHub token. The service-role key stays in Supabase secrets only.
- No command runs SQL or shell input.

## Setup (once the bot exists)
1. Create the bot with @BotFather; get your id from @userinfobot.
2. `supabase secrets set --env-file agent/.env` (copy `.env.example` to `agent/.env`, fill it, don't commit it).
3. `supabase functions deploy guardian --no-verify-jwt --project-ref zaziizzsbytkdlatoutv`
4. Point Telegram at it:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian" -d secret_token="<TELEGRAM_WEBHOOK_SECRET>"`
5. Alerts every 15 min (SQL editor, needs pg_cron + pg_net):
   ```sql
   select cron.schedule('guardian-alert', '*/15 * * * *', $$
     select net.http_post('https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian?cron=1',
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb) $$);
   ```
6. Message `/status` to your bot.

Note: GitHub Pages cannot set security headers; put the domain behind Cloudflare to clear the header warning.
