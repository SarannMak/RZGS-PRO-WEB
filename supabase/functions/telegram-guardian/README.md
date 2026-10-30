# telegram-guardian

Serverless Telegram bot (Supabase Edge Function) that watches rzgspro.com, Supabase and the GitHub repo.
**Read-only by design**: it observes and alerts, it cannot change anything.

## Security model
- Webhook only accepts requests carrying `TELEGRAM_WEBHOOK_SECRET` (constant-time compare).
- Only private chats from user IDs in `TELEGRAM_OWNER_IDS` get answers; strangers get silence.
- No service-role key, no arbitrary SQL, no shell. Tokens should be read-only/least-privilege.
- Rate limited; replies are plain text; tool output is treated as untrusted data by the AI agent.

## Setup
1. Create the bot with @BotFather, get the token. Get your numeric ID from @userinfobot.
2. Generate secrets: `openssl rand -hex 32` (twice: webhook secret, cron secret).
3. Set secrets:
   ```
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... TELEGRAM_OWNER_IDS=123456789 \
     CRON_SECRET=... SUPABASE_ANON_KEY=... \
     GITHUB_TOKEN=...            # fine-grained, read-only: Issues, Contents, Dependabot/secret/code scanning alerts
     SUPABASE_ACCESS_TOKEN=...   # optional: auth logs + advisor
     ANTHROPIC_API_KEY=...       # optional: free-text AI agent
   ```
4. Deploy (JWT check off, Telegram can't send one; the secret header protects it):
   `supabase functions deploy telegram-guardian --no-verify-jwt --project-ref zaziizzsbytkdlatoutv`
5. Register the webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian" \
     -d secret_token="<TELEGRAM_WEBHOOK_SECRET>" -d allowed_updates='["message"]'
   ```
6. Scheduled alerts (every 15 min) via any scheduler, e.g. GitHub Actions cron or pg_cron calling:
   `curl -X POST -H "x-cron-secret: <CRON_SECRET>" https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/telegram-guardian`

Commands: /status /security /issues /activity /all /help. Free text goes to the AI agent.

## Not verified yet
Not run against live services. The Supabase Management API endpoints (`logs.all`, `advisors/security`) are best-effort;
if one errors the bot reports it and carries on.
