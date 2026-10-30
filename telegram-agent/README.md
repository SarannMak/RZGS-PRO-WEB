# RZGS-PRO Guardian (Telegram + Claude)

A serverless Telegram bot that watches rzgspro.com for you. It runs as a Supabase Edge Function
(`supabase/functions/guardian`) and uses Claude with read-only tools:

| Tool | What it checks |
|---|---|
| `check_site` | pages up/down, response time, security headers |
| `github_issues` / `github_activity` | open issues & PRs, recent commits and workflow runs (unexpected changes) |
| `github_security` | Dependabot, code-scanning, secret-scanning alerts |
| `supabase_advisors` | missing RLS, exposed tables, weak settings |
| `supabase_logs` | auth (failed logins), api (5xx), postgres errors |
| `db_query` | one read-only SELECT, max 50 rows |

Commands: `/status` (full check), `/security`, `/issues`, or ask anything in plain words.
A daily digest can be pushed to you automatically (step 5).

## How it protects itself

- Webhook only accepts Telegram's secret header (constant-time compare); everything else gets 403.
- Only your numeric Telegram user id(s) in `OWNER_CHAT_IDS` and only private chats. Strangers are ignored and you get an alert.
- **Read-only by design**: no tool can write to the site, GitHub or the database. A prompt-injection (e.g. a malicious issue title) can at worst make it say something wrong, not change anything.
- Tool output is treated as untrusted; the model is told to report injection attempts.
- SQL is limited to one SELECT, checked here and again by Supabase's read-only endpoint.
- Secrets/JWTs/tokens are redacted from everything sent to Telegram or the model.
- Use **least-privilege tokens** (below) so even a leaked token can't do damage.

## Setup

1. **Telegram**: talk to @BotFather → `/newbot` → copy the token. Get your user id from @userinfobot.
2. **Tokens**
   - GitHub fine-grained PAT, only this repo, read-only: Issues, Pull requests, Contents, Actions, Dependabot alerts, Code scanning alerts, Secret scanning alerts, Metadata.
   - Supabase access token (Account → Access Tokens). It is account-wide, so create it from a dedicated account/org member with read-only role if you can.
   - Anthropic API key.
3. **Secrets & deploy** (Supabase CLI):
   ```bash
   supabase secrets set --project-ref zaziizzsbytkdlatoutv \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
     OWNER_CHAT_IDS=123456789 CRON_SECRET=$(openssl rand -hex 24) \
     ANTHROPIC_API_KEY=... GITHUB_TOKEN=... SUPABASE_ACCESS_TOKEN=... \
     GITHUB_REPO=sarannmak/rzgs-pro-web
   cd telegram-agent && supabase functions deploy guardian --no-verify-jwt --project-ref zaziizzsbytkdlatoutv
   ```
   `--no-verify-jwt` is needed because Telegram can't send a Supabase JWT; the secret header replaces it.
4. **Register the webhook**:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian" \
     -d secret_token="<TELEGRAM_WEBHOOK_SECRET>" -d allowed_updates='["message"]'
   ```
5. **Daily digest** (SQL editor; needs `pg_cron` and `pg_net` extensions):
   ```sql
   select cron.schedule('guardian-digest', '0 2 * * *', $$
     select net.http_post(
       url := 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian/digest',
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb);
   $$);
   ```

## Notes / honest limits

- Written without a Deno runtime in this environment, so it is **not yet run**. The Supabase Management API paths
  (`advisors/*`, `analytics/endpoints/logs.all`, `database/query/read-only`) should be verified on first deploy; `/status` will show a tool error if one is wrong.
- GitHub Pages can't set security headers (CSP, HSTS…). Putting Cloudflare in front of rzgspro.com is the practical fix; the bot will tell you when headers are missing.
- It cannot block attackers by itself (read-only). For active defense add Cloudflare WAF/rate limiting and Supabase Auth rate limits/CAPTCHA, and let the bot alert you.
- The anon key in `auth.js` is public by design; real protection is **Row Level Security** on every table, which `supabase_advisors` checks.
