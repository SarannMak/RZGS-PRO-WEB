# RZGS-PRO guardian agent (Telegram)

A serverless Telegram bot, backed by Claude, that watches rzgspro.com for you: site uptime and headers, GitHub
issues/commits/security alerts, Supabase advisors, auth logs and database health. It runs as a Supabase Edge Function.

## Safety model
- **Owner only.** Updates must carry Telegram's webhook secret token, come from a private chat, and from an ID in `OWNER_TELEGRAM_IDS`. Everyone else is silently ignored.
- **Read-only.** No tool changes anything. Database access is a fixed list of named queries; the model never writes SQL. Fixes are suggested to you, not applied.
- **Prompt-injection aware.** Issue text, logs and commit messages are treated as data. Since the tools can't write, a hostile issue can't make the agent act.
- **Least privilege tokens.** Use a fine-grained GitHub token (read: contents, issues, metadata, Dependabot/code/secret scanning alerts) and a Supabase access token you can revoke. Never use the `service_role` key here.
- Rate-limited (10 messages/min) so a leaked chat can't run up the Claude bill.

## Setup (once you've made the bot)
1. Create the bot with @BotFather and copy the token. (The public `@rzgsprobot` is for customers: make a **separate** private bot for this agent.)
2. Get your numeric Telegram ID from @userinfobot.
3. Set secrets and deploy:
   ```bash
   cd telegram-agent
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... OWNER_TELEGRAM_IDS=123456789 \
     WEBHOOK_SECRET=$(openssl rand -hex 24) CRON_SECRET=$(openssl rand -hex 24) \
     ANTHROPIC_API_KEY=... GITHUB_TOKEN=... SUPABASE_ACCESS_TOKEN=...
   supabase functions deploy telegram-agent --project-ref zaziizzsbytkdlatoutv --no-verify-jwt
   ```
4. Point Telegram at it (use the same `WEBHOOK_SECRET`):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-agent \
     -d secret_token=<WEBHOOK_SECRET> -d allowed_updates='["message"]'
   ```
5. Optional, proactive watch: call `POST /functions/v1/telegram-agent/digest` with header `x-cron-secret: <CRON_SECRET>` every hour (pg_cron or a GitHub Actions schedule). It only messages you when the verdict isn't OK.

Optional env: `SITE_URL`, `GITHUB_REPO`, `SUPABASE_PROJECT_REF`, `CLAUDE_MODEL`.

## Commands
`/status` `/site` `/issues` `/security` `/activity`, or ask in plain words ("any odd signups today?").

## Notes
The Supabase Management API paths used in `tools.ts` (advisors, analytics logs, database/query) should be checked against the current API reference on first deploy; a failing call returns an error string and the agent reports it instead of guessing.
Next steps worth adding: a confirm-before-act button for actions like blocking a user, and security headers on the site (GitHub Pages can't set them; Cloudflare in front can).
