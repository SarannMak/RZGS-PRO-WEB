# RZGS guard: Telegram security agent

Read-only watchdog for rzgspro.com, the Supabase project and this repo. One Supabase Edge Function, no server.

## What it does
- `/status` runs everything. `/site`, `/db`, `/auth`, `/repo` run one part.
- Site: up/down and latency, missing security headers, http→https, exposed `/.git/config` and `/.env`.
- Database: tables without RLS, policies open to `anon`, SECURITY DEFINER functions callable by `anon`.
- Auth: burst of sign-in errors in the last hour (credential stuffing).
- Repo: open secret-scanning, Dependabot and code-scanning alerts, open issues.
- A schedule calls it every 15 minutes and it messages you **only when something is wrong**.

## Why it is safe
- Replies only to ids in `OWNER_TELEGRAM_IDS`; everyone else is ignored.
- Webhook requires Telegram's secret token; the scheduler path requires `CRON_SECRET` (both compared in constant time).
- It has no write commands and no free-form SQL: queries are fixed in the code. Do not add "run SQL" or "deploy" commands; a stolen Telegram account would then own the site.
- Tokens are read-only and live only in Supabase secrets, never in this repo (the repo is served publicly by GitHub Pages).
- Turn on Telegram two-step verification on your account.

## Setup
1. @BotFather → `/newbot`, copy the token. Send `/id` to your bot after step 4 to learn your id.
2. Create tokens: GitHub fine-grained token (read-only: Issues, Dependabot alerts, Code scanning, Secret scanning); Supabase personal access token (supabase.com/dashboard/account/tokens).
3. Deploy:
   ```
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     CRON_SECRET=$(openssl rand -hex 32) OWNER_TELEGRAM_IDS=123456 SUPABASE_ACCESS_TOKEN=... GITHUB_TOKEN=...
   mkdir -p supabase/functions/guard && cp telegram-agent/index.ts supabase/functions/guard/index.ts
   supabase functions deploy guard --no-verify-jwt --project-ref zaziizzsbytkdlatoutv
   ```
4. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guard \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> -d allowed_updates='["message"]'
   ```
5. Schedule (Supabase SQL editor, needs pg_cron + pg_net):
   ```sql
   select cron.schedule('guard-15min', '*/15 * * * *', $$
     select net.http_post('https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guard',
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb) $$);
   ```
`OWNER_TELEGRAM_IDS` must be set before the first real use; until then the bot ignores everyone.
