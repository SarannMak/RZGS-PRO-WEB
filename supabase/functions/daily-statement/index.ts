// Daily statement: reads rz_statement_data(), builds the statement as an Excel file and a matching PDF,
// and sends both to the report group in Telegram (vault secrets report_tg_chat, and report_tg_thread for the topic).
// Called every morning by the pg_cron job "rz-daily-activity-report" with the x-report-key header.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildStatement } from './statement-xlsx.js';
import { printStatement } from './statement-pdf.js';
import { exnessFigures } from './exness.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-report-key') !== target.report_fn_key) return new Response('forbidden', { status: 403 });

  const { data, error } = await db.rpc('rz_statement_data');
  if (error) return new Response(error.message, { status: 500 });
  data.exness = await exnessFigures(target.exness_login, target.exness_password, data.date);
  // {"dry": true} checks the figures without numbering or sending a statement
  if ((await req.json().catch(() => ({}))).dry) return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

  const { data: stmtNo, error: noError } = await db.rpc('rz_next_statement_no');
  if (noError) return new Response(noError.message, { status: 500 });
  const wb = buildStatement(data, stmtNo);
  const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
  const pdf = await printStatement(wb.getWorksheet('Statement'));

  const [y, m, d] = data.date.split('-');
  const send = (file: Uint8Array, type: string, name: string, caption: string) => {
    const form = new FormData();
    form.append('chat_id', target.report_tg_chat);
    if (target.report_tg_thread) form.append('message_thread_id', target.report_tg_thread);
    form.append('caption', caption);
    form.append('document', new Blob([file], { type }), name);
    return fetch(`https://api.telegram.org/bot${target.report_tg_token}/sendDocument`, { method: 'POST', body: form });
  };
  const name = `RZGS-PRO-Statement-${stmtNo}`;
  const sentXlsx = await send(xlsx, XLSX, `${name}.xlsx`, `Daily Statement Report ${d}/${m}/${y} · STMT No ${stmtNo}`);
  const sentPdf = await send(pdf, 'application/pdf', `${name}.pdf`, `PDF · STMT No ${stmtNo}`);
  const ok = sentXlsx.ok && sentPdf.ok;
  return new Response(JSON.stringify({ xlsx: await sentXlsx.json(), pdf: await sentPdf.json() }), { status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
