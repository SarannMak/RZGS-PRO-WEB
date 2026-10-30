# Telegram monitoring agent

Read-only watchdog for rzgspro.com: site/DB health, security audit, GitHub issues, user activity.
Only the Telegram user IDs in `TELEGRAM_OWNER_IDS` get answers (private chat only); everyone else is silently ignored and logged in `agent_audit`.

## Setup
1. Create the bot with @BotFather → copy the token. Get your numeric ID from @userinfobot.
2. Apply `supabase/migrations/20261030000000_agent_helpers.sql` (SQL editor or `supabase db push`).
3. Set secrets (generate the two random ones with `openssl rand -hex 32`):
   ```
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
     TELEGRAM_OWNER_IDS=123456789 AGENT_CRON_SECRET=... \
     GITHUB_TOKEN=<fine-grained, read-only: Issues, Contents, Metadata, Dependabot alerts>
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
4. Deploy: `supabase functions deploy telegram-agent --no-verify-jwt`
5. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> -d allowed_updates='["message"]'
   ```
6. Proactive alerts (every 5 min, only messages you when something fails): schedule an HTTP POST to
   `.../telegram-agent?cron=1` with header `x-cron-secret: <AGENT_CRON_SECRET>` (pg_cron + pg_net, or a GitHub Actions cron).

## Commands
`/status` `/security` `/issues` `/activity` `/report`

## Notes
- The service-role key lives only in the function environment; never commit it or put it in the website JS.
- GitHub Pages can't set security headers; `/security` reports missing ones as info only. Putting Cloudflare in front adds real header control and DDoS/WAF protection.
- The agent can't block attackers itself (by design). Extend it with explicit, confirm-first actions if you want that later.
