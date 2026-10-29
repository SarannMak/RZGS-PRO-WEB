// Scheduled sweep: runs the checks, and messages the owner only when a result CHANGES
// (ok -> bad, bad -> ok, or a different problem). Quiet when nothing is new.
import { alertOwner } from './telegram.js';
import { checkSite, scanExposure, githubAlerts, supabaseAdvisors, failedLoginCount, gh } from './checks.js';

async function report(env, id, ok, msg) {
  const key = `state:${id}`;
  const prev = await env.STATE.get(key, 'json');
  const now = { ok, msg: ok ? '' : msg };
  if (!prev && ok) { await env.STATE.put(key, JSON.stringify(now)); return; }
  if (prev && prev.ok === now.ok && prev.msg === now.msg) return;
  await env.STATE.put(key, JSON.stringify(now));
  await alertOwner(env, ok ? `✅ Recovered: ${id}` : `🚨 ${id}\n${msg}`);
}

export async function sweep(env) {
  const safe = (id, fn) => fn().catch(e => report(env, id, false, `Check crashed: ${e.message}`));

  await Promise.all([
    safe('site-down', async () => {
      const s = await checkSite(env);
      await report(env, 'site-down', s.ok, `${s.url} → ${s.status ?? s.error} (${s.latency_ms ?? '?'} ms)`);
    }),
    safe('exposed-files', async () => {
      const e = await scanExposure(env);
      await report(env, 'exposed-files', e.ok, `Publicly readable sensitive paths: ${e.exposed.map(x => x.path).join(', ')}`);
    }),
    safe('github-security-alerts', async () => {
      const a = await githubAlerts(env);
      const open = Object.entries(a).filter(([, v]) => v.open > 0).map(([k, v]) => `${k}: ${v.open} open`);
      await report(env, 'github-security-alerts', open.length === 0, open.join('\n'));
    }),
    safe('supabase-advisors', async () => {
      const r = await supabaseAdvisors(env);
      if (r.error) return report(env, 'supabase-advisors', false, r.error);
      const bad = r.data.filter(l => l.level === 'ERROR');
      await report(env, 'supabase-advisors', bad.length === 0, bad.map(l => `• ${l.title}`).join('\n'));
    }),
    safe('failed-login-spike', async () => {
      const r = await failedLoginCount(env, 15);
      if (r.error) return report(env, 'failed-login-spike', false, r.error);
      const limit = parseInt(env.FAILED_LOGIN_ALERT_THRESHOLD || '25', 10);
      await report(env, 'failed-login-spike', r.data < limit, `${r.data} failed logins in 15 min (threshold ${limit}). Possible credential-stuffing.`);
    }),
    safe('new-github-issues', async () => {
      const r = await gh(env, '/issues?state=open&sort=created&direction=desc&per_page=10');
      if (r.error) return;
      const seen = new Set((await env.STATE.get('seen-issues', 'json')) || []);
      const fresh = r.data.filter(i => !i.pull_request && !seen.has(i.number));
      if (seen.size === 0) { // first run: baseline, don't spam
        await env.STATE.put('seen-issues', JSON.stringify(r.data.map(i => i.number)));
        return;
      }
      for (const i of fresh) await alertOwner(env, `🆕 Issue #${i.number}: ${i.title}\n${i.html_url}`);
      if (fresh.length) await env.STATE.put('seen-issues', JSON.stringify([...seen, ...fresh.map(i => i.number)].slice(-200)));
    }),
  ]);
}
