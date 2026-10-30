# RZGS Guardian (Telegram security bot)

Read-only watchdog for rzgspro.com, the Supabase project and the GitHub repo. It reports; it cannot change anything.
Anyone except you gets no reply, and you get a "Blocked message" alert instead.

## Commands
`/status` `/site` `/security` `/activity` `/issues` `/id` `/help`. A scheduled call (`?cron=1`) messages you only when something is wrong.

## Setup
1. **Create the bot**: Telegram → @BotFather → `/newbot` → copy the token.
2. **Find your id**: deploy first (step 4), then message the bot `/id`. Messages from unknown ids are blocked, so the first try shows up as "Blocked message from id N" only once `OWNER_TELEGRAM_IDS` is set; set it to a placeholder `0`, send `/id` from your account, read the alert in the function logs, then set the real id. (Or use @userinfobot.)
3. **Create tokens, least privilege**
   - `SUPABASE_MGMT_TOKEN`: Supabase dashboard → Account → Access Tokens. This token covers your whole account, so treat it as the most sensitive secret.
   - `GITHUB_TOKEN`: fine-grained PAT on this repo only, read-only: Issues, Contents, Metadata, Dependabot alerts, Secret scanning alerts, Code scanning alerts.
4. **Deploy**
   ```bash
   mkdir -p supabase/functions/guardian && cp telegram-agent/index.ts supabase/functions/guardian/index.ts
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     CRON_SECRET=$(openssl rand -hex 32) OWNER_TELEGRAM_IDS=123456789 \
     SUPABASE_PROJECT_REF=zaziizzsbytkdlatoutv SUPABASE_MGMT_TOKEN=... GITHUB_TOKEN=...
   supabase functions deploy guardian --no-verify-jwt   # Telegram can't send a JWT; the secret header is the auth
   ```
5. **Point Telegram at it**
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> -d allowed_updates='["message"]'
   ```
6. **Schedule alerts** (e.g. every 15 min): Supabase → Integrations → Cron, or any scheduler, doing
   `GET .../functions/v1/guardian?cron=1` with header `x-cron-secret: <CRON_SECRET>`.

## Things to verify (I could not test these without your credentials)
- The Supabase endpoints `/advisors/security` and `/analytics/endpoints/logs.all` and the auth-log SQL in `checkAuthActivity` may need adjusting to your project; if a check fails, the bot shows which one and the rest still run.
- GitHub Pages cannot set security headers (CSP, HSTS). Putting Cloudflare in front of rzgspro.com is the practical fix; the bot reports which headers are missing.

## Security notes
- Fixed rules: webhook secret checked in constant time, owner-id allowlist, private chats only, rate limit, HTML-escaped output, no secrets in code.
- It is deliberately read-only. Adding actions (ban user, rotate keys) should need a confirm button and its own narrow token.
- Rotate the bot token in @BotFather if it ever leaks.
