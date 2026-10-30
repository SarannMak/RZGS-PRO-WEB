# telegram-guardian

Claude-powered security and operations agent for rzgspro.com, run as a serverless Telegram bot (Supabase Edge Function).

## What it does
- Chat commands: `/scan`, `/site`, `/repo`, `/logs`, `/advisors`, or any plain question.
- Tools (all read-only): site uptime/TLS/headers, GitHub commits/issues/PRs and Dependabot/code/secret-scanning alerts, Supabase auth/API/Postgres logs and security advisors.
- Scheduled scan: pings you only when something is wrong.

## Safety design
- Only your Telegram user/chat id gets answers; everyone else is silently ignored.
- Webhook requires Telegram's secret token (constant-time compare). Missing config means the bot refuses everything.
- The agent has no write tools and no free-form SQL (fixed named log queries only), so a prompt-injected issue title or log line cannot change anything.
- Tool output is treated as untrusted; the agent is told to report injection attempts and never echo secrets.
- Use least-privilege tokens: a fine-grained GitHub PAT (read-only: contents, issues, pull requests, Dependabot/code/secret scanning alerts) and a Supabase personal access token.

## Setup
1. Create the bot with @BotFather, copy the token. Get your numeric id from @userinfobot.
2. Set secrets:
   ```
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_CHAT_ID=... \
     TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) CRON_SECRET=$(openssl rand -hex 24) \
     ANTHROPIC_API_KEY=... GITHUB_TOKEN=... SUPABASE_MGMT_TOKEN=...
   ```
   Optional: `SITE_URL`, `GITHUB_REPO`, `SUPABASE_PROJECT_REF`, `ANTHROPIC_MODEL`.
3. Deploy: `supabase functions deploy telegram-guardian --project-ref zaziizzsbytkdlatoutv` (`verify_jwt = false` is set in `supabase/config.toml`).
4. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
5. Scheduled scan (e.g. hourly): call the function with `x-cron-secret: <CRON_SECRET>` from pg_cron/pg_net or a GitHub Actions cron.

## Notes
- Not yet run: written without a Deno runtime. Deploy and try `/site` first. The Supabase log SQL and `/advisors/security` Management API path should be confirmed against current docs.
- Never commit the secrets above; rotate them if they leak.
