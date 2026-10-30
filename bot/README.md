# RZGS Guardian: Telegram security agent (Cloudflare Worker)

Read-only agent that watches rzgspro.com, the GitHub repo and the Supabase project, and answers you on Telegram.

## What it does
- `/status` uptime, HTTPS redirect, security headers, accidentally exposed files (`.env`, `.git`, …)
- `/issues` open issues/PRs, secret-scanning, Dependabot and code-scanning alerts
- `/db` Supabase security advisories (RLS gaps etc.)
- `/activity` recent commits and failed auth events
- `/security` all of the above; `/ask <question>` lets Claude pick the tools and explain
- Hourly cron: pings you only when the site goes down/recovers or a secret leaks; daily digest at 01:00 UTC

## Safety model
- Telegram webhook secret is verified (constant-time); wrong secret gets 403.
- Only your numeric chat ID is answered; everyone else is silently ignored (and logged to KV).
- 20 messages/min cap so a leaked bot token cannot run up your Anthropic bill.
- No write tools at all. The agent is told to treat issue titles/logs/commit text as data, not instructions.
- Secrets live only in Worker secrets, never in git.

## Deploy (when you have created the bot with @BotFather)
```bash
cd bot
npm i -g wrangler && wrangler login
wrangler kv namespace create STATE        # paste the id into wrangler.toml
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string (A-Z a-z 0-9 _ -)
wrangler secret put OWNER_CHAT_ID             # message @userinfobot to get yours
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GITHUB_TOKEN              # fine-grained PAT, read-only: Issues, Metadata, Secret scanning, Dependabot, Code scanning alerts
wrangler secret put SUPABASE_ACCESS_TOKEN     # Supabase personal access token
wrangler deploy
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://rzgs-guardian.<you>.workers.dev/webhook -d secret_token=<WEBHOOK_SECRET>
```

## Honest limits
- The Supabase access token is account-wide (Supabase has no read-only PATs yet). Keep it as a Worker secret only, and rotate it if anything looks off.
- GitHub Pages cannot set security headers; the bot will keep flagging them until you put Cloudflare (or similar) in front of the site.
- The bot reports; it does not block attackers. Real blocking (WAF, rate limits) belongs in Cloudflare/Supabase settings.
- Supabase advisor/log endpoints are best-effort; if the API changes the bot shows the HTTP error instead of failing.
