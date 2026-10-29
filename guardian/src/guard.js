// Everything that decides "who may talk to the bot" and "what may leave it" lives here,
// in plain code, so a prompt-injected model can't talk its way around it.

export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a ?? ''));
  const y = enc.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Only the owner's numeric Telegram id counts. Usernames can be changed or spoofed-looking; ids can't.
export function isOwner(env, userId, chatType) {
  return chatType === 'private' && String(userId) === String(env.OWNER_TELEGRAM_ID);
}

const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs (Supabase keys)
  /sb_secret_[A-Za-z0-9_-]+/g,
  /sbp_[A-Za-z0-9]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\d{8,10}:[A-Za-z0-9_-]{35}/g, // Telegram bot tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redact(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

// Fixed-window counter in KV. Caps Claude spend and brute-force noise.
export async function rateLimit(env, key, limit, windowSec) {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = parseInt((await env.STATE.get(bucket)) || '0', 10) + 1;
  await env.STATE.put(bucket, String(n), { expirationTtl: windowSec + 60 });
  return n <= limit;
}

// Read-only SQL gate. The Supabase read-only endpoint is the real barrier; this is a second one.
const SQL_FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|execute|set|reset|vacuum|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink)\b/i;
const SQL_SENSITIVE =
  /(encrypted_password|refresh_tokens|one_time_tokens|recovery_token|confirmation_token|email_change_token|reauthentication_token|mfa_factors|vault\.|\bsecret\b|private_key|api_key|service_role)/i;

export function checkReadOnlySql(sql) {
  const q = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!q) return 'Empty query.';
  if (q.includes(';')) return 'Only a single statement is allowed.';
  if (!/^(select|with|explain)\b/i.test(q)) return 'Only SELECT/WITH/EXPLAIN queries are allowed.';
  if (SQL_FORBIDDEN.test(q)) return 'Query contains a forbidden keyword.';
  if (SQL_SENSITIVE.test(q)) return 'Query touches credential/secret columns, which this bot never reads.';
  return null;
}

export function hostAllowed(env, urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return String(env.SITE_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(u.hostname.toLowerCase());
}
