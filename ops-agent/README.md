# RZGS-PRO ops agent

A read-only Telegram bot that watches rzgspro.com, the GitHub repo and the Supabase project.
It answers only you, and it messages you on its own when something turns red.

Commands: `/status` `/site` `/security` `/issues` `/activity` `/db` `/help`

## What it checks
- **Site:** uptime and speed of the main pages, HTTP→HTTPS redirect, unknown third-party scripts, leaked secrets (Supabase secret/service_role keys, Telegram, GitHub tokens, private keys), missing security headers.
- **GitHub:** open issues, secret-scanning alerts, vulnerable dependencies, latest commits.
- **Supabase:** tables without row-level security, security advisor, failed sign-ins and new sign-ups in 24 h (password-guessing and bot sign-up signals).

## Security design
- Owner-only: chat id **and** sender id must be in `OWNER_CHAT_IDS`. Strangers get no reply.
- Telegram requests must carry `WEBHOOK_SECRET`; the cron endpoint needs `CRON_SECRET`. Both compared in constant time.
- Read-only everywhere: Supabase queries run with `read_only: true`; GitHub token has read scopes only.
- Secrets live in environment variables, never in the repo and never in replies.
- 20 commands/minute limit per chat.

## Setup (about 10 minutes)
1. In Telegram, message @BotFather → `/newbot`. Keep the token. Message @userinfobot to get your numeric id.
2. Create tokens:
   - GitHub: fine-grained token, only this repo, read-only for Issues, Contents, Metadata, Secret scanning alerts, Dependabot alerts.
   - Supabase: Account → Access Tokens → new token.
3. Deploy as a Supabase Edge Function (needs the Supabase CLI):
   ```
   mkdir -p supabase/functions/ops-agent && cp ops-agent/agent.ts supabase/functions/ops-agent/index.ts
   supabase secrets set TELEGRAM_BOT_TOKEN=... WEBHOOK_SECRET=$(openssl rand -hex 24) CRON_SECRET=$(openssl rand -hex 24) \
     OWNER_CHAT_IDS=<your id> GITHUB_TOKEN=... SUPABASE_ACCESS_TOKEN=...
   supabase functions deploy ops-agent --no-verify-jwt --project-ref zaziizzsbytkdlatoutv
   ```
   (`--no-verify-jwt` is needed because Telegram can't send a Supabase JWT; the secrets above protect it instead.)
   The same file also runs as a Cloudflare Worker (`export default`) or on Bun.
4. Point Telegram at it:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/ops-agent \
     -d secret_token=<WEBHOOK_SECRET>
   ```
5. Alerts: schedule a POST every 15 minutes to `.../ops-agent/cron` with header `Authorization: Bearer <CRON_SECRET>` (Supabase pg_cron + pg_net, cron-job.org, or a Cloudflare cron trigger). Quiet when all is well; it messages you only for red findings.

## Honest limits
- It watches and warns; it cannot block attackers by itself. For real blocking, put the site behind Cloudflare (free): WAF, bot protection, and the security headers GitHub Pages cannot set.
- Never give it your Supabase `service_role` key or database password; it doesn't need them.
- Rotate any token it reports as leaked immediately.
