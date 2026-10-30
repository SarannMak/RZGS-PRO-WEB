# RZGS Telegram security agent

Read-only monitor: site uptime, Supabase health, security advisors, failed-login bursts,
GitHub issues, Dependabot and leaked-secret alerts. Commands: `/status /security /issues /report /id`.
It also sends an alert on its own when a scheduled run finds a problem.

## Setup
1. @BotFather → `/newbot` → copy the token. Message your bot `/id` after step 4 to get your numeric ID.
2. Create secrets (never commit them):
   ```
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
     TELEGRAM_ALLOWED_IDS=<your id> CRON_SECRET=$(openssl rand -hex 24) \
     SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=zaziizzsbytkdlatoutv \
     GITHUB_TOKEN=... GITHUB_REPO=sarannmak/rzgs-pro-web SITE_URL=https://rzgspro.com
   ```
3. `supabase functions deploy telegram-agent --no-verify-jwt` (Telegram can't send a JWT; the webhook secret is the auth).
4. Register the webhook:
   ```
   curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent \
     -d secret_token=$TELEGRAM_WEBHOOK_SECRET
   ```
5. Schedule: POST to the function URL every 15 min with header `x-cron-secret` (pg_cron + pg_net, or GitHub Actions cron).

## Safety model
- Only IDs in `TELEGRAM_ALLOWED_IDS` get replies; webhook and cron calls are checked in constant time.
- No command writes, runs SQL, or touches the service-role key. Use a read-only GitHub token.
- Enable on GitHub: secret scanning, Dependabot alerts, branch protection. Turn on RLS on every table and
  keep MFA on your Supabase/GitHub/Telegram accounts — the bot reports problems, it can't replace those.
- Verify the Management API paths (`/advisors/security`, `/analytics/endpoints/logs.all`) against your plan; adjust the log SQL if your auth log schema differs.
