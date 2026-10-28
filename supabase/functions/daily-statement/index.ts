// Statements: reads rz_period_data() for the day, the week or the month, adds live broker figures, builds the
// statement as an Excel file and a matching PDF, and sends both to the report group in Telegram
// (vault secrets report_tg_chat, and report_tg_thread for the topic).
// Called at 20:00 Phnom Penh time by the pg_cron jobs rz-statement-daily / -weekly / -monthly with the x-report-key header.
//   {"kind": "daily" | "weekly" | "monthly"}   which statement (daily when left out)
//   {"dry": true}                              return the figures without numbering or sending a statement
//   {"chat_id", "thread_id"}                   send to that chat instead of the report topic (the report bot's commands)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildStatement } from './statement-xlsx.js';
import { printStatement } from './statement-pdf.js';
import { exnessFigures, investizoFigures, lirunexFigures } from './brokers.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAMES: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-report-key') !== target.report_fn_key) return new Response('forbidden', { status: 403 });

  const body = await req.json().catch(() => ({}));
  const kind = NAMES[body.kind] ? body.kind : 'daily';
  const { data, error } = await db.rpc('rz_period_data', { p_kind: kind });
  if (error) return new Response(error.message, { status: 500 });
  [data.exness, data.lirunex, data.investizo] = await Promise.all([
    exnessFigures(target.exness_login, target.exness_password, data.from, data.to),
    lirunexFigures(target.lirunex_login, target.lirunex_password, data.from, data.to),
    investizoFigures(target.investizo_login, target.investizo_password, data.from, data.to),
  ]);
  if (body.dry) return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const chat = body.chat_id ?? target.report_tg_chat;
  const thread = body.chat_id ? body.thread_id : target.report_tg_thread;

  const { data: stmtNo, error: noError } = await db.rpc('rz_statement_no', { p_kind: kind });
  if (noError) return new Response(noError.message, { status: 500 });
  const wb = buildStatement(data, stmtNo);
  const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
  const pdf = await printStatement(wb.getWorksheet('Statement'));

  const dmy = (iso: string) => iso.split('-').reverse().join('/');
  const period = data.from === data.to ? dmy(data.from) : `${dmy(data.from)} - ${dmy(data.to)}`;
  const send = (file: Uint8Array, type: string, name: string, caption: string) => {
    const form = new FormData();
    form.append('chat_id', String(chat));
    if (thread) form.append('message_thread_id', String(thread));
    form.append('caption', caption);
    form.append('document', new Blob([file], { type }), name);
    return fetch(`https://api.telegram.org/bot${target.report_tg_token}/sendDocument`, { method: 'POST', body: form });
  };
  const name = `RZGS-PRO-${NAMES[kind]}-Statement-${stmtNo}`;
  const sentXlsx = await send(xlsx, XLSX, `${name}.xlsx`, `${NAMES[kind]} Statement Report · ${period} · STMT No ${stmtNo}`);
  const sentPdf = await send(pdf, 'application/pdf', `${name}.pdf`, `PDF · STMT No ${stmtNo}`);
  const ok = sentXlsx.ok && sentPdf.ok;
  return new Response(JSON.stringify({ xlsx: await sentXlsx.json(), pdf: await sentPdf.json() }), { status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
