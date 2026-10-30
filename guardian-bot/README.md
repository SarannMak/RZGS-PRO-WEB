# RZGS Guardian: Telegram watchdog (Cloudflare Worker)

Read-only bot that answers only you. It checks site uptime and security headers, Supabase security
advisors, GitHub issues/alerts, and auth-error spikes. A cron runs every 15 minutes and messages you
only when something is wrong or changed.

## Why read-only
The bot never gets your database password, service_role key, or write tokens. If its Telegram token leaks,
an attacker can read status summaries at worst. Fixes stay with you.

## Setup
1. Telegram: message @BotFather, `/newbot`, copy the token. Get your numeric id from @userinfobot.
2. `cd guardian-bot && npm i -g wrangler && wrangler login`
3. `wrangler kv namespace create STATE`, then paste the id into `wrangler.toml`.
4. Secrets (`wrangler secret put NAME`):
   - `TG_TOKEN`: from BotFather
   - `TG_WEBHOOK_SECRET`: any long random string (`openssl rand -hex 32`)
   - `OWNER_CHAT_ID`: your numeric Telegram id
   - `SUPABASE_TOKEN`: a Supabase personal access token (account > Access Tokens). It is account-wide,
     so use a dedicated account/org with read access if you can.
   - `GITHUB_TOKEN`: fine-grained token, this repo only, read-only: Issues, Dependabot alerts,
     Code scanning alerts, Secret scanning alerts, Metadata.
5. `wrangler deploy`
6. Register the webhook:
   `curl "https://api.telegram.org/bot<TG_TOKEN>/setWebhook" -d url=https://<worker>.workers.dev -d secret_token=<TG_WEBHOOK_SECRET>`

## Commands
`/status` `/security` `/issues` `/activity` `/all` `/help`

## Open findings from today's Supabase advisor run (30 Oct 2026)
- 14 `SECURITY DEFINER` functions are callable by `anon` (`app_login`, `app_command`, `bot_sync`,
  `web_bot_*`, ...). Fine if each checks its token/key internally; worth reviewing, especially `bot_sync`
  and `web_bot_set_plan` (plan changes), and revoke `EXECUTE` from `anon` where not needed.
- `app_change_password` and `bot_sync` have a mutable `search_path`: add `set search_path = ''`.
- Leaked-password protection is off: enable it in Auth settings.
- `pg_net` is in `public`: move it to the `extensions` schema.
- 9 tables have RLS on and no policies (deny-all to clients): fine if only functions touch them.

## Not done yet
The site is on GitHub Pages, which can't set security headers. Putting Cloudflare in front of
rzgspro.com lets you add HSTS/CSP and a WAF. The bot will report the missing headers until then.
