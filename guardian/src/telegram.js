import { redact } from './guard.js';

async function call(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
  return r;
}

export async function send(env, chatId, text, extra = {}) {
  const clean = redact(text);
  for (let i = 0; i < clean.length || i === 0; i += 3900) {
    await call(env, 'sendMessage', {
      chat_id: chatId,
      text: clean.slice(i, i + 3900) || '(empty)',
      disable_web_page_preview: true,
      ...(i + 3900 >= clean.length ? extra : {}),
    });
  }
}

export const typing = (env, chatId) => call(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
export const answerCallback = (env, id, text) => call(env, 'answerCallbackQuery', { callback_query_id: id, text });
export const alertOwner = (env, text) => send(env, env.OWNER_TELEGRAM_ID, text);
