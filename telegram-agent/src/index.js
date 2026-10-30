/*
   RZGS-PRO guardian: a Telegram bot that watches the website, Supabase and GitHub.
   Runs as a Cloudflare Worker (webhook + cron). Read-only on purpose: it reports, it never changes anything.
   Setup: see ../README.md
*/

const SITE = 'https://rzgspro.com';
const PAGES = ['/', '/login.html', '/signup.html', '/dashboard.html'];
const SB_URL = 'https://zaziizzsbytkdlatoutv.supabase.co';
const SB_REF = 'zaziizzsbytkdlatoutv';
const REPO = 'sarannmak/rzgs-pro-web';
const WANTED_HEADERS = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy'];

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

const send = (env, chat_id, text) =>
  tg(env, 'sendMessage', { chat_id, text: text.slice(0, 4000), disable_web_page_preview: true });

// Compare secrets without leaking length/position through timing.
function safeEqual(a = '', b = '') {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const timed = async (url, init) => {
  const t = Date.now();
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...init });
  return { res, ms: Date.now() - t };
};

async function checkSite() {
  const out = [], problems = [];
  for (const p of PAGES) {
    try {
      const { res, ms } = await timed(SITE + p);
      const ok = res.status < 400;
      out.push(`${ok ? '✅' : '❌'} ${p} ${res.status} ${ms}ms`);
      if (!ok) problems.push(p);
      if (ms > 4000) problems.push(`${p} slow`);
    } catch (e) { out.push(`❌ ${p} unreachable`); problems.push(p); }
  }
  return { text: out.join('\n'), problems };
}

async function checkSecurity() {
  const out = [], problems = [];
  try {
    const { res } = await timed(SITE + '/');
    for (const h of WANTED_HEADERS) {
      const has = res.headers.has(h);
      out.push(`${has ? '✅' : '⚠️'} header ${h}`);
      if (!has) problems.push(`missing ${h}`);
    }
  } catch { out.push('❌ site unreachable'); problems.push('site unreachable'); }
  // Files that must never be public.
  for (const p of ['/.git/config', '/.env', '/package.json.bak', '/backup.sql']) {
    try {
      const { res } = await timed(SITE + p);
      if (res.status === 200) { out.push(`🚨 EXPOSED ${p}`); problems.push(`exposed ${p}`); }
    } catch {}
  }
  // Supabase security advisors (RLS off, exposed views, ...). Needs a Management API token.
  if (globalThis.__env?.SUPABASE_ACCESS_TOKEN) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/advisors/security`, {
        headers: { authorization: `Bearer ${globalThis.__env.SUPABASE_ACCESS_TOKEN}` },
      });
      const j = await r.json();
      const lints = (j.lints || []).filter((l) => l.level === 'ERROR' || l.level === 'WARN');
      out.push(`${lints.length ? '⚠️' : '✅'} Supabase advisors: ${lints.length} issue(s)`);
      lints.slice(0, 5).forEach((l) => { out.push(`   • [${l.level}] ${l.title}`); });
      if (lints.some((l) => l.level === 'ERROR')) problems.push('supabase advisor ERROR');
    } catch { out.push('⚠️ could not read Supabase advisors'); }
  }
  return { text: out.join('\n'), problems };
}

async function checkDatabase(env) {
  try {
    const { res, ms } = await timed(`${SB_URL}/auth/v1/health`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY || '' } });
    const ok = res.status === 200;
    return { text: `${ok ? '✅' : '❌'} Supabase auth ${res.status} ${ms}ms`, problems: ok ? [] : ['supabase auth down'] };
  } catch { return { text: '❌ Supabase unreachable', problems: ['supabase unreachable'] }; }
}

async function gh(env, path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, 'user-agent': 'rzgs-guardian', accept: 'application/vnd.github+json' },
  });
  return r.ok ? r.json() : null;
}

async function checkGithub(env) {
  if (!env.GITHUB_TOKEN) return { text: '⚠️ GITHUB_TOKEN not set', problems: [] };
  const [issues, dep, secrets] = await Promise.all([
    gh(env, '/issues?state=open&per_page=10'),
    gh(env, '/dependabot/alerts?state=open&per_page=10'),
    gh(env, '/secret-scanning/alerts?state=open&per_page=10'),
  ]);
  const prs = (issues || []).filter((i) => !i.pull_request);
  const problems = [];
  const lines = [`${prs.length ? '📌' : '✅'} open issues: ${issues ? prs.length : '?'}`];
  prs.slice(0, 5).forEach((i) => lines.push(`   • #${i.number} ${i.title}`));
  if (dep?.length) { lines.push(`⚠️ dependabot alerts: ${dep.length}`); problems.push('dependabot alerts'); }
  if (secrets?.length) { lines.push(`🚨 leaked secrets: ${secrets.length}`); problems.push('leaked secrets'); }
  return { text: lines.join('\n'), problems };
}

const CHECKS = {
  site: checkSite, security: checkSecurity, db: checkDatabase, issues: checkGithub,
};

async function runAll(env) {
  globalThis.__env = env;
  const parts = [], problems = [];
  for (const [name, fn] of Object.entries(CHECKS)) {
    const r = await fn(env);
    parts.push(`— ${name} —\n${r.text}`);
    problems.push(...r.problems);
  }
  return { text: parts.join('\n\n'), problems };
}

const HELP = `RZGS-PRO guardian
/status – run every check
/site – uptime and speed
/security – headers, exposed files, Supabase advisors
/db – database/auth health
/issues – GitHub issues and alerts
/chatid – show your chat id`;

async function handleMessage(env, msg) {
  const chat = msg.chat.id;
  const cmd = (msg.text || '').split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/chatid') return send(env, chat, String(chat)); // works before the owner id is configured
  // Everyone except the owner is ignored silently, so strangers learn nothing.
  if (String(msg.from?.id) !== env.OWNER_ID || String(chat) !== env.OWNER_ID) return;
  globalThis.__env = env;
  if (cmd === '/status') return send(env, chat, (await runAll(env)).text);
  if (CHECKS[cmd.slice(1)]) return send(env, chat, (await CHECKS[cmd.slice(1)](env)).text);
  return send(env, chat, HELP);
}

export default {
  // Telegram webhook
  async fetch(req, env, ctx) {
    if (req.method !== 'POST') return new Response('ok');
    if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') || '', env.WEBHOOK_SECRET || '')) {
      return new Response('forbidden', { status: 403 });
    }
    const update = await req.json().catch(() => null);
    if (update?.message) ctx.waitUntil(handleMessage(env, update.message).catch(() => {}));
    return new Response('ok');
  },
  // Cron: alert the owner only when something is wrong.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const { text, problems } = await runAll(env);
      if (problems.length) await send(env, env.OWNER_ID, `🚨 ${problems.length} problem(s): ${problems.join(', ')}\n\n${text}`);
    })());
  },
};
