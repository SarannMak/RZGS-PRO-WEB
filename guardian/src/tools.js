import { checkReadOnlySql } from './guard.js';
import { checkSite, scanExposure, githubAlerts, gh, supabaseAdvisors, supabaseLogs, supabaseSqlReadOnly, LOG_NAMES } from './checks.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });

// READ-ONLY tools run immediately. WRITE tools never run from the model: they are parked
// in KV and only execute after the owner taps the confirm button in Telegram.
export const TOOLS = [
  { name: 'check_website', description: 'HTTP status, latency and missing security headers for the site (or a page on it).', input_schema: obj({ url: { type: 'string', description: 'Optional https URL on the configured site hosts' } }) },
  { name: 'scan_exposed_files', description: 'Probe the public site for files that must never be reachable (.env, .git, backups, SQL dumps).', input_schema: obj() },
  { name: 'github_security_alerts', description: 'Open secret-scanning, Dependabot and code-scanning alerts for the repo.', input_schema: obj() },
  { name: 'github_recent_activity', description: 'Recent repo events (pushes, PRs, issues, forks, collaborator/deploy-key changes) to spot unexpected activity.', input_schema: obj() },
  { name: 'github_list_issues', description: 'List open issues.', input_schema: obj({ state: { type: 'string', enum: ['open', 'closed', 'all'] } }) },
  { name: 'github_recent_commits', description: 'Latest commits with author and message.', input_schema: obj() },
  { name: 'supabase_security_advisors', description: 'Supabase security lints (RLS disabled, exposed views, weak settings).', input_schema: obj() },
  { name: 'supabase_logs', description: 'Recent Supabase logs. source: auth (logins/failures), api (requests), postgres (db errors).', input_schema: obj({ source: { type: 'string', enum: LOG_NAMES }, minutes: { type: 'integer', description: 'Look-back window, max 1440' } }, ['source']) },
  { name: 'supabase_sql_readonly', description: 'Run ONE read-only SELECT against the database (row counts, RLS policy review via pg_policies, etc). Credential columns are blocked.', input_schema: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'create_github_issue', description: 'Open a GitHub issue to track a finding. Requires the owner to confirm in Telegram before it happens.', input_schema: obj({ title: { type: 'string' }, body: { type: 'string' } }, ['title', 'body']) },
];

export const WRITE_TOOLS = new Set(['create_github_issue']);

export async function runReadTool(env, name, input) {
  switch (name) {
    case 'check_website': return checkSite(env, input.url);
    case 'scan_exposed_files': return scanExposure(env);
    case 'github_security_alerts': return githubAlerts(env);
    case 'github_recent_activity': {
      const r = await gh(env, '/events?per_page=30');
      return r.error ? r : r.data.map(e => ({ type: e.type, actor: e.actor?.login, at: e.created_at, action: e.payload?.action, ref: e.payload?.ref }));
    }
    case 'github_list_issues': {
      const r = await gh(env, `/issues?state=${input.state || 'open'}&per_page=20`);
      return r.error ? r : r.data.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, by: i.user?.login, at: i.created_at, url: i.html_url }));
    }
    case 'github_recent_commits': {
      const r = await gh(env, '/commits?per_page=15');
      return r.error ? r : r.data.map(c => ({ sha: c.sha.slice(0, 7), by: c.commit.author?.name, at: c.commit.author?.date, msg: c.commit.message.split('\n')[0], verified: c.commit.verification?.verified }));
    }
    case 'supabase_security_advisors': return supabaseAdvisors(env);
    case 'supabase_logs': return supabaseLogs(env, input.source, input.minutes || 60);
    case 'supabase_sql_readonly': {
      const bad = checkReadOnlySql(input.query);
      return bad ? { error: bad } : supabaseSqlReadOnly(env, input.query);
    }
    default: return { error: `Unknown tool ${name}` };
  }
}

export async function runWriteTool(env, name, input) {
  if (name === 'create_github_issue') {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'rzgs-guardian', 'content-type': 'application/json' },
      body: JSON.stringify({ title: String(input.title).slice(0, 200), body: String(input.body).slice(0, 5000) }),
    });
    const j = await r.json();
    return r.ok ? `Issue created: ${j.html_url}` : `GitHub error ${r.status}`;
  }
  return 'Unknown action';
}
