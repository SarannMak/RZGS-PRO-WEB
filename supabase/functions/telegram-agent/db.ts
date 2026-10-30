import { createClient } from 'npm:@supabase/supabase-js@2';
import { cfg } from './config.ts';

let client: ReturnType<typeof createClient> | null = null;
export const admin = () =>
  (client ??= createClient(cfg.supabaseUrl(), cfg.serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } }));

export async function audit(actor: string, kind: string, detail: Record<string, unknown> = {}) {
  const { error } = await admin().from('agent_audit').insert({ actor, kind, detail });
  if (error) console.error('audit failed', error.message);
}

export async function getState<T>(key: string): Promise<T | null> {
  const { data } = await admin().from('agent_state').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function setState(key: string, value: unknown) {
  await admin().from('agent_state').upsert({ key, value, updated_at: new Date().toISOString() });
}

/** Read-only SQL through the Management API. Only ever called with fixed queries written in this repo. */
export async function mgmtSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const token = cfg.mgmtToken();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN not set');
  const res = await fetch(`https://api.supabase.com/v1/projects/${cfg.projectRef()}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}`);
  return await res.json();
}
