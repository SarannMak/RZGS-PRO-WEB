# telegram-guardian

Telegram bot that watches rzgspro.com, the Supabase project and the GitHub repo. **Read-only**: it reports, it cannot change or delete anything.

## What it does
| Command | Checks |
|---|---|
| `/status` | everything below |
| `/site` | uptime, latency, HTTP→HTTPS redirect, publicly exposed `.git`/`.env`, missing security headers |
| `/security` | Supabase security advisors, GitHub Dependabot / code / secret scanning alerts |
| `/activity` | signups and sign-ins in 24h, unconfirmed accounts, signup-spike (bot abuse) detection |
| `/issues` | open issues and PRs, failed GitHub Actions runs |
| `/ask <question>` | plain-language questions answered by Claude using the same read-only checks |

A scheduled scan (`?job=scan`) messages you **only when something is wrong**.

## How it stays safe
- Webhook rejects anything without Telegram's secret token (constant-time compare).
- Only your Telegram user id, in your private chat, gets answers. Strangers get silence, and you get an alert.
- Owner rate limit (20/min). No write tools exist, so a hijacked chat or prompt injection cannot modify anything.
- Secrets live in Supabase function secrets, never in the repo or the website.

## Setup (about 10 minutes)
1. In Telegram, talk to `@BotFather` → `/newbot` → copy the token. Message `@userinfobot` to get your numeric id.
2. Generate two random secrets: `openssl rand -hex 32` (twice).
3. Set secrets and deploy:
   ```bash
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... OWNER_CHAT_ID=... WEBHOOK_SECRET=... CRON_SECRET=... \
     GITHUB_TOKEN=...            # fine-grained, read-only: Issues, Actions, Security events, Dependabot alerts, Secret scanning
   # optional:
   supabase secrets set ANTHROPIC_API_KEY=... SUPABASE_ACCESS_TOKEN=...
   supabase functions deploy telegram-guardian --project-ref zaziizzsbytkdlatoutv --no-verify-jwt
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
4. Point Telegram at it:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian" \
     -d secret_token="$WEBHOOK_SECRET" -d allowed_updates='["message"]'
   ```
5. Schedule the scan (SQL editor, needs `pg_cron` + `pg_net`):
   ```sql
   select cron.schedule('guardian-scan', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian?job=scan',
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb);
   $$);
   ```
6. Send `/start` to your bot.

## Hardening you should still do
- The function holds the Supabase service-role key. Never give the bot write tools without a confirm step.
- GitHub Pages cannot send security headers (CSP, HSTS). Put Cloudflare (free) in front of rzgspro.com; `/site` will tell you when it is done.
- Turn on Supabase leaked-password protection, email confirmation and CAPTCHA on signup; enable GitHub secret scanning and Dependabot.
