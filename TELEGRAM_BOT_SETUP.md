# Telegram security agent — setup

Serverless bot on a Supabase Edge Function (`supabase/functions/telegram-agent`).

## Safety design
- Webhook only accepts requests carrying Telegram's secret token.
- Only your Telegram user ID gets answers; everyone else is silently ignored.
- All tools are **read-only** and fixed. No SQL/shell from chat, no write access to site, DB or repo.
- Tool output is treated as data by the AI layer (prompt-injection guard).
- Use least-privilege tokens: GitHub fine-grained token (read: issues, actions, Dependabot, secret scanning), Supabase PAT, never the service-role key.

## Steps
1. Telegram: create bot with @BotFather → `TELEGRAM_BOT_TOKEN`. Get your numeric ID from @userinfobot → `TELEGRAM_OWNER_ID`.
2. Generate secrets: `openssl rand -hex 32` twice → `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`.
3. Set secrets:
   ```
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_ID=... TELEGRAM_WEBHOOK_SECRET=... CRON_SECRET=... \
     SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... GITHUB_TOKEN=... ANTHROPIC_API_KEY=... (optional, enables free-text)
   ```
4. Deploy: `supabase functions deploy telegram-agent --no-verify-jwt`
5. Register webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://<ref>.supabase.co/functions/v1/telegram-agent \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
6. Alerts: schedule `POST https://<ref>.supabase.co/functions/v1/telegram-agent/sweep` with header `x-cron-secret: <CRON_SECRET>` every 15 min (pg_cron + pg_net, or any cron). It messages you only on problems.

## Commands
/status /security /db /auth /logs /issues /ci /all — or ask in plain text.

## Limits
GitHub Pages can't set security headers; put Cloudflare in front of rzgspro.com for real WAF/DDoS/header protection. The bot reports on this; it can't block attackers itself.
