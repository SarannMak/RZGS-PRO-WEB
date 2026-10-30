# RZGS-PRO guardian (Telegram bot)

Serverless Cloudflare Worker. Answers commands from you only, and pings you when a scheduled check finds a problem.
It is **read-only**: it cannot change your site, database or code.

## Commands
`/status` `/site` `/security` `/db` `/issues` `/chatid`

## Setup
1. Create the bot with @BotFather, keep the token.
2. `cd telegram-agent && npx wrangler deploy`
3. Set secrets (`npx wrangler secret put NAME`):
   - `TELEGRAM_BOT_TOKEN` – from BotFather
   - `WEBHOOK_SECRET` – any long random string (`openssl rand -hex 32`)
   - `OWNER_ID` – your Telegram user id (message the bot `/chatid` after step 4, then set it)
   - `SUPABASE_PUBLISHABLE_KEY` – the public `sb_publishable_...` key (optional)
   - `SUPABASE_ACCESS_TOKEN` – Supabase personal access token, for security advisors (optional)
   - `GITHUB_TOKEN` – fine-grained, read-only: Issues, Dependabot alerts, Secret scanning alerts on this repo (optional)
4. Point Telegram at the Worker:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://rzgs-guardian.<you>.workers.dev \
     -d secret_token=<WEBHOOK_SECRET>
   ```

## Safety rules built in
- Webhook rejects any request without the secret header (constant-time compare).
- Only `OWNER_ID` gets answers; everyone else is ignored silently.
- No secrets in code; the bot never accepts SQL or shell input.
- Use least-privilege tokens. Never give it the Supabase `service_role` key.

## Ideas for later
Failed-login spikes (Supabase auth logs), TLS expiry, DNS change detection, and a confirm-first `/lockdown` action.
