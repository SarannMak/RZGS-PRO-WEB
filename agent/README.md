# RZGS security agent (Telegram, serverless)

Claude-powered agent that watches rzgspro.com, the Supabase database and the GitHub repo, and talks to you on Telegram.

**Read-only by design.** It can check, audit and advise; it cannot change the site, DB or repo. Anyone not in `ALLOWED_CHAT_IDS` is ignored, and the webhook rejects requests without the secret token.

## What it checks
- Site: uptime/latency, security headers, publicly exposed `.git`/`.env`/source files
- Supabase: RLS per table, anon/authenticated grants, SECURITY DEFINER functions, auth/api/postgres logs, ad-hoc read-only SELECT
- GitHub: open issues/PRs, Dependabot alerts, secret-scanning alerts, recent commits
- Every 6h it sweeps and messages you only if something needs action.

Bot commands: `/scan /site /db /issues /logs`, or ask in plain language.

## Deploy (Cloudflare Workers, free tier works)
1. Create the bot with @BotFather, copy the token. Get your chat id from @userinfobot.
2. Edit `wrangler.toml` → `ALLOWED_CHAT_IDS`.
3. From this folder:
   ```
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET        # any long random string
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put SUPABASE_ACCESS_TOKEN # personal access token, supabase.com/dashboard/account/tokens
   npx wrangler secret put GITHUB_TOKEN          # fine-grained, this repo, READ-only: Issues, Dependabot alerts, Secret scanning alerts, Contents
   npx wrangler deploy
   ```
4. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://rzgs-security-agent.<you>.workers.dev/telegram \
     -d secret_token=<WEBHOOK_SECRET>
   ```

## Safety notes
- Secrets live only in Worker secrets, never in the repo. The Supabase token is account-wide: if you want less blast radius, create it from a dedicated read-mostly account.
- `db_query` accepts a single SELECT only (also sent with `read_only: true`).
- Logs and issue text are treated as untrusted data (prompt-injection guard in the system prompt).
- `_config.yml` excludes this folder from the GitHub Pages site.
- Not covered (needs Cloudflare/WAF in front of the site): blocking IPs, DDoS and rate limiting. GitHub Pages cannot do this; put the domain behind Cloudflare to get it.
