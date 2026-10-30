# telegram-agent

Read-only Telegram bot that watches rzgspro.com, the Supabase project and the GitHub repo.
It cannot change anything: no writes, no deploys, no SQL.

## Commands
`/status` `/security` `/issues` `/activity` `/all` `/help`

Plus a scheduled sweep (`POST /?cron=1`) that messages you **only** when a check fails:
site down or slow, missing security headers, http not redirecting to https, Supabase service
unhealthy, Supabase security advisor errors, open Dependabot / secret / code-scanning alerts,
a spike of failed logins.

## Setup
1. Telegram → @BotFather → `/newbot` → copy the token. Message your bot once, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` to read your numeric `chat.id`.
2. Tokens (least privilege):
   - GitHub: fine-grained PAT on this repo only, read-only: Contents, Issues, Pull requests, Metadata,
     Dependabot alerts, Secret scanning alerts, Code scanning alerts.
   - Supabase: Account → Access Tokens. This token is account-wide, so treat it as sensitive.
3. Deploy:
   ```
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
     OWNER_CHAT_ID=... CRON_SECRET=$(openssl rand -hex 24) \
     GITHUB_TOKEN=... SB_ACCESS_TOKEN=...
   supabase functions deploy telegram-agent --project-ref zaziizzsbytkdlatoutv
   ```
4. Point Telegram at it (use the same webhook secret):
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
5. Schedule the sweep (e.g. every 15 min) with pg_cron + pg_net, or any external cron:
   `curl -X POST "https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent?cron=1" -H "x-cron-secret: <CRON_SECRET>"`

## Notes
- Never commit tokens. Everything above lives in Supabase secrets.
- Security headers (HSTS, CSP) cannot be set from GitHub Pages; the agent will keep flagging them
  until the site sits behind something like Cloudflare. Remove entries from `EXPECTED_HEADERS` if you accept that.
- The failed-login query in `activity()` is a starting point; adjust it once you see your real auth log shape.
