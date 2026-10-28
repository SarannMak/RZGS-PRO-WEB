// RZGS-PRO report bot (@rzgs_trading_bot): Telegram webhook that answers the owner and the report group.
//   /report /weekly /monthly   the statement for today, this week or this month (Excel + PDF), sent to the chat that asked
//   /today                     today's figures as a short message
//   /brokers                   today's live figures from the Exness, Lirunex and Investizo partner accounts
// Telegram signs each call with the secret_token set in setWebhook (vault secret report_bot_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const usd = (n: unknown) => (n == null ? '-' : '$' + Number(n).toFixed(2));
const num = (n: unknown) => (n == null ? '-' : String(n));
const BROKERS = [['Exness', 'exness'], ['Lirunex', 'lirunex'], ['Investizo', 'investizo']];
const STATEMENTS: Record<string, string> = { '/report': 'daily', '/weekly': 'weekly', '/monthly': 'monthly' };

const HELP = [
  '<b>RZGS-PRO report bot</b>',
  '/report - today\'s statement (Excel + PDF)',
  '/weekly - this week\'s statement',
  '/monthly - this month\'s statement',
  '/today - today\'s figures',
  '/brokers - today\'s live broker figures',
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
  const allowed = String(msg.from?.id) === target.report_owner_id || String(chatId) === target.report_tg_chat;
  if (!allowed) return new Response('ok');

  const reply = (html: string) =>
    fetch(`https://api.telegram.org/bot${target.report_tg_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_thread_id: thread, text: html, parse_mode: 'HTML', reply_to_message_id: msg.message_id }),
    });
  const statement = (body: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/functions/v1/daily-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-report-key': target.report_fn_key },
      body: JSON.stringify(body),
    });

  const cmd = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

  const work = (async () => {
    if (cmd === '/start' || cmd === '/help') return reply(HELP);
    if (STATEMENTS[cmd]) {
      const kind = STATEMENTS[cmd];
      await reply(`Making the ${kind} statement…`);
      const res = await statement({ kind, chat_id: chatId, thread_id: thread });
      if (!res.ok) return reply('Sorry, the statement could not be made just now. Try again in a minute.');
      return;
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
