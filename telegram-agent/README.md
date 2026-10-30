# Guardian — Telegram security agent

A serverless Telegram bot (Supabase Edge Function) backed by Claude. It watches rzgspro.com, the Supabase database and the GitHub repo, and answers you in Telegram.

**Read-only by design.** It can check; it cannot change, delete or expose anything. A hijacked chat or a prompt-injected issue title therefore cannot damage the site.

## What it checks
| Tool | Looks at |
|---|---|
| check_website / check_ssl | status + latency of key pages, missing security headers, HTTP→HTTPS |
| github_issues / github_activity / github_security_alerts | open issues, unexpected commits, Dependabot + secret-scanning alerts |
| db_security_audit | tables without RLS, anon-readable tables |
| db_recent_signups / db_auth_failures | sign-up floods, brute-force IPs |

Commands: `/check`, `/site`, `/db`, `/github`, `/security`, or any free-text question.

## Security model
1. Webhook accepts only requests carrying `X-Telegram-Bot-Api-Secret-Token` (constant-time compare); others get 404.
2. Only `OWNER_TELEGRAM_ID` in a private chat is served; all others are silently ignored.
3. Database access = 3 fixed `monitor_*` functions, granted to `service_role` only. No free-form SQL.
4. External text (issues, commits) is wrapped as untrusted data and the model is told never to follow it.
5. Secrets live in Supabase function secrets, never in this repo. Use a **read-only** fine-grained GitHub token.

## Setup (when you have the bot)
1. Create the bot with @BotFather → get `TELEGRAM_BOT_TOKEN`. Get your numeric id from @userinfobot → `OWNER_TELEGRAM_ID`.
2. Run `sql/monitor.sql` in the Supabase SQL editor.
3. Set secrets:
   ```
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     OWNER_TELEGRAM_ID=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... SITE_URL=https://rzgspro.com
   ```
4. Deploy (JWT check off, since Telegram can't send one; the secret header protects it):
   ```
   cd telegram-agent && supabase functions deploy guardian --no-verify-jwt
   ```
5. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian" \
     -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
   ```
6. Optional proactive alerts: add a Supabase cron (pg_cron) calling the function, or a GitHub Action, to push a `/check` daily.

## Limits to know
- Use a separate bot from the sales bot `@rzgsprobot`; this one is private to you.
- It cannot block attackers itself. For real blocking use Cloudflare in front of the domain (WAF, rate limiting) and enable Supabase Auth rate limits + CAPTCHA.
- GitHub Pages cannot set security headers; the missing-headers report is informational unless you proxy via Cloudflare.
