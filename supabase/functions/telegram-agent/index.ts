import { chat, createPending } from './agent.ts';
import { cfg } from './config.ts';
import { admin, audit, getState, setState } from './db.ts';
import { answerCallback, clearButtons, esc, send } from './telegram.ts';
import { authActivity, dbOverview, Finding, githubOverview, render, Report, runAll, securityAudit, siteHealth } from './tools.ts';

const HELP = `<b>RZGS guardian</b>
/status  everything at a glance
/site  /db  /security  /logins  /issues  one check each
/ban &lt;user-uuid&gt;  /unban &lt;user-uuid&gt;  (asks you to confirm)
/audit  last actions the bot took
Or just ask in plain words.`;

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', info: '🔵' } as const;
const SINGLE: Record<string, () => Promise<Report>> = {
  '/site': siteHealth, '/db': dbOverview, '/security': securityAudit, '/logins': authActivity, '/issues': githubOverview,
};

async function showPending(chatId: number, p: { id: string; summary: string }) {
  await send(chatId, `⚠️ <b>Confirm?</b>\n${esc(p.summary)}\nExpires in 2 minutes.`, [
    { text: '✅ Confirm', data: 'ok:' + p.id }, { text: '✖ Cancel', data: 'no:' + p.id },
  ]);
}

async function onMessage(chatId: number, text: string) {
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  const c = cmd.toLowerCase().replace(/@.*$/, '');
  if (c === '/start' || c === '/help') return send(chatId, HELP);
  if (c === '/status') {
    const reports = await runAll();
    const f = reports.flatMap((r) => r.findings);
    const head = f.length ? f.map((x) => `${ICON[x.severity]} ${esc(x.text)}`).join('\n') : '✅ No problems found.';
    return send(chatId, `${head}\n\n${reports.map((r) => esc(render(r))).join('\n\n')}`);
  }
  if (SINGLE[c]) {
    const r = await SINGLE[c]();
    return send(chatId, [esc(render(r)), ...r.findings.map((x) => `${ICON[x.severity]} ${esc(x.text)}`)].join('\n'));
  }
  if (c === '/ban' || c === '/unban') {
    if (!arg || !/^[0-9a-f-]{36}$/i.test(arg)) return send(chatId, 'Usage: /ban &lt;full user uuid&gt;');
    const kind = c === '/ban' ? 'ban_user' : 'unban_user';
    return showPending(chatId, await createPending(kind, { user_id: arg }, `${c === '/ban' ? 'Ban' : 'Unban'} user ${arg}`));
  }
  if (c === '/audit') {
    const { data } = await admin().from('agent_audit').select('at,actor,kind').order('at', { ascending: false }).limit(10);
    return send(chatId, (data ?? []).map((r) => `${r.at.slice(5, 16)} ${r.actor} ${r.kind}`).join('\n') || 'Empty.');
  }
  if (text.startsWith('/')) return send(chatId, HELP);
  const { reply, pending } = await chat(text);
  await send(chatId, esc(reply));
  for (const p of pending) await showPending(chatId, p);
}

async function onCallback(chatId: number, messageId: number, callbackId: string, data: string) {
  const [verb, id] = data.split(':');
  await clearButtons(chatId, messageId);
  const { data: row } = await admin().from('agent_pending').select('*').eq('id', id).maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return answerCallback(callbackId, 'Expired or already used');
  // claim first so a double tap cannot run it twice
  const { data: claimed } = await admin().from('agent_pending').update({ used_at: new Date().toISOString() }).eq('id', id).is('used_at', null).select('id');
  if (!claimed?.length) return answerCallback(callbackId, 'Already used');
  if (verb === 'no') { await audit('owner', 'cancelled', { kind: row.kind }); return answerCallback(callbackId, 'Cancelled'); }
  const banned = row.kind === 'ban_user';
  const { error } = await admin().auth.admin.updateUserById(row.params.user_id, { ban_duration: banned ? '876000h' : 'none' });
  await audit('owner', row.kind, { user_id: row.params.user_id, ok: !error });
  await answerCallback(callbackId, error ? 'Failed' : 'Done');
  await send(chatId, error ? `Failed: ${esc(error.message)}` : `Done: ${esc(row.summary)}`);
}

/** Cron entry: run all checks, tell the owner only about findings not already reported. */
async function monitor() {
  const findings: Finding[] = (await runAll()).flatMap((r) => r.findings);
  const known = new Set((await getState<string[]>('known_findings')) ?? []);
  const fresh = findings.filter((f) => !known.has(f.id));
  await setState('known_findings', findings.map((f) => f.id)); // resolved ones drop out, so a return re-alerts
  if (fresh.length) {
    await send(cfg.ownerId(), `🚨 <b>${fresh.length} new finding(s)</b>\n` + fresh.map((f) => `${ICON[f.severity]} ${esc(f.text)}`).join('\n'));
    await audit('monitor', 'alert', { ids: fresh.map((f) => f.id) });
  }
  return new Response('ok');
}

async function webhook(req: Request) {
  // 1. Telegram proves it is Telegram with the secret we registered.
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', cfg.webhookSecret())) return new Response('forbidden', { status: 403 });
  const update = await req.json();

  // 2. Each update is processed once (Telegram retries on slow replies).
  const { error: dup } = await admin().from('agent_updates').insert({ update_id: update.update_id });
  if (dup) return new Response('ok');

  const from = update.message?.from ?? update.callback_query?.from;
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;

  // 3. Only the owner, only in a private chat. Everyone else is ignored silently.
  if (!from || from.id !== cfg.ownerId() || chat?.type !== 'private' || chat.id !== cfg.ownerId()) {
    await audit('stranger', 'rejected', { user: from?.id, username: from?.username });
    const last = (await getState<number>('last_stranger_alert')) ?? 0;
    if (Date.now() - last > 600_000) {
      await setState('last_stranger_alert', Date.now());
      await send(cfg.ownerId(), `🟡 Someone else (id ${from?.id ?? '?'}) messaged the bot. Ignored.`);
    }
    return new Response('ok');
  }

  try {
    if (update.message?.text) {
      await audit('owner', 'message', { text: update.message.text.slice(0, 80) });
      await onMessage(chat.id, update.message.text);
    } else if (update.callback_query?.data) {
      await onCallback(chat.id, update.callback_query.message.message_id, update.callback_query.id, update.callback_query.data);
    }
  } catch (e) {
    console.error(e);
    await send(chat.id, `Error: ${esc((e as Error).message)}`);
  }
  return new Response('ok');
}

Deno.serve((req) => {
  if (req.method !== 'POST') return new Response('not found', { status: 404 });
  if (new URL(req.url).pathname.endsWith('/monitor')) {
    if (!safeEqual(req.headers.get('x-monitor-secret') ?? '', cfg.monitorSecret())) return new Response('forbidden', { status: 403 });
    return monitor();
  }
  return webhook(req);
});
