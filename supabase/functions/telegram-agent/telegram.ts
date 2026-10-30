import { cfg } from './config.ts';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function api(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('telegram', method, res.status, await res.text());
}

export type Button = { text: string; data: string };

/** Sends HTML text, split to fit Telegram's 4096 limit. Buttons go on the last chunk. */
export async function send(chatId: number, html: string, buttons?: Button[]) {
  const chunks: string[] = [];
  for (let i = 0; i < html.length; i += 3800) chunks.push(html.slice(i, i + 3800));
  if (!chunks.length) chunks.push('(empty)');
  for (let i = 0; i < chunks.length; i++) {
    await api('sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(buttons && i === chunks.length - 1
        ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } }
        : {}),
    });
  }
}

export const answerCallback = (id: string, text: string) => api('answerCallbackQuery', { callback_query_id: id, text });
export const clearButtons = (chatId: number, messageId: number) =>
  api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
