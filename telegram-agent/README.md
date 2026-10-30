# RZGS PRO guardian bot

Telegram bot backed by a Claude agent. Runs as one Supabase Edge Function. **Read-only**: it can look at your site, Supabase and GitHub, report problems and tell you what to do, but it cannot change anything.

## What it does
- `/status` site up/down, latency, security headers
- `/security` headers + Supabase security advisors + GitHub Dependabot / secret-scanning / code-scanning + recent commits
- `/activity` auth and API error logs (brute force, spikes)
- `/issues` open GitHub issues
- `/scan` run the alert check now
- Free text: ask anything, the agent picks the tools
- Scheduled check (every 15 min) messages you **only** when something is wrong

## Security model
- Only your Telegram user/chat ID (`OWNER_CHAT_ID`) is answered; everyone else is ignored.
- Webhook requires Telegram's secret token; cron endpoint requires `CRON_SECRET`.
- Tokens are least privilege and read-only. Never give it the Supabase `service_role` key or a write-scoped GitHub token.
- Tool output (logs, issue text) is treated as untrusted; the agent has no write tools, so prompt injection cannot cause damage.

## Setup (after you create the bot with @BotFather)
1. Get your chat ID from @userinfobot.
2. Create tokens:
   - `SUPABASE_ACCESS_TOKEN`: Supabase account tokens (used for advisors and logs; it is account-wide, so keep it only in secrets).
   - `GITHUB_TOKEN`: fine-grained, this repo only, read-only: Issues, Contents, Dependabot alerts, Secret scanning alerts, Code scanning alerts.
   - `ANTHROPIC_API_KEY`.
3. Deploy:
   ```
   supabase functions deploy guardian --no-verify-jwt --project-ref zaziizzsbytkdlatoutv
   # copy telegram-agent/index.ts to supabase/functions/guardian/index.ts first
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
     OWNER_CHAT_ID=... CRON_SECRET=$(openssl rand -hex 24) SITE_URL=https://rzgspro.com \
     SUPABASE_PROJECT_REF=zaziizzsbytkdlatoutv GITHUB_REPO=sarannmak/rzgs-pro-web \
     GITHUB_TOKEN=... SUPABASE_ACCESS_TOKEN=... ANTHROPIC_API_KEY=...
   ```
4. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
5. Schedule (Supabase SQL editor, needs pg_cron + pg_net):
   ```sql
   select cron.schedule('guardian-scan','*/15 * * * *', $$
     select net.http_post(
       url:='https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian?cron=1',
       headers:='{"x-cron-secret":"<CRON_SECRET>"}'::jsonb);
   $$);
   ```

## Not covered (be honest about limits)
It detects and advises; it cannot block attackers. For real protection put the domain behind Cloudflare (WAF, rate limiting, bot fight mode), enable RLS on every table, and turn on Supabase auth rate limits and CAPTCHA.
