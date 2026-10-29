// Plain, deterministic checks. Used by both the cron sweep and the agent's tools.
import { hostAllowed } from './guard.js';

const WANTED_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'];
const SENSITIVE_PATHS = ['/.env', '/.git/config', '/.git/HEAD', '/.DS_Store', '/config.json', '/backup.zip', '/db.sql', '/package.json', '/wp-config.php'];

const primaryHost = env => String(env.SITE_HOSTS).split(',')[0].trim();

export async function checkSite(env, url) {
  const target = url || `https://${primaryHost(env)}/`;
  if (!hostAllowed(env, target)) return { ok: false, error: 'URL host is not in SITE_HOSTS' };
  const t0 = Date.now();
  try {
    const r = await fetch(target, { redirect: 'manual', headers: { 'user-agent': 'rzgs-guardian/1.0' } });
    const ms = Date.now() - t0;
    const h = Object.fromEntries(r.headers);
    return {
      ok: r.status >= 200 && r.status < 400 && ms < 5000,
      url: target, status: r.status, latency_ms: ms,
      missing_security_headers: WANTED_HEADERS.filter(k => !h[k]),
      server: h.server || null,
    };
  } catch (e) {
    return { ok: false, url: target, error: String(e.message || e) };
  }
}

// Looks for files that must never be public. GitHub Pages answers unknown paths with a 404,
// so any 200 that isn't the site's HTML is suspicious.
export async function scanExposure(env) {
  const host = primaryHost(env);
  const found = [];
  await Promise.all(SENSITIVE_PATHS.map(async p => {
    try {
      const r = await fetch(`https://${host}${p}`, { redirect: 'manual' });
      if (r.status !== 200) return;
      const ct = r.headers.get('content-type') || '';
      const body = (await r.text()).slice(0, 300);
      if (!/text\/html/.test(ct) || /\[core\]|DB_PASSWORD|SECRET|API_KEY/i.test(body)) found.push({ path: p, status: 200, content_type: ct });
    } catch { /* unreachable path is fine */ }
  }));
  return { ok: found.length === 0, exposed: found };
}

async function gh(env, path) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'rzgs-guardian',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!r.ok) return { error: `GitHub ${r.status}`, status: r.status };
  return { data: await r.json() };
}
export { gh };

export async function githubAlerts(env) {
  const out = {};
  for (const [name, path] of [['secret_scanning', '/secret-scanning/alerts?state=open'], ['dependabot', '/dependabot/alerts?state=open'], ['code_scanning', '/code-scanning/alerts?state=open']]) {
    const r = await gh(env, path);
    // 404/403 = feature disabled or token lacks scope: report it instead of pretending all is well.
    out[name] = r.error ? { unavailable: r.error } : { open: r.data.length, items: r.data.slice(0, 10).map(a => ({ number: a.number, severity: a.security_advisory?.severity || a.rule?.security_severity_level || null, what: a.secret_type_display_name || a.security_advisory?.summary || a.rule?.description || null, url: a.html_url })) };
  }
  return out;
}

export async function supabaseApi(env, path, init = {}) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) return { error: `Supabase ${r.status}: ${text.slice(0, 300)}` };
  try { return { data: JSON.parse(text) }; } catch { return { data: text }; }
}

export async function supabaseAdvisors(env) {
  const r = await supabaseApi(env, '/advisors/security');
  if (r.error) return r;
  const lints = r.data?.lints || r.data || [];
  return { data: lints.map(l => ({ name: l.name, level: l.level, title: l.title, detail: l.detail, remediation: l.remediation })).slice(0, 30) };
}

const LOG_SOURCES = {
  auth: 'select timestamp, event_message from auth_logs order by timestamp desc limit 100',
  api: 'select timestamp, event_message from edge_logs order by timestamp desc limit 100',
  postgres: 'select timestamp, event_message from postgres_logs order by timestamp desc limit 100',
};
export const LOG_NAMES = Object.keys(LOG_SOURCES);

export async function supabaseLogs(env, source, minutes = 60) {
  const end = new Date();
  const start = new Date(end - Math.min(minutes, 1440) * 60000);
  const qs = new URLSearchParams({ sql: LOG_SOURCES[source], iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
  const r = await supabaseApi(env, `/analytics/endpoints/logs.all?${qs}`);
  if (r.error) return r;
  return { data: r.data?.result || [] };
}

export async function failedLoginCount(env, minutes = 15) {
  const r = await supabaseLogs(env, 'auth', minutes);
  if (r.error) return r;
  return { data: r.data.filter(x => /invalid[_ ]login|invalid_credentials|Invalid login/i.test(x.event_message || '')).length };
}

export async function supabaseSqlReadOnly(env, query) {
  const r = await supabaseApi(env, '/database/query/read-only', { method: 'POST', body: JSON.stringify({ query }) });
  if (r.error) return r;
  return { data: Array.isArray(r.data) ? r.data.slice(0, 100) : r.data };
}
