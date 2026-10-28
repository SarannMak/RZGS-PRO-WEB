// RZGS-PRO report bot (@rzgs_trading_bot): Telegram webhook that answers the owner and the report group.
//   /report        today's statement (Excel + PDF), sent to the chat that asked
//   /today         today's figures as a short message
//   /brokers       live figures from the Exness, Lirunex and Investizo partner accounts
// Telegram signs each call with the secret_token set in setWebhook (vault secret report_bot_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const usd = (n: unknown) => (n == null ? '-' : '$' + Number(n).toFixed(2));

const HELP = [
  '<b>RZGS-PRO report bot</b>',
  '/report - today\'s statement (Excel + PDF)',
  '/today - today\'s figures',
  '/brokers - live Exness, Lirunex and Investizo partner figures',
].join('\n');

function todayText(d: any) {
  const [y, m, day] = d.date.split('-');
  const t = d.traffic || {};
  const { exness: ex, lirunex: li, investizo: iz } = d;
  return [
    `<b>RZGS-PRO today</b> ${day}/${m}/${y}`,
    '',
    `<b>Users</b>`,
    `Sign ups: ${d.signup_today} (total ${d.users_total})`,
    `Logins (24 h): ${d.login_today}`,
    `Active / inactive (30 d): ${d.active_users} / ${d.inactive_users}`,
    '',
    `<b>Website (24 h)</b>`,
    `Visitors: ${t.visitors?.[0] ?? 0} · Page views: ${t.views?.[0] ?? 0}`,
    `Interested: ${t.interested?.[0] ?? 0} · Referral clicks: ${t.referral?.[0] ?? 0}`,
    '',
    `<b>Orders</b>`,
    `Plan orders: ${d.orders} · Completed: ${d.done} · Incomplete: ${d.open}`,
    `Net income (from plan prices): ${usd(d.done_value)}`,
    '',
    `<b>Brokers</b>`,
    ex ? `Exness: ${ex.clients} clients · reward 30 d ${usd(ex.reward_30d)}` : 'Exness: could not be reached',
    li ? `Lirunex: ${li.clients} clients · earnings this month ${usd(li.earnings_month)}` : 'Lirunex: could not be reached',
    iz ? `Investizo: ${iz.registrations} clients · commission 30 d ${usd(iz.commission_30d)}` : 'Investizo: could not be reached',
  ].join('\n');
}

function brokersText(d: any) {
  const { exness: ex, lirunex: li, investizo: iz } = d;
  const down = 'could not be reached just now';
  return [
    '<b>Exness</b> (live)',
    ...(ex ? [
      `Clients: ${ex.clients} · Accounts: ${ex.accounts} · Traded: ${ex.traded_accounts}`,
      `New accounts (24 h): ${ex.new_accounts} · Volume 30 d: ${ex.volume_lots_30d} lots`,
      `Reward 24 h: ${usd(ex.reward_day)} · 30 d: ${usd(ex.reward_30d)}`,
    ] : [down]),
    '',
    '<b>Lirunex</b> (live)',
    ...(li ? [
      `Clients: ${li.clients} · Sub-partners: ${li.sub_partners}`,
      `Deposits this month: ${usd(li.deposit_month)} · Net: ${usd(li.net_deposit_month)}`,
      `Earnings this month: ${usd(li.earnings_month)}`,
    ] : [down]),
    '',
    '<b>Investizo</b> (live)',
    ...(iz ? [
      `Registrations: ${iz.registrations} · Active: ${iz.active_clients} · Trades: ${iz.trades} (${iz.volume_lots} lots)`,
      `Commission today: ${usd(iz.commission_today)} · 30 d: ${usd(iz.commission_30d)} · all time: ${usd(iz.commission_total)}`,
      `Balance not yet paid out: ${usd(iz.balance)}`,
    ] : [down]),
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

  const [command] = text.trim().split(/\s+/);
  const cmd = command.split('@')[0].toLowerCase();

  const work = (async () => {
    switch (cmd) {
      case '/start':
      case '/help':
        return reply(HELP);
      case '/report': {
        await reply('Making today\'s statement…');
        const res = await statement({ chat_id: chatId, thread_id: thread });
        if (!res.ok) return reply('Sorry, the statement could not be made just now. Try again in a minute.');
        return;
      }
      case '/today':
      case '/brokers':
      case '/exness': {
        const res = await statement({ dry: true });
        if (!res.ok) return reply('Sorry, the figures could not be read just now.');
        const d = await res.json();
        return reply(cmd === '/today' ? todayText(d) : brokersText(d));
      }
      default:
        return;
    }
  })();

  // Answer Telegram at once; the statement takes a few seconds and Telegram would retry a slow webhook.
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions
  EdgeRuntime.waitUntil(work.catch((e) => console.error('report-bot', e)));
  return new Response('ok');
});
