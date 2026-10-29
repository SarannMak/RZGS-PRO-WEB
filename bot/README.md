# RZGS-PRO Guardian (Telegram bot)

Read-only watchdog for rzgspro.com, running serverless on Cloudflare Workers (free tier is enough).

## What it does
- `/site` uptime, speed, missing security headers, unexpected `<script>` sources (defacement/injection signal)
- `/issues`, `/commits` open issues/PRs and recent changes (spot commits you did not make)
- `/ghsecurity` Dependabot, secret scanning, code scanning alerts
- `/db` Supabase project health and security advisors (e.g. tables missing RLS)
- `/authlogs` failed-login spikes (brute force)
- `/ask <question>` Claude agent that calls those tools and explains/prioritises
- Every 15 min it checks everything and messages you only when something changes for the worse (and when it recovers).

## How it stays safe
- Webhook requires Telegram's secret header; only your user ID in a private chat is answered, strangers are ignored silently.
- All tools are read-only; there is no command that edits data, code or settings, so a hijacked chat cannot damage the site.
- Use read-only tokens only. Credentials are Worker secrets, redacted from output, never in git.
- Website/log text is treated as untrusted by the AI (prompt-injection guard).

## Setup (about 10 minutes)
1. Telegram: message @BotFather, `/newbot`, copy the token. Message @userinfobot to get your numeric ID.
2. `cd bot && npm i -g wrangler && wrangler login`
3. `wrangler kv namespace create STATE`, paste the id into `wrangler.toml`.
4. Secrets (each prompts for the value):
   ```
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string, A-Z a-z 0-9 _ -
   wrangler secret put OWNER_CHAT_ID             # your numeric Telegram ID
   wrangler secret put GITHUB_TOKEN              # fine-grained, read-only: Issues, PRs, Contents, Dependabot/secret/code scanning alerts
   wrangler secret put SUPABASE_ACCESS_TOKEN     # Supabase dashboard > Account > Access Tokens
   wrangler secret put ANTHROPIC_API_KEY         # optional, for /ask
   ```
5. `wrangler deploy`, then register the webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<your-worker>.workers.dev/webhook" -d "secret_token=<WEBHOOK_SECRET>"
   ```
6. Send `/start` to your bot.

## Notes
- Supabase advisor/log endpoints are on the Management API; if one returns an error, the bot reports "unavailable" instead of failing.
- GitHub Pages cannot set security headers. Putting the domain behind Cloudflare (free) lets you add HSTS/CSP and a WAF, which protects against attackers far better than any bot.
- Also turn on in Supabase: RLS on every table, email rate limits, CAPTCHA on signup, and MFA for your own dashboard/GitHub accounts.
