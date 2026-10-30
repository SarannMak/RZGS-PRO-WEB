// Telegram helpers + request authentication.

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sendMessage(token: string, chatId: number | string, text: string) {
  // Telegram caps messages at 4096 chars; send plain text so tool output can't break markup.
  for (let i = 0; i < text.length || i === 0; i += 4000) {
    await fetch(API(token, "sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000), disable_web_page_preview: true }),
    });
  }
}

export async function sendTyping(token: string, chatId: number | string) {
  await fetch(API(token, "sendChatAction"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {});
}
