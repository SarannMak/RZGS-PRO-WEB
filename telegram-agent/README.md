# RZGS Guardian — Telegram security agent

A read-only serverless bot (Supabase Edge Function) that watches `rzgspro.com`,
the Supabase database and this GitHub repo, and pings you on Telegram.

## What it checks
| Command | Checks |
|---|---|
| `/site` | every page up/slow, `.git`/`.env`/backup files not exposed, unknown external scripts, obfuscated-injection patterns |
| `/db` | tables without RLS, anonymous write policies that are always true, signup spikes, failed-login bursts (brute force), Supabase security advisor |
| `/security` | Dependabot / secret-scanning / code-scanning alerts, commits in last 24h |
| `/issues` | open issues and PRs |
| `/status` | everything above |

The `/cron` route runs the full scan on a schedule and messages you **only when something is wrong**.

## Safety design
- Only Telegram ids in `TELEGRAM_OWNER_IDS`, private chats only; strangers get no reply and you get an alert.
- Webhook requires Telegram's secret token; `/cron` requires its own secret (constant-time compare).
- No write actions, no user-supplied SQL — fixed read-only queries only.
- Use a **fine-grained, read-only** GitHub token and a dedicated Supabase access token. Never put these in the repo.

## Setup
1. Telegram: talk to @BotFather → `/newbot` → copy the token. Send `/whoami` after deploy to get your id.
2. Deploy:
   ```
   supabase functions deploy guardian --project-ref zaziizzsbytkdlatoutv --no-verify-jwt
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
     CRON_SECRET=$(openssl rand -hex 24) TELEGRAM_OWNER_IDS=<your id> \
     GITHUB_TOKEN=... SUPABASE_ACCESS_TOKEN=...
   ```
   (Don't know your id yet? Deploy with `TELEGRAM_OWNER_IDS=0`, message the bot `/whoami` — it answers anyone with their own id only — then re-set the secret.)
3. Register the webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
4. Schedule (Supabase SQL editor, needs pg_cron + pg_net):
   ```sql
   select cron.schedule('guardian-scan', '*/30 * * * *', $$
     select net.http_post(
       url := 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian/cron',
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb);
   $$);
   ```

Optional env: `SITE_URL`, `GITHUB_REPO`, `SUPABASE_PROJECT_REF`.
