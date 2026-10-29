import { timingSafeEqual, isOwner, rateLimit } from './guard.js';
import { send, typing, answerCallback, alertOwner } from './telegram.js';
import { runAgent } from './agent.js';
import { runWriteTool } from './tools.js';
import { sweep } from './sweep.js';

const HELP = `Guardian online. Ask anything, e.g.
• "full security check"
• "any new issues or odd activity?"
• "how are failed logins in the last hour?"
• "review my RLS policies"
Commands: /status (quick sweep), /help`;

async function handleMessage(env, m) {
  const chatId = m.chat.id;
  if (!isOwner(env, m.from?.id, m.chat.type)) {
    // Silent to strangers; tell the owner at most once an hour.
    if (await rateLimit(env, 'intruder', 1, 3600)) {
      await alertOwner(env, `⚠️ Unauthorized contact with the bot from id ${m.from?.id} (@${m.from?.username || 'none'}). Ignored.`);
    }
    return;
  }
  if (!(await rateLimit(env, 'owner', 30, 3600))) return send(env, chatId, 'Rate limit reached (30/hour). Try later.');

  const text = (m.text || '').trim();
  if (!text) return;
  if (text === '/start' || text === '/help') return send(env, chatId, HELP);
  if (text === '/reset') { await env.STATE.delete('history'); return send(env, chatId, 'Conversation cleared.'); }

  await typing(env, chatId);
  const prompt = text === '/status' ? 'Run a quick full health and security sweep (site, exposed files, GitHub alerts, Supabase advisors, auth logs for the last hour) and summarise.' : text;
  const history = (await env.STATE.get('history', 'json')) || [];

  try {
    const { text: answer } = await runAgent(env, history, prompt, async (name, input) => {
      const id = crypto.randomUUID().slice(0, 8);
      await env.STATE.put(`pending:${id}`, JSON.stringify({ name, input }), { expirationTtl: 300 });
      await send(env, chatId, `Confirm action?\n${name}\nTitle: ${input.title}\n\n${String(input.body).slice(0, 800)}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: `ok:${id}` }, { text: '❌ Cancel', callback_data: `no:${id}` }]] },
      });
    });
    // Keep only plain text turns: small, and no stale tool payloads carried forward.
    await env.STATE.put('history', JSON.stringify([...history, { role: 'user', content: prompt }, { role: 'assistant', content: answer }].slice(-12)), { expirationTtl: 86400 });
    await send(env, chatId, answer);
  } catch (e) {
    console.error(e);
    await send(env, chatId, `Error: ${e.message}`);
  }
}

async function handleCallback(env, cb) {
  if (!isOwner(env, cb.from?.id, cb.message?.chat?.type)) return answerCallback(env, cb.id, 'Not allowed');
  const [verb, id] = String(cb.data || '').split(':');
  const key = `pending:${id}`;
  const pending = await env.STATE.get(key, 'json');
  await env.STATE.delete(key); // one-shot: a button can't be replayed
  if (!pending) return answerCallback(env, cb.id, 'Expired');
  if (verb !== 'ok') { await answerCallback(env, cb.id, 'Cancelled'); return send(env, cb.message.chat.id, 'Cancelled.'); }
  await answerCallback(env, cb.id, 'Running');
  await send(env, cb.message.chat.id, await runWriteTool(env, pending.name, pending.input));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('Not found', { status: 404 });
    if (!timingSafeEqual(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response('Forbidden', { status: 403 });
    }
    let update;
    try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }

    // Telegram retries on slow replies, so dedupe by update_id and do the work after answering 200.
    const seen = `upd:${update.update_id}`;
    if (await env.STATE.get(seen)) return new Response('ok');
    await env.STATE.put(seen, '1', { expirationTtl: 3600 });

    if (update.message) ctx.waitUntil(handleMessage(env, update.message));
    else if (update.callback_query) ctx.waitUntil(handleCallback(env, update.callback_query));
    return new Response('ok');
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
};
