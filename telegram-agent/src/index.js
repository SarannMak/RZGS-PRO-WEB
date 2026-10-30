import { runAgent } from './agent.js';
import { impl } from './tools.js';
import { sendMessage, sendTyping, safeEqual } from './telegram.js';

const HISTORY_TURNS = 8;
const RATE_PER_MINUTE = 10;

async function audit(env, entry) {
  // Rolling log of who talked to the bot (kept 7 days) so probing is visible via /audit.
  const key = `audit:${Date.now()}`;
  await env.STATE.put(key, JSON.stringify(entry), { expirationTtl: 7 * 86400 });
}

async function rateLimited(env, chatId) {
  const key = `rate:${chatId}:${Math.floor(Date.now() / 60000)}`;
  const n = Number(await env.STATE.get(key)) + 1 || 1;
  await env.STATE.put(key, String(n), { expirationTtl: 120 });
  return n > RATE_PER_MINUTE;
}

async function handleMessage(env, msg) {
  const chatId = String(msg.chat?.id);
  const text = (msg.text || '').trim();

  // Only the owner gets any response at all. Strangers get silence (no confirmation the bot exists).
  if (!safeEqual(chatId, env.OWNER_CHAT_ID) || msg.chat?.type !== 'private') {
    await audit(env, { t: new Date().toISOString(), blocked: true, from: msg.from?.id, username: msg.from?.username });
    return;
  }
  if (!text) return;
  if (await rateLimited(env, chatId)) return sendMessage(env, chatId, 'Slow down: rate limit reached, try again in a minute.');

  if (text === '/start' || text === '/help') {
    return sendMessage(env, chatId, 'Guardian online. Ask me anything about the site, database, GitHub or security.\n\n/status  full health + security sweep\n/audit  blocked intruders who messaged this bot\n/reset  forget conversation');
  }
  if (text === '/reset') { await env.STATE.delete(`hist:${chatId}`); return sendMessage(env, chatId, 'Conversation cleared.'); }
  if (text === '/audit') {
    const list = await env.STATE.list({ prefix: 'audit:', limit: 20 });
    const rows = await Promise.all(list.keys.map((k) => env.STATE.get(k.name)));
    return sendMessage(env, chatId, rows.length ? 'Blocked contacts (7d):\n' + rows.join('\n') : 'No unknown users have contacted the bot.');
  }

  await sendTyping(env, chatId);
  const prompt = text === '/status'
    ? 'Run a full sweep now: website check, Supabase RLS audit, auth activity (24h), GitHub security alerts, open issues and recent commits. Give a verdict and actions.'
    : text;
  const history = JSON.parse((await env.STATE.get(`hist:${chatId}`)) || '[]');
  let reply;
  try {
    reply = await runAgent(env, history, prompt);
  } catch (e) {
    reply = `Agent error: ${e.message}`;
  }
  history.push({ role: 'user', content: prompt }, { role: 'assistant', content: reply });
  await env.STATE.put(`hist:${chatId}`, JSON.stringify(history.slice(-HISTORY_TURNS * 2)), { expirationTtl: 86400 });
  await sendMessage(env, chatId, reply);
}

// Cheap deterministic sweep (no LLM cost). Pings the owner only on problems, and only once per distinct problem set.
async function scheduledSweep(env) {
  const problems = [];
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { problems.push(`${label} check failed: ${e.message}`); } };

  const site = await safe('Website', () => impl.check_website(env));
  if (site) {
    if (site.status >= 400 || site.status === 0) problems.push(`Website returned HTTP ${site.status}`);
    if (site.latency_ms > 5000) problems.push(`Website slow: ${site.latency_ms}ms`);
    const prev = await env.STATE.get('site:hash');
    if (prev && prev !== site.content_hash) problems.push('Homepage content changed since last sweep (expected after a deploy; otherwise possible defacement)');
    await env.STATE.put('site:hash', site.content_hash);
    const known = JSON.parse((await env.STATE.get('site:scripts')) || 'null');
    const newHosts = known ? site.external_script_hosts.filter((h) => !known.includes(h)) : [];
    if (newHosts.length) problems.push(`New third-party script host(s) on homepage: ${newHosts.join(', ')}`);
    await env.STATE.put('site:scripts', JSON.stringify(site.external_script_hosts));
  }

  if (env.SUPABASE_ACCESS_TOKEN) {
    const rls = await safe('Supabase RLS', () => impl.supabase_rls_audit(env));
    if (rls?.tables_without_rls.length) problems.push(`RLS OFF on: ${rls.tables_without_rls.join(', ')}`);
    if (rls?.anon_policies_allowing_everything.length) problems.push(`Anonymous users have wide-open policy on: ${rls.anon_policies_allowing_everything.map((p) => p.tablename).join(', ')}`);
    const auth = await safe('Supabase auth', () => impl.supabase_auth_activity(env, { hours: 1 }));
    if (auth && Number(auth.signups.last_hour) > 50) problems.push(`Signup spike: ${auth.signups.last_hour} accounts in the last hour (bot signups?)`);
    const bad = auth?.noisiest_ips_failed_or_repeated_auth.find((r) => Number(r.hits) >= 20);
    if (bad) problems.push(`Possible brute force: one IP made ${bad.hits} failed/repeated auth attempts in the last hour`);
  }

  if (env.GITHUB_TOKEN) {
    const alerts = await safe('GitHub alerts', () => impl.github_security_alerts(env));
    if (alerts?.secret_scanning?.length) problems.push(`${alerts.secret_scanning.length} open SECRET LEAK alert(s) on GitHub: rotate those keys now`);
    const crit = (alerts?.dependabot || []).filter?.((a) => ['critical', 'high'].includes(a.severity));
    if (crit?.length) problems.push(`${crit.length} high/critical Dependabot alert(s)`);
  }

  const fingerprint = problems.join('|');
  const last = await env.STATE.get('sweep:last');
  if (!problems.length) { await env.STATE.delete('sweep:last'); return; }
  if (fingerprint === last) return; // already told the owner
  await env.STATE.put('sweep:last', fingerprint);
  await sendMessage(env, env.OWNER_CHAT_ID, '🚨 Guardian alert\n- ' + problems.join('\n- ') + '\n\nReply "investigate" for details.');
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('ok');
    // Telegram echoes our secret in this header; anything else is not Telegram.
    if (!safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response('forbidden', { status: 403 });
    }
    const update = await request.json().catch(() => null);
    if (update?.message) ctx.waitUntil(handleMessage(env, update.message).catch(() => {}));
    return new Response('ok');
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduledSweep(env).catch(() => {}));
  },
};
