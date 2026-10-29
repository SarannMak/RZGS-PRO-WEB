# Guardian – Telegram security agent

A serverless Telegram bot (Supabase Edge Function `guardian-bot`) running a Claude agent that watches
rzgspro.com, the Supabase project and this GitHub repo, and reports only to you.

## What it can do (read-only)
| Tool | Purpose |
|---|---|
| `check_website` | uptime, latency, HTTP→HTTPS redirect, missing security headers |
| `db_security_advisors` | Supabase advisor findings (missing RLS, exposed views…) |
| `db_query` | single read-only SELECT, 50 rows max, credential tables blocked |
| `db_logs` | auth / API / Postgres / edge logs: brute force, error spikes |
| `github_issues` | open issues and PRs |
| `github_security` | Dependabot, code-scanning, secret-scanning alerts, recent commits |

Commands: `/status /security /db /logs /issues`, or type any question.
A scheduled sweep messages you only when something is wrong.

## Built-in protections
- Webhook accepts only requests with Telegram's secret token (constant-time check).
- Only your Telegram user id gets answers; any stranger is ignored and you are alerted.
- Agent has no write tools; tool output is treated as untrusted (prompt-injection guard); secrets are masked.
- SQL guard: one SELECT only, blocked keywords, `auth.users`/`vault` blocked, row cap.

Honest limits: the SQL guard is a filter, not a sandbox. Use a **read-only** Supabase access token if
you can, and keep the bot token and keys only in Supabase secrets, never in the repo.

## Setup (once you have created the bot with @BotFather)
1. Get your numeric Telegram id from @userinfobot.
2. Create tokens: Supabase access token (Account → Access Tokens), a GitHub fine-grained token
   (read: Issues, Pull requests, Contents, Dependabot/Code/Secret scanning alerts), Anthropic API key.
3. Set secrets and deploy:
```bash
supabase secrets set --project-ref zaziizzsbytkdlatoutv \
  TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_ID=... \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) CRON_SECRET=$(openssl rand -hex 24) \
  ANTHROPIC_API_KEY=... SUPABASE_ACCESS_TOKEN=... GITHUB_TOKEN=...
supabase functions deploy guardian-bot --no-verify-jwt --project-ref zaziizzsbytkdlatoutv
```
4. Point Telegram at it:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url="https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian-bot" \
  -d secret_token="<TELEGRAM_WEBHOOK_SECRET>"
```
5. Scheduled sweep (hourly) from pg_cron/GitHub Actions:
`curl -X POST -H "x-cron-secret: <CRON_SECRET>" "https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/guardian-bot?task=digest"`

Optional env: `SITE_URL`, `GITHUB_REPO`, `SUPABASE_PROJECT_REF`, `ANTHROPIC_MODEL`.
Note: the Supabase advisors/logs Management API paths should be verified on first run (`/advisors/security`, `/analytics/endpoints/logs.all`).
