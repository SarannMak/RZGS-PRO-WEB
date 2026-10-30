# RZGS guardian: Telegram security agent

A serverless Telegram bot (Supabase Edge Function `telegram-agent`) that watches the website, database, GitHub repo and logins, and messages only you.

## What it does
- `/status`, `/site`, `/db`, `/security`, `/logins`, `/issues`, plus plain-language questions (needs `ANTHROPIC_API_KEY`).
- Every 15 min a monitor run checks everything and pings you only about **new** problems: site down or unexpected scripts on the homepage, tables without RLS, wide-open policies, public buckets, signup spikes, login floods and brute-force IPs, leaked secrets, high/critical Dependabot and code-scanning alerts.
- Ban/unban a user through a confirm button (single use, 2 min).

## How it is locked down
- Webhook requires Telegram's secret header (constant-time compare); anything else gets 403.
- Only your numeric Telegram id, in a private chat. Strangers are ignored, logged in `agent_audit`, and you get a rate-limited heads-up.
- The AI can only call read-only tools with fixed queries. No free-form SQL. It cannot change anything: it can only *propose* a ban, and you must press Confirm.
- Tool output is treated as untrusted data in the prompt (injection via usernames, issue titles, logs). User emails are masked.
- Updates are de-duplicated; every action is written to `agent_audit`.
- Tables have RLS on with no policies, so the website's publishable key cannot read them.

## Setup (about 10 minutes)
1. **Create the bot**: in Telegram talk to @BotFather, `/newbot`, copy the token. Get your numeric id from @userinfobot.
2. **Create the tables**: run `supabase/migrations/20261030000000_telegram_agent.sql` (`supabase db push`).
3. **Set secrets** (never commit these):
   ```
   supabase secrets set \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_ID=... \
     TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     MONITOR_SECRET=$(openssl rand -hex 32) \
     SUPABASE_ACCESS_TOKEN=sbp_...   # read-only audit + auth logs (optional)
     GITHUB_TOKEN=...                # fine-grained, read-only: issues, PRs, Dependabot, secret/code scanning (optional)
     ANTHROPIC_API_KEY=...           # plain-language chat (optional)
   ```
4. **Deploy**: `supabase functions deploy telegram-agent --no-verify-jwt` (Telegram cannot send a Supabase JWT; the secret header replaces it).
5. **Register the webhook**:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" -d 'allowed_updates=["message","callback_query"]'
   ```
6. **Schedule the monitor** (SQL editor; needs `pg_cron` and `pg_net`):
   ```sql
   select cron.schedule('guardian-monitor', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent/monitor',
       headers := jsonb_build_object('x-monitor-secret', '<MONITOR_SECRET>'));
   $$);
   ```
   For better hygiene store the secret in Vault and read it in the job.
7. Message the bot `/status`.

## Limits to know
- GitHub Pages cannot set HTTP security headers, so the bot does not check them. Putting Cloudflare in front is the real fix for DDoS and headers.
- The bot detects and alerts; it cannot block an IP. Brute-force IPs are shown so you can act (Supabase Auth already rate-limits).
- Auth log parsing is best effort and depends on Supabase's log format.
- Not run against a live project yet: type-check with `deno check supabase/functions/telegram-agent/index.ts` after you create the bot and deploy.
- Keep the Supabase access token and Telegram token out of the repo; rotate them if the bot chat is ever shared.
