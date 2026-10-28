// RZGS-PRO report bot (@rzgs_trading_bot): Telegram webhook that answers the owner and the report group.
//   /report        today's statement (Excel + PDF), sent to the chat that asked
//   /today         today's figures as a short message
//   /exness        live figures from the Exness partner account
//   /commission    record broker commission: /commission lirunex 12.50 [note]   (owner only)
//   /commissions   commission recorded in the last 30 days
// Telegram signs each call with the secret_token set in setWebhook (vault secret report_bot_secret).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
// Exness commission comes live from the Exness partner API, so only these two are typed in.
const BROKERS: Record<string, string> = { lirunex: 'Lirunex', investizo: 'Investizo' };

const usd = (n: unknown) => (n == null ? '-' : '$' + Number(n).toFixed(2));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const HELP = [
  '<b>RZGS-PRO report bot</b>',
  '/report - today\'s statement (Excel + PDF)',
  '/today - today\'s figures',
  '/exness - live Exness partner figures',
  '/commission lirunex 12.50 - record Lirunex or Investizo commission',
  '/commissions - commission recorded in the last 30 days',
].join('\n');

function todayText(d: any) {
  const [y, m, day] = d.date.split('-');
  const t = d.traffic || {};
  const ex = d.exness;
  const b = d.brokers || {};
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
    ex ? `Exness (live): ${ex.clients} clients · ${ex.accounts} accounts · reward 30 d ${usd(ex.reward_30d)}` : 'Exness: could not be reached',
    `Lirunex (manual): commission 30 d ${usd(b.Lirunex?.commission ?? 0)}`,
    `Investizo (manual): commission 30 d ${usd(b.Investizo?.commission ?? 0)}`,
  ].join('\n');
}

function exnessText(ex: any) {
  if (!ex) return 'Exness could not be reached just now. Try again in a minute.';
  return [
    '<b>Exness partner (live)</b>',
    `Clients: ${ex.clients}`,
    `Trading accounts: ${ex.accounts}`,
    `New accounts (24 h): ${ex.new_accounts}`,
    `Accounts that have traded: ${ex.traded_accounts}`,
    `Volume 30 d: ${ex.volume_lots_30d} lots`,
    `Reward 24 h: ${usd(ex.reward_day)}`,
    `Reward 30 d: ${usd(ex.reward_30d)}`,
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
  const isOwner = String(msg.from?.id) === target.report_owner_id;
  const allowed = isOwner || String(chatId) === target.report_tg_chat;
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

  const [command, ...args] = text.trim().split(/\s+/);
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
      case '/exness': {
        const res = await statement({ dry: true });
        if (!res.ok) return reply('Sorry, the figures could not be read just now.');
        const d = await res.json();
        return reply(cmd === '/today' ? todayText(d) : exnessText(d.exness));
      }
      case '/commission': {
        if (!isOwner) return reply('Only the owner can record commission.');
        const broker = BROKERS[(args[0] || '').toLowerCase()];
        const amount = Number((args[1] || '').replace(/[$,]/g, ''));
        if (!broker || !Number.isFinite(amount) || !args[1]) {
          return reply('Write it like this: <code>/commission lirunex 12.50</code>\nBrokers: Lirunex or Investizo (Exness is read live). You can add a note after the amount.');
        }
        const note = args.slice(2).join(' ') || null;
        const { error } = await db.from('rz_commission').insert({ broker, amount, note });
        if (error) return reply('Could not save it: ' + esc(error.message));
        return reply(`Saved: <b>${broker}</b> ${usd(amount)}${note ? ' · ' + esc(note) : ''} for today. It will be in tomorrow's statement.`);
      }
      case '/commissions': {
        const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const { data, error } = await db.from('rz_commission').select('day, broker, amount, note').gte('day', since).order('day', { ascending: false });
        if (error) return reply('Could not read commission: ' + esc(error.message));
        if (!data?.length) return reply('No commission recorded in the last 30 days.');
        const totals: Record<string, number> = {};
        for (const row of data) totals[row.broker] = (totals[row.broker] || 0) + Number(row.amount);
        return reply([
          '<b>Commission, last 30 days</b>',
          ...data.slice(0, 20).map((row) => `${row.day} · ${row.broker} · ${usd(row.amount)}${row.note ? ' · ' + esc(row.note) : ''}`),
          '',
          ...Object.entries(totals).map(([k, v]) => `<b>${k}</b>: ${usd(v)}`),
        ].join('\n'));
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
