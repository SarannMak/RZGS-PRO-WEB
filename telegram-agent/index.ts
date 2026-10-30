// RZGS Guardian: a Telegram bot that watches rzgspro.com, its Supabase project and its GitHub repo.
// Runs as a Supabase Edge Function (Deno). Read-only: it reports, it never changes anything.
//
// Two entry points:
//   POST  /  Telegram webhook (commands from you)
//   GET   /?cron=1  scheduled digest, called by pg_cron / any scheduler, sends a message only if something is wrong

const env = (k: string, required = true) => {
  const v = Deno.env.get(k);
  if (!v && required) throw new Error(`Missing secret ${k}`);
  return v ?? '';
};

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET'); // sent by Telegram in X-Telegram-Bot-Api-Secret-Token
const CRON_SECRET = env('CRON_SECRET');
const OWNER_IDS = env('OWNER_TELEGRAM_IDS').split(',').map((s) => s.trim()).filter(Boolean); // numeric user ids
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rzgspro.com';
const SB_REF = env('SUPABASE_PROJECT_REF');
const SB_MGMT_TOKEN = env('SUPABASE_MGMT_TOKEN', false); // personal access token, see README
const GH_REPO = Deno.env.get('GITHUB_REPO') ?? 'SarannMak/RZGS-PRO-WEB';
const GH_TOKEN = env('GITHUB_TOKEN', false); // fine-grained, read-only

// ---------- helpers ----------

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function send(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

const sb = (path: string) =>
  getJson(`https://api.supabase.com/v1/projects/${SB_REF}${path}`, { authorization: `Bearer ${SB_MGMT_TOKEN}` });
const gh = (path: string) =>
  getJson(`https://api.github.com/repos/${GH_REPO}${path}`, {
    authorization: `Bearer ${GH_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'rzgs-guardian',
  });

// Each check returns { ok, lines }. A failing source never takes the others down.
type Report = { ok: boolean; lines: string[] };
const guard = async (name: string, fn: () => Promise<Report>): Promise<Report> => {
  try { return await fn(); } catch (e) { return { ok: false, lines: [`⚠️ ${name} check failed: ${esc((e as Error).message)}`] }; }
};

// ---------- checks ----------

const WANTED_HEADERS = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy'];

const checkSite = () => guard('Site', async () => {
  const lines: string[] = []; let ok = true;
  const t0 = performance.now();
  const r = await fetch(SITE_URL, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const ms = Math.round(performance.now() - t0);
  if (r.status >= 400) ok = false;
  lines.push(`${r.status < 400 ? '🟢' : '🔴'} ${esc(SITE_URL)} → ${r.status} in ${ms} ms`);
  if (ms > 3000) { ok = false; lines.push('🟠 slow response'); }
  const http = await fetch(SITE_URL.replace('https:', 'http:'), { redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (http && http.status < 300) { ok = false; lines.push('🟠 plain HTTP is served without redirecting to HTTPS'); }
  const missing = WANTED_HEADERS.filter((h) => !r.headers.has(h));
  // GitHub Pages cannot set custom headers, so this is informational, not an alert.
  if (missing.length) lines.push(`ℹ️ missing headers: ${missing.join(', ')} (put Cloudflare in front to add them)`);
  return { ok, lines };
});

const checkSupabase = () => guard('Supabase', async () => {
  if (!SB_MGMT_TOKEN) return { ok: true, lines: ['ℹ️ Supabase checks off (no SUPABASE_MGMT_TOKEN)'] };
  const lines: string[] = []; let ok = true;
  const adv = await sb('/advisors/security');
  const found = (adv.lints ?? adv ?? []) as Array<{ level?: string; title?: string; name?: string }>;
  const bad = found.filter((l) => l.level === 'ERROR' || l.level === 'WARN');
  if (bad.length) ok = false;
  lines.push(`${bad.length ? '🔴' : '🟢'} Supabase security advisors: ${bad.length} issue(s)`);
  for (const l of bad.slice(0, 8)) lines.push(`   • [${esc(l.level)}] ${esc(l.title ?? l.name)}`);
  return { ok, lines };
});

const checkAuthActivity = () => guard('Auth activity', async () => {
  if (!SB_MGMT_TOKEN) return { ok: true, lines: [] };
  const sql = `select count(*) as n from auth_logs cross join unnest(metadata) as m
    where event_message like '%invalid%' or event_message like '%failed%'`;
  const res = await sb(`/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`);
  const n = Number(res?.result?.[0]?.n ?? 0);
  const ok = n < 20;
  return { ok, lines: [`${ok ? '🟢' : '🔴'} failed/invalid auth events (last 24h): ${n}${ok ? '' : ' — possible brute force'}`] };
});

const checkGithub = () => guard('GitHub', async () => {
  if (!GH_TOKEN) return { ok: true, lines: ['ℹ️ GitHub checks off (no GITHUB_TOKEN)'] };
  const lines: string[] = []; let ok = true;
  const issues = (await gh('/issues?state=open&per_page=10')).filter((i: { pull_request?: unknown }) => !i.pull_request);
  lines.push(`📋 open issues: ${issues.length}`);
  for (const i of issues.slice(0, 5)) lines.push(`   • #${i.number} ${esc(i.title)}`);
  for (const [label, path] of [['secret-scanning', '/secret-scanning/alerts'], ['dependabot', '/dependabot/alerts'], ['code-scanning', '/code-scanning/alerts']] as const) {
    try {
      const a = await gh(`${path}?state=open&per_page=50`);
      if (a.length) ok = false;
      lines.push(`${a.length ? '🔴' : '🟢'} ${label} alerts: ${a.length}`);
    } catch { lines.push(`ℹ️ ${label}: not enabled or no access`); }
  }
  const commits = await gh('/commits?per_page=3');
  lines.push('🕒 latest commits:');
  for (const c of commits) lines.push(`   • ${esc(c.commit.message.split('\n')[0])} (${esc(c.commit.author.name)})`);
  return { ok, lines };
});

const all = async () => [await checkSite(), await checkSupabase(), await checkAuthActivity(), await checkGithub()];
const render = (title: string, rs: Report[]) => `<b>${esc(title)}</b>\n` + rs.flatMap((r) => r.lines).join('\n');

// ---------- commands ----------

const HELP = `<b>RZGS Guardian</b> (read-only)
/status – everything at a glance
/site – uptime, speed, HTTPS
/security – Supabase advisors, GitHub alerts
/activity – failed logins, recent commits
/issues – open GitHub issues
/id – show your Telegram id`;

async function handle(cmd: string): Promise<string> {
  switch (cmd) {
    case '/start': case '/help': return HELP;
    case '/status': return render('Status', await all());
    case '/site': return render('Site', [await checkSite()]);
    case '/security': return render('Security', [await checkSupabase(), await checkGithub()]);
    case '/activity': return render('Activity', [await checkAuthActivity(), await checkGithub()]);
    case '/issues': return render('Issues', [await checkGithub()]);
    default: return 'Unknown command. Try /help';
  }
}

// ---------- server ----------

const lastSeen = new Map<string, number>(); // crude per-user rate limit (resets on cold start)

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Scheduled digest: silent unless a check fails.
  if (req.method === 'GET' && url.searchParams.get('cron') === '1') {
    if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return new Response('forbidden', { status: 403 });
    const rs = await all();
    if (rs.some((r) => !r.ok)) for (const id of OWNER_IDS) await send(id, render('🚨 Alert', rs));
    return new Response('ok');
  }

  if (req.method !== 'POST') return new Response('not found', { status: 404 });
  // Reject anything that is not Telegram before reading the body.
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', WEBHOOK_SECRET)) {
    return new Response('forbidden', { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text || !msg.from) return new Response('ok');

  const uid = String(msg.from.id);
  if (!OWNER_IDS.includes(uid) || msg.chat.type !== 'private') {
    // Strangers get no reply, so the bot is invisible to them. You do get told.
    for (const id of OWNER_IDS) await send(id, `🚫 Blocked message from id ${esc(uid)} (@${esc(msg.from.username ?? '?')})`);
    return new Response('ok');
  }
  if (msg.text.startsWith('/id')) { await send(msg.chat.id, `Your id: <code>${esc(uid)}</code>`); return new Response('ok'); }

  const now = Date.now();
  if (now - (lastSeen.get(uid) ?? 0) < 1500) return new Response('ok');
  lastSeen.set(uid, now);

  const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();
  try { await send(msg.chat.id, await handle(cmd)); }
  catch (e) { await send(msg.chat.id, `⚠️ ${esc((e as Error).message)}`); }
  return new Response('ok');
});
