/* RZGS-PRO Guardian: a read-only Telegram watchdog on Cloudflare Workers.
   Commands: /status /security /issues /activity /help
   Cron: every 15 min, alerts the owner only when something is wrong or new.
   Secrets (wrangler secret put): TG_TOKEN, TG_WEBHOOK_SECRET, OWNER_CHAT_ID,
   SUPABASE_TOKEN (read-only management token), GITHUB_TOKEN (read-only). */

const REQUIRED_HEADERS = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy'];
const PAGES = ['/', '/login.html', '/signup.html', '/dashboard.html'];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function tg(env, chat, text) {
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}

// ---- checks: each returns { lines: string[], problems: string[] } ----

async function checkSite(env) {
  const lines = [], problems = [];
  for (const p of PAGES) {
    const t0 = Date.now();
    try {
      const r = await fetch(env.SITE_URL + p, { redirect: 'manual', cf: { cacheTtl: 0 } });
      const ms = Date.now() - t0;
      const ok = r.status === 200;
      lines.push(`${ok ? '✅' : '❌'} ${p} ${r.status} ${ms}ms`);
      if (!ok) problems.push(`${p} returned ${r.status}`);
      if (p === '/') {
        const missing = REQUIRED_HEADERS.filter((h) => !r.headers.has(h));
        if (missing.length) lines.push(`⚠️ missing headers: ${missing.join(', ')}`);
      }
    } catch (e) {
      lines.push(`❌ ${p} unreachable`);
      problems.push(`${p} unreachable`);
    }
  }
  return { lines, problems };
}

async function supabaseApi(env, path) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_REF}${path}`, {
    headers: { authorization: `Bearer ${env.SUPABASE_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Supabase API ${r.status}`);
  return r.json();
}

async function checkSecurity(env) {
  const data = await supabaseApi(env, '/advisors/security');
  const lints = (data.lints || []).filter((l) => l.level === 'ERROR' || l.level === 'WARN');
  const keys = lints.map((l) => `${l.name}:${l.count ?? ''}`);
  const lines = lints.length
    ? lints.map((l) => `${l.level === 'ERROR' ? '🔴' : '🟠'} ${esc(l.title)} (${l.count ?? 1})`)
    : ['✅ no security warnings'];
  return { lines, keys, problems: lints.filter((l) => l.level === 'ERROR').map((l) => l.title) };
}

async function gh(env, path) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, 'user-agent': 'rzgs-guardian', accept: 'application/vnd.github+json' },
  });
  return r.ok ? r.json() : null; // alert endpoints 404 when the feature is off
}

async function checkIssues(env) {
  const [issues, dep, code, secrets] = await Promise.all([
    gh(env, '/issues?state=open&per_page=10'),
    gh(env, '/dependabot/alerts?state=open&per_page=10'),
    gh(env, '/code-scanning/alerts?state=open&per_page=10'),
    gh(env, '/secret-scanning/alerts?state=open&per_page=10'),
  ]);
  const real = (issues || []).filter((i) => !i.pull_request);
  const lines = [`📋 open issues: ${real.length}`, ...real.slice(0, 5).map((i) => `• #${i.number} ${esc(i.title)}`)];
  const problems = [];
  for (const [name, list] of [['Dependabot', dep], ['Code scanning', code], ['Secret scanning', secrets]]) {
    if (list === null) lines.push(`ℹ️ ${name}: not enabled`);
    else if (list.length) { lines.push(`🔴 ${name}: ${list.length} open alert(s)`); problems.push(`${name}: ${list.length} open`); }
    else lines.push(`✅ ${name}: clean`);
  }
  return { lines, problems };
}

async function checkActivity(env) {
  // Auth log: failed sign-ins in the last hour, grouped by error. No user data returned.
  const sql = `select count(*) as n, coalesce(metadata[1].error_code,'?') as code
    from auth_logs cross join unnest(metadata) as metadata
    where metadata.level = 'error' group by 2 order by 1 desc limit 8`;
  const now = new Date(), from = new Date(now - 3600e3);
  const q = new URLSearchParams({ sql, iso_timestamp_start: from.toISOString(), iso_timestamp_end: now.toISOString() });
  const data = await supabaseApi(env, `/analytics/endpoints/logs.all?${q}`);
  const rows = data.result || [];
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  return {
    lines: rows.length ? [`🔐 auth errors, last hour: ${total}`, ...rows.map((r) => `• ${esc(r.code)}: ${r.n}`)] : ['✅ no auth errors in the last hour'],
    problems: total >= 50 ? [`${total} auth errors in 1h (possible brute force)`] : [],
  };
}

// ---- Telegram webhook ----

const HELP = '<b>RZGS Guardian</b> (read-only)\n/status site uptime + headers\n/security database advisors\n/issues GitHub issues and alerts\n/activity auth errors, last hour\n/all everything';
const COMMANDS = { '/status': [checkSite], '/security': [checkSecurity], '/issues': [checkIssues], '/activity': [checkActivity], '/all': [checkSite, checkSecurity, checkIssues, checkActivity] };

async function handleUpdate(env, update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  // Owner-only: strangers get no reply at all, so the bot looks dead to them.
  if (String(msg.chat.id) !== String(env.OWNER_CHAT_ID) || String(msg.from?.id) !== String(env.OWNER_CHAT_ID)) return;
  const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
  const checks = COMMANDS[cmd];
  if (!checks) return tg(env, msg.chat.id, HELP);
  const out = [];
  for (const c of checks) {
    try { out.push((await c(env)).lines.join('\n')); } catch (e) { out.push(`⚠️ ${c.name} failed: ${esc(e.message)}`); }
  }
  await tg(env, msg.chat.id, out.join('\n\n'));
}

// ---- cron watchdog: alert on problems, and on new advisor findings; stay silent otherwise ----

async function watchdog(env) {
  const alerts = [];
  const site = await checkSite(env);
  alerts.push(...site.problems);
  try {
    const sec = await checkSecurity(env);
    const seen = (await env.STATE.get('advisors')) || '';
    const now = sec.keys.sort().join('|');
    if (seen && now !== seen) alerts.push('Security advisors changed:\n' + sec.lines.join('\n'));
    await env.STATE.put('advisors', now);
    alerts.push(...sec.problems);
  } catch (e) { alerts.push(`Supabase check failed: ${e.message}`); }
  for (const c of [checkActivity, checkIssues]) {
    try { alerts.push(...(await c(env)).problems); } catch (e) { /* non-critical */ }
  }
  if (!alerts.length) { await env.STATE.delete('lastAlert'); return; }
  const body = alerts.join('\n');
  if ((await env.STATE.get('lastAlert')) === body) return; // don't repeat the same alert every 15 min
  await env.STATE.put('lastAlert', body, { expirationTtl: 6 * 3600 });
  await tg(env, env.OWNER_CHAT_ID, '🚨 <b>RZGS Guardian</b>\n' + esc(body));
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST' || req.headers.get('x-telegram-bot-api-secret-token') !== env.TG_WEBHOOK_SECRET) {
      return new Response('Not found', { status: 404 });
    }
    await handleUpdate(env, await req.json());
    return new Response('ok');
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(watchdog(env)); },
};
