// Morning website-activity report: reads rz_site_activity() and sends a phone-width table to the
// report group in Telegram (same bot / chat / daily topic as daily-statement, from rz_report_target()).
// Called every morning at 07:30 Phnom Penh time by the pg_cron job rz-site-activity, with the x-report-key header.
//   {"dry": true}              return the text without sending it
//   {"chat_id", "thread_id"}   send to that chat instead of the report topic
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => iso.split('-').reverse().join('/');

const ROWS: [string, string][] = [
  ['Visitors', 'visitors'], ['Page views', 'views'], ['Sign up', 'signup'], ['Log in', 'login'],
  ['Interested', 'interested'], ['Referral clk', 'referral'], ['Ref-code SU', 'ref_signup'], ['Other', 'other'],
];

function render(d: any) {
  const pad = (s: string | number, n: number, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));
  const line = '-'.repeat(31);
  const table = [
    `${pad('Activity', 12)}${pad('Day', 6, true)}${pad('Week', 6, true)}${pad('Month', 7, true)}`,
    line,
    ...ROWS.map(([label, key]) =>
      `${pad(label, 12)}${pad(d.day[key] ?? 0, 6, true)}${pad(d.week[key] ?? 0, 6, true)}${pad(d.month[key] ?? 0, 7, true)}`),
  ].join('\n');

  const dv = d.day.visitors - d.prev_day.visitors;
  const trend = `${dv >= 0 ? '▲' : '▼'} ${Math.abs(dv)} visitors vs day before`;
  const pages = (d.top_pages || []).map((p: any) => `• ${esc(p.page)} — ${p.n}`).join('\n') || '• none';
  const clicks = (d.top_clicks || []).map((c: any) => `• ${esc(c.target)} (${esc(c.kind)}) — ${c.n}`).join('\n') || '• none';

  return `<b>🌐 rzgspro.com · Website Activity</b>\n`
    + `Date: ${dmy(d.date)} · Total users: ${d.users_total}\n`
    + `<pre>${esc(table)}</pre>\n`
    + `Day = yesterday · Week = last 7 days · Month = last 30 days\n`
    + `${trend}\n\n`
    + `<b>Top pages (7 days)</b>\n${pages}\n\n`
    + `<b>Top clicks (7 days)</b>\n${clicks}\n\n`
    + `<i>Referral clk = broker referral link clicks · Ref-code SU = sign ups that used a referral code</i>`;
}

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-report-key') !== target.report_fn_key) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));

  const { data, error } = await db.rpc('rz_site_activity');
  if (error) return new Response(error.message, { status: 500 });
  const text = render(data);
  if (body.dry) return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const thread = body.chat_id ? body.thread_id : target.report_tg_thread;
  const res = await fetch(`https://api.telegram.org/bot${target.report_tg_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: body.chat_id ?? target.report_tg_chat,
      ...(thread ? { message_thread_id: Number(thread) } : {}),
      text, parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  });
  return new Response(await res.text(), { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
