// All settings come from edge-function secrets. Nothing is hard-coded.
function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret: ${name}`);
  return v;
}
const opt = (name: string, fallback = '') => Deno.env.get(name) ?? fallback;

export const cfg = {
  botToken: () => need('TELEGRAM_BOT_TOKEN'),
  webhookSecret: () => need('TELEGRAM_WEBHOOK_SECRET'),
  ownerId: () => Number(need('TELEGRAM_OWNER_ID')), // your numeric Telegram user id
  monitorSecret: () => need('MONITOR_SECRET'),
  supabaseUrl: () => need('SUPABASE_URL'),
  serviceKey: () => need('SUPABASE_SERVICE_ROLE_KEY'),
  projectRef: () => opt('SUPABASE_PROJECT_REF', new URL(need('SUPABASE_URL')).hostname.split('.')[0]),
  mgmtToken: () => opt('SUPABASE_ACCESS_TOKEN'), // optional: enables SQL audit + auth logs
  githubToken: () => opt('GITHUB_TOKEN'), // optional: issues / PRs / security alerts
  githubRepo: () => opt('GITHUB_REPO', 'SarannMak/RZGS-PRO-WEB'),
  siteUrl: () => opt('SITE_URL', 'https://rzgspro.com'),
  anthropicKey: () => opt('ANTHROPIC_API_KEY'), // optional: enables free-text chat
  model: () => opt('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
};
