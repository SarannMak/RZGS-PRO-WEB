// RZGS-PRO report bot (@rzgs_trading_bot): Telegram webhook that answers the owner and the report group.
//   /report     statement (Excel + PDF): daily, weekly or monthly
//   /brokers    live Exness, Lirunex and Investizo figures as a message: daily, weekly or monthly
//   /payments   payment statement (Excel + PDF): today, this week, this month or all time (owner and admins)
//   /users      customer list (Excel + PDF): today, this week, this month or all time (owner and admins)
// A command alone asks for the period with buttons; a period word after it (e.g. /report weekly) skips the question.
// Telegram signs each call with the secret_token set in setWebhook (vault secret report_bot_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const usd = (n: unknown) => (n == null ? '-' : '$' + Number(n).toFixed(2));
const num = (n: unknown) => (n == null ? '-' : String(n));
const BOT_USERNAME = 'rzgs_trading_bot';
const BROKERS = [['Exness', 'exness'], ['Lirunex', 'lirunex'], ['Investizo', 'investizo']];

// The words people type after a command, for each kind of period choice.
const STATEMENT_PERIODS = { buttons: [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']],
  words: { daily: 'daily', today: 'daily', day: 'daily', weekly: 'weekly', week: 'weekly', monthly: 'monthly', month: 'monthly' } };
const LIST_PERIODS = { buttons: [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']],
  words: { today: 'today', daily: 'today', day: 'today', week: 'week', weekly: 'week', month: 'month', monthly: 'month', all: 'all' } };
const ACTIONS: Record<string, { name: string; periods: typeof LIST_PERIODS; restricted: boolean }> = {
  report: { name: 'statement', periods: STATEMENT_PERIODS, restricted: false },
  brokers: { name: 'broker report', periods: STATEMENT_PERIODS, restricted: false },
  payments: { name: 'payment statement', periods: LIST_PERIODS, restricted: true },
  users: { name: 'customer list', periods: LIST_PERIODS, restricted: true },
};

const HELP = [
  '<b>RZGS-PRO report bot</b>',
  '/report - statement (Excel + PDF): daily, weekly or monthly',
  '/brokers - live broker figures: daily, weekly or monthly',
  '/payments - payment statement (Excel + PDF)',
  '/users - customer list (Excel + PDF)',
  '',
  'Each command asks which period. You can also type it, e.g. /report weekly or /payments all.',
  'Statements are also sent automatically at 20:00: daily every day, weekly on Sunday, monthly on the last day of the month.',
].join('\n');

function brokersText(d: any) {
  const dmy = (iso: string) => iso.split('-').reverse().join('/');
  const period = d.from === d.to ? dmy(d.from) : `${dmy(d.from)} - ${dmy(d.to)}`;
  const label = { daily: 'today', weekly: 'this week', monthly: 'this month' }[d.kind as string];
  const total = BROKERS.reduce((sum, [, k]) => sum + (Number(d[k]?.commission) || 0), 0);
  return [
    `<b>Brokers ${label}</b> (live) · ${period}`,
    ...BROKERS.flatMap(([name, k]) => {
      const b = d[k];
      if (!b) return ['', `<b>${name}</b>: could not be reached just now`];
      return ['', `<b>${name}</b>`, `Clients: ${num(b.clients)} · Active: ${num(b.active)} · Inactive: ${num(b.inactive)}`,
        `Trades: ${num(b.trades)} · Commission: ${usd(b.commission)}`];
    }),
    '',
    `<b>Total commission ${label}: ${usd(total)}</b>`,
  ].join('\n');
}

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-telegram-bot-api-secret-token') !== target.report_bot_secret) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);

  const telegram = (method: string, payload: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${target.report_tg_token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => res.json()).catch(() => null);
  const statement = (body: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/functions/v1/daily-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-report-key': target.report_fn_key },
      body: JSON.stringify(body),
    });
  const isAdmin = async (chatId: number, userId: number) =>
    ['creator', 'administrator'].includes((await telegram('getChatMember', { chat_id: chatId, user_id: userId }))?.result?.status);

  // Runs an action for a period. `note` is the bot's message shown meanwhile ("Making …"): it is deleted once
  // the files arrive, or turned into the broker figures or the error.
  const perform = async (action: string, period: string, chatId: number, thread: number | undefined, note: number | undefined) => {
    const edit = (text: string) => note
      ? telegram('editMessageText', { chat_id: chatId, message_id: note, text, parse_mode: 'HTML' })
      : telegram('sendMessage', { chat_id: chatId, message_thread_id: thread, text, parse_mode: 'HTML' });
    const sorry = 'Sorry, this could not be made just now. Try again in a minute.';
    if (action === 'brokers') {
      const res = await statement({ kind: period, dry: true });
      return edit(res.ok ? brokersText(await res.json()) : sorry);
    }
    const body = action === 'report' ? { kind: period } : { list: action, range: period };
    const res = await statement({ ...body, chat_id: chatId, thread_id: thread });
    if (!res.ok) return edit(sorry);
    return note && telegram('deleteMessage', { chat_id: chatId, message_id: note });
  };
  const later = (work: Promise<unknown>) => {
    // Answer Telegram at once; a statement takes a few seconds and Telegram would retry a slow webhook.
    // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions
    EdgeRuntime.waitUntil(work.catch((e) => console.error('report-bot', e)));
    return new Response('ok');
  };

  // A period button was pressed under "Which …?"
  const q = update?.callback_query;
  if (q) {
    const [action, period] = String(q.data || '').split(':');
    const message = q.message;
    if (!ACTIONS[action] || !ACTIONS[action].periods.buttons.some(([p]) => p === period) || !message) return new Response('ok');
    const chatId = message.chat.id;
    const inGroup = String(chatId) === target.report_tg_chat;
    // Telegram shows the real account of whoever presses a button, even for an admin posting anonymously.
    const allowed = String(q.from?.id) === target.report_owner_id
      || (inGroup && (!ACTIONS[action].restricted || await isAdmin(chatId, q.from?.id)));
    if (!allowed) {
      await telegram('answerCallbackQuery', { callback_query_id: q.id, text: `Only the owner can get the ${ACTIONS[action].name}.`, show_alert: true });
      return new Response('ok');
    }
    return later((async () => {
      await telegram('answerCallbackQuery', { callback_query_id: q.id });
      await telegram('editMessageText', { chat_id: chatId, message_id: message.message_id, text: `Making the ${ACTIONS[action].name}…` });
      await perform(action, period, chatId, message.is_topic_message ? message.message_thread_id : undefined, message.message_id);
    })());
  }

  // A typed command
  const msg = update?.message;
  const text: string = msg?.text || '';
  if (!msg || !text.startsWith('/')) return new Response('ok');
  const chatId = msg.chat.id;
  const thread = msg.is_topic_message ? msg.message_thread_id : undefined;
  // The owner, or a group admin posting anonymously as the report group itself (Telegram then hides who it is,
  // and only admins can post as the group).
  const isOwner = String(msg.from?.id) === target.report_owner_id
    || (String(chatId) === target.report_tg_chat && String(msg.sender_chat?.id) === target.report_tg_chat);
  if (!isOwner && String(chatId) !== target.report_tg_chat) return new Response('ok');

  const [command, arg] = text.trim().split(/\s+/);
  const [name, botName] = command.split('@');
  // In a group, /start@rzgsprobot is meant for another bot; answer only bare commands and ones addressed to this bot.
  if (botName && botName.toLowerCase() !== BOT_USERNAME) return new Response('ok');
  const cmd = name.toLowerCase().slice(1);
  const reply = (html: string, extra: Record<string, unknown> = {}) =>
    telegram('sendMessage', { chat_id: chatId, message_thread_id: thread, text: html, parse_mode: 'HTML', reply_to_message_id: msg.message_id, ...extra });

  return later((async () => {
    if (cmd === 'start' || cmd === 'help') return reply(HELP);
    const action = ACTIONS[cmd];
    if (!action) return;
    if (action.restricted && !isOwner && !(msg.from && await isAdmin(chatId, msg.from.id))) {
      return reply(`Only the owner can get the ${action.name}.`);
    }
    if (!arg) {
      return reply(`Which ${action.name}?`, {
        reply_markup: { inline_keyboard: [action.periods.buttons.map(([p, label]) => ({ text: label, callback_data: `${cmd}:${p}` }))] },
      });
    }
    const period = (action.periods.words as Record<string, string>)[arg.toLowerCase()];
    if (!period) {
      return reply(`Type <code>/${cmd}</code> and pick a period, or write it: ${action.periods.buttons.map(([p]) => `<code>/${cmd} ${p}</code>`).join(', ')}.`);
    }
    const note = await reply(`Making the ${action.name}…`);
    return perform(cmd, period, chatId, thread, note?.result?.message_id);
  })());
});
