# Guardian — Telegram security agent for RZGS-PRO

A serverless (Cloudflare Worker) Telegram bot backed by Claude. You chat with it; it checks the website,
Supabase database/auth and the GitHub repo, and a 15-minute cron pings you **only** when something looks wrong.

## What it does
| Area | Checks |
|---|---|
| Website | uptime, latency, missing security headers, homepage content change (defacement), new third-party script hosts |
| Supabase | tables without RLS, wide-open anon policies, signup spikes, brute-force IPs, logs, ad-hoc SELECT |
| GitHub | open issues/PRs, secret-scanning, Dependabot, code-scanning alerts, recent commits |

Commands: `/status` (full sweep), `/audit` (strangers who messaged the bot), `/reset`, or just ask in plain words.

## How it protects itself
- Telegram webhook secret header verified (constant-time); everything else gets 403.
- Only `OWNER_CHAT_ID` (private chat) is answered. Strangers get silence and are logged for `/audit`.
- **Read-only**: no tool can change the site, DB or repo. SQL is single-statement SELECT-only and row-capped.
- Tool output is treated as untrusted (prompt-injection rule in system prompt); secrets/JWTs are redacted from replies.
- Rate limit 10 msgs/min; all secrets live in Wrangler secrets, never in the repo.

## Setup (≈10 min)
1. Telegram: message @BotFather → `/newbot` → copy the token. Get your numeric chat id from @userinfobot.
2. `cd telegram-agent && npm install`
3. `npx wrangler kv namespace create STATE` → put the id in `wrangler.toml`.
4. Secrets (run each, paste the value):
   ```
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string (A-Z a-z 0-9 _ -)
   npx wrangler secret put OWNER_CHAT_ID
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put SUPABASE_ACCESS_TOKEN     # supabase.com/dashboard/account/tokens
   npx wrangler secret put GITHUB_TOKEN              # fine-grained, this repo only, read: issues, contents, secret scanning, dependabot, code scanning
   ```
5. `npm run deploy`, then register the webhook:
   `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook https://rzgs-guardian-bot.<you>.workers.dev`
6. Message your bot `/status`.

## Notes / limits
- `SUPABASE_ACCESS_TOKEN` is an account-level token (the Management API has no narrower scope). The SQL guard is
  defense-in-depth; keep the token only as a Worker secret and rotate it if exposed.
- GitHub Pages cannot set HTTP security headers, so `missing_security_headers` will list some permanently. Putting
  the domain behind Cloudflare lets you add them (and a WAF / rate limiting against attackers).
- Enable GitHub secret scanning + Dependabot on the repo so those alerts exist.
- Log/auth-audit table names follow current Supabase schemas; if a check errors, the bot reports it rather than failing silently.
- Not tested against live services (no credentials here) — run `/status` after deploy and tell me what errors.
