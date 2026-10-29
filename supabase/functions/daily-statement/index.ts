// Statements: reads rz_period_data() for the day, the week or the month, adds live broker figures, builds the
// statement as an Excel file and a matching PDF, and sends both to the report group in Telegram
// (vault secret report_tg_chat; topics: report_tg_thread for daily, report_tg_thread_periodic for weekly and monthly).
// Called at 20:00 Phnom Penh time by the pg_cron jobs rz-statement-daily / -weekly / -monthly with the x-report-key header.
//   {"kind": "daily" | "weekly" | "monthly"}   which statement (daily when left out)
//   {"dry": true}                              return the figures without numbering or sending a statement
//   {"chat_id", "thread_id"}                   send to that chat instead of the report topic (the report bot's commands)
//   {"list": "users", "range": "today" | "week" | "month" | "all"}   the customer list instead of a statement
//   {"list": "payments", "range": "today" | "week" | "month" | "all"}   the payment statement
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildStatement } from './statement-xlsx.js';
import { printStatement } from './statement-pdf.js';
import { buildUserList } from './users-xlsx.js';
import { buildPaymentList } from './payments-xlsx.js';
import { exnessFigures, investizoFigures, lirunexFigures } from './brokers.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAMES: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-report-key') !== target.report_fn_key) return new Response('forbidden', { status: 403 });

  const body = await req.json().catch(() => ({}));
  const kind = NAMES[body.kind] ? body.kind : 'daily';
  const chat = body.chat_id ?? target.report_tg_chat;
  const topic = kind === 'daily' ? target.report_tg_thread : target.report_tg_thread_periodic || target.report_tg_thread;
  const thread = body.chat_id ? body.thread_id : topic;
  const dmy = (iso: string) => iso.split('-').reverse().join('/');
  const send = (file: Uint8Array, type: string, name: string, caption: string) => {
    const form = new FormData();
    form.append('chat_id', String(chat));
    if (thread) form.append('message_thread_id', String(thread));
    form.append('caption', caption);
    form.append('document', new Blob([file], { type }), name);
    return fetch(`https://api.telegram.org/bot${target.report_tg_token}/sendDocument`, { method: 'POST', body: form });
  };
  const sendBoth = async (wb: any, sheet: string, name: string, caption: string) => {
    const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
    const pdf = await printStatement(wb.getWorksheet(sheet));
    const sentXlsx = await send(xlsx, XLSX, `${name}.xlsx`, caption);
    const sentPdf = await send(pdf, 'application/pdf', `${name}.pdf`, `PDF · ${caption}`);
    const ok = sentXlsx.ok && sentPdf.ok;
    return new Response(JSON.stringify({ xlsx: await sentXlsx.json(), pdf: await sentPdf.json() }), { status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
  };

  if (body.list === 'users') {
    const { data: list, error: listError } = await db.rpc('rz_customer_list', { p_range: body.range || 'today' });
    if (listError) return new Response(listError.message, { status: 500 });
    const label = { today: 'New users today', week: 'New users this week', month: 'New users this month', all: 'All users' }[list.range as string];
    const n = list.rows.length;
    return sendBoth(buildUserList(list), 'Customers', `RZGS-PRO-Customers-${list.range}-${list.date}`,
      `Customer List · ${label} · ${dmy(list.date)} · ${n} customer${n === 1 ? '' : 's'}`);
  }

  if (body.list === 'payments') {
    const { data: list, error: listError } = await db.rpc('rz_payment_list', { p_range: body.range || 'month' });
    if (listError) return new Response(listError.message, { status: 500 });
    const label = { today: 'Today', week: 'This week', month: 'This month', all: 'All time' }[list.range as string];
    const total = (statuses: string[]) => list.rows.filter((u: any) => statuses.includes(u.status))
      .reduce((sum: number, u: any) => sum + Number(u.amount || 0), 0).toFixed(2);
    const confirm = list.rows.filter((u: any) => u.status === 'confirm').length;
    return sendBoth(buildPaymentList(list), 'Payments', `RZGS-PRO-Payments-${list.range}-${list.date}`,
      `Payment Statement · ${label} · ${dmy(list.date)} · Received $${total(['paid', 'expired'])} · `
      + `Not received yet $${total(['confirm', 'waiting'])}${confirm ? ` · ${confirm} need${confirm === 1 ? 's' : ''} your confirmation` : ''}`);
  }

  const { data, error } = await db.rpc('rz_period_data', { p_kind: kind });
  if (error) return new Response(error.message, { status: 500 });
  [data.exness, data.lirunex, data.investizo] = await Promise.all([
    exnessFigures(target.exness_login, target.exness_password, data.from, data.to),
    lirunexFigures(target.lirunex_login, target.lirunex_password, data.from, data.to),
    investizoFigures(target.investizo_login, target.investizo_password, data.from, data.to),
  ]);
  if (body.dry) return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

  const { data: stmtNo, error: noError } = await db.rpc('rz_statement_no', { p_kind: kind });
  if (noError) return new Response(noError.message, { status: 500 });
  const period = data.from === data.to ? dmy(data.from) : `${dmy(data.from)} - ${dmy(data.to)}`;
  const net = Number(data.plan_income || 0) + [data.exness, data.lirunex, data.investizo].reduce((sum, b) => sum + (Number(b?.commission) || 0), 0);
  return sendBoth(buildStatement(data, stmtNo), 'Statement', `RZGS-PRO-${NAMES[kind]}-Statement-${stmtNo}`,
    `${NAMES[kind]} Statement Report · ${period} · STMT No ${stmtNo} · Net income $${net.toFixed(2)}`);
});
