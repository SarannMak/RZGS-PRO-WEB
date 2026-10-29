// RZGS-PRO report bot (@rzgs_trading_bot): Telegram webhook that answers the owner and the report group.
//   /report /weekly /monthly   the statement for today, this week or this month (Excel + PDF), sent to the chat that asked
//   /today                     today's figures as a short message
//   /brokers                   today's live figures from the Exness, Lirunex and Investizo partner accounts
//   /users [today|week|month|all]   customer list (Excel + PDF): new users in the period, or everyone (owner only)
//   /payments [today|week|month|all]   payment statement (Excel + PDF): paid, needs confirmation, waiting (owner only)
// Telegram signs each call with the secret_token set in setWebhook (vault secret report_bot_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const usd = (n: unknown) => (n == null ? '-' : '$' + Number(n).toFixed(2));
const num = (n: unknown) => (n == null ? '-' : String(n));
const BROKERS = [['Exness', 'exness'], ['Lirunex', 'lirunex'], ['Investizo', 'investizo']];
const BOT_USERNAME = 'rzgs_trading_bot';
const STATEMENTS: Record<string, string> = { '/report': 'daily', '/weekly': 'weekly', '/monthly': 'monthly' };
// Words accepted after /users and /payments for the period.
const RANGES: Record<string, string> = {
  today: 'today', daily: 'today', day: 'today',
  week: 'week', weekly: 'week',
  month: 'month', monthly: 'month',
  all: 'all',
};

const HELP = [
  '<b>RZGS-PRO report bot</b>',
  '/report - today\'s statement (Excel + PDF)',
  '/weekly - this week\'s statement',
  '/monthly - this month\'s statement',
  '/today - today\'s figures',
  '/brokers - today\'s live broker figures',
  '/users - new users today (Excel + PDF); add week, month or all, e.g. /users all',
  '/payments - payment statement for this month (Excel + PDF); add today, week or all',
  '',
  'Statements are also sent here automatically at 20:00: daily, weekly on Sunday, monthly on the last day of the month.',
].join('\n');

const brokerCommission = (d: any) => BROKERS.reduce((sum, [, k]) => sum + (Number(d[k]?.commission) || 0), 0);

function todayText(d: any) {
  const t = d.traffic || {};
  return [
    `<b>RZGS-PRO today</b> ${d.date.split('-').reverse().join('/')}`,
    '',
    `<b>Net income: ${usd(Number(d.plan_income || 0) + brokerCommission(d))}</b>`,
    `Plan sales ${usd(d.plan_income)} · Broker commission ${usd(brokerCommission(d))}`,
    '',
    `<b>Users</b>`,
    `New users: ${d.signup} (total ${d.users_total}) · Logins: ${d.login}`,
    '',
    `<b>Orders</b>`,
    `Sales: ${d.orders} · Completed: ${d.done} · Incomplete: ${d.open}`,
    '',
    `<b>Website</b>`,
    `Visitors: ${t.visitors ?? 0} · Page views: ${t.views ?? 0}`,
    `Interested: ${t.interested ?? 0} · Referral clicks: ${t.referral ?? 0}`,
  ].join('\n');
}

function brokersText(d: any) {
  return [
    `<b>Brokers today</b> (live)`,
    ...BROKERS.flatMap(([name, k]) => {
      const b = d[k];
      if (!b) return ['', `<b>${name}</b>: could not be reached just now`];
      return ['', `<b>${name}</b>`, `Clients: ${num(b.clients)} · Active: ${num(b.active)} · Inactive: ${num(b.inactive)}`,
        `Trades: ${num(b.trades)} · Commission: ${usd(b.commission)}`];
    }),
    '',
    `<b>Total commission today: ${usd(brokerCommission(d))}</b>`,
  ].join('\n');
}

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-telegram-bot-api-secret-token') !== target.report_bot_secret) return new Response('forbidden', { status: 403 });

  const update = await req.json().catch(() => null);
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

  const telegram = (method: string, payload: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${target.report_tg_token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => res.json()).catch(() => null);
  const reply = (html: string) =>
    telegram('sendMessage', { chat_id: chatId, message_thread_id: thread, text: html, parse_mode: 'HTML', reply_to_message_id: msg.message_id });
  const statement = (body: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/functions/v1/daily-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-report-key': target.report_fn_key },
      body: JSON.stringify(body),
    });
  // Shows "Making …" while the files are built, then deletes it so only the files (with their details) stay;
  // on failure the note turns into the error.
  const withFiles = async (note: string, body: Record<string, unknown>) => {
    const sent = await reply(note);
    const id = sent?.result?.message_id;
    const res = await statement({ ...body, chat_id: chatId, thread_id: thread });
    if (res.ok) return id && telegram('deleteMessage', { chat_id: chatId, message_id: id });
    const sorry = 'Sorry, the files could not be made just now. Try again in a minute.';
    return id ? telegram('editMessageText', { chat_id: chatId, message_id: id, text: sorry }) : reply(sorry);
  };

  const [command, arg] = text.trim().split(/\s+/);
  const [name, botName] = command.split('@');
  // In a group, /start@rzgsprobot is meant for another bot; answer only bare commands and ones addressed to this bot.
  if (botName && botName.toLowerCase() !== BOT_USERNAME) return new Response('ok');
  const cmd = name.toLowerCase();

  const work = (async () => {
    if (cmd === '/start' || cmd === '/help') return reply(HELP);
    if (STATEMENTS[cmd]) return withFiles(`Making the ${STATEMENTS[cmd]} statement…`, { kind: STATEMENTS[cmd] });
    if (cmd === '/users' || cmd === '/payments') {
      const users = cmd === '/users';
      if (!isOwner) return reply(`Only the owner can get the ${users ? 'customer list' : 'payment statement'}.`);
      const range = arg ? RANGES[arg.toLowerCase()] : users ? 'today' : 'month';
      if (!range) return reply(`Write it like this: <code>${cmd} today</code>, <code>${cmd} week</code>, <code>${cmd} month</code> or <code>${cmd} all</code>.`);
      return withFiles(`Making the ${users ? 'customer list' : 'payment statement'}…`, { list: cmd.slice(1), range });
    }
    if (cmd === '/today' || cmd === '/brokers') {
      const res = await statement({ kind: 'daily', dry: true });
      if (!res.ok) return reply('Sorry, the figures could not be read just now.');
      const d = await res.json();
      return reply(cmd === '/today' ? todayText(d) : brokersText(d));
    }
  })();

  // Answer Telegram at once; a statement takes a few seconds and Telegram would retry a slow webhook.
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions
  EdgeRuntime.waitUntil(work.catch((e) => console.error('report-bot', e)));
  return new Response('ok');
});
