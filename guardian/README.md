# RZGS Guardian: Telegram security agent

A Claude-powered agent that lives in a Telegram chat (Cloudflare Worker, serverless) and watches
rzgspro.com, the GitHub repo and the Supabase project. You chat with it; it also sweeps every
15 min and messages you **only when something changes**.

## What it can do
| Ask / automatic | Source |
|---|---|
| Site up? latency, missing security headers | live HTTP check |
| `.env`, `.git`, backups, SQL dumps publicly reachable? | exposure scan |
| Secret-scanning / Dependabot / code-scanning alerts | GitHub |
| New issues, recent commits, unexpected repo events | GitHub |
| RLS disabled, exposed views, weak settings | Supabase security advisors |
| Failed-login spikes (credential stuffing), API/DB errors | Supabase logs |
| Row counts, policy review | Supabase **read-only** SQL |
| Open a tracking issue | GitHub, only after you tap Confirm |

## How it is kept safe
- **Owner only**: matched on your numeric Telegram id, private chat only. Strangers get silence and you get one alert/hour.
- **Webhook secret**: requests without Telegram's secret header get 403 (constant-time compare).
- **Read-only by design**: no DB writes, no deletes, no key rotation, no settings. The single write (create issue) is parked in KV and runs only after your button tap (one-shot, 5 min expiry), enforced in code, not by the model.
- **Prompt-injection hardening**: tool output is wrapped as untrusted data; the model can't act on it.
- **SQL gate**: single SELECT/WITH only, forbidden keywords and credential columns blocked, plus Supabase's read-only endpoint.
- **SSRF gate**: it can only fetch hosts in `SITE_HOSTS`.
- **Secret redaction** on everything sent to Telegram or to the model; **rate limit** 30 msgs/hour.
- Least-privilege tokens (below). Nothing sensitive is in this repo.

## Setup (about 10 min)
1. Telegram: talk to **@BotFather** → `/newbot` → copy the token. Get your numeric id from **@userinfobot**.
2. `cd guardian && npm install`
3. `npx wrangler login`, then `npx wrangler kv namespace create STATE` and paste the id in `wrangler.toml`.
4. Create tokens:
   - **GitHub** fine-grained PAT: only this repo; read: Contents, Metadata, Issues, Pull requests, Secret scanning alerts, Dependabot alerts, Code scanning alerts; **Issues: write** only if you want issue creation.
   - **Supabase** access token (Account → Access Tokens). It is account-wide, so use a dedicated account/org member if you can.
   - **Anthropic** API key (set a monthly spend limit).
5. Secrets (each prompts for the value):
   ```
   for s in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET OWNER_TELEGRAM_ID ANTHROPIC_API_KEY GITHUB_TOKEN SUPABASE_ACCESS_TOKEN; do npx wrangler secret put $s; done
   ```
   `TELEGRAM_WEBHOOK_SECRET` = any random 32+ char string (`openssl rand -hex 24`).
6. `npx wrangler deploy` → note the `https://rzgs-guardian.<you>.workers.dev` URL.
7. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://rzgs-guardian.<you>.workers.dev/telegram \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
     -d allowed_updates='["message","callback_query"]'
   ```
8. Message your bot `/status`.

## Honest limits
- It *detects and advises*; it can't stop an attack by itself (can't block IPs or rotate keys). That is deliberate: a bot that can change production can be turned against you.
- Put the site behind Cloudflare (free) for real DDoS/bot protection, and turn on GitHub secret scanning + push protection and Supabase RLS on every table.
- Supabase Management API endpoint paths (`advisors/security`, `analytics/endpoints/logs.all`) can change; if a check reports an error, the bot says so instead of reporting "all clear".
- The failed-login count is a log-text heuristic; tune `FAILED_LOGIN_ALERT_THRESHOLD`.
- Run `npm test` for the guard unit tests.
