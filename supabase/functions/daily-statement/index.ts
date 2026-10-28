// Daily statement: reads rz_statement_data(), draws it as a PNG and as an Excel statement,
// and sends both to the owner's Telegram chat.
// Called every morning by the pg_cron job "rz-daily-activity-report" with the x-report-key header.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { renderStatement } from './render.js';
import { buildStatement } from './statement-xlsx.js';

const FONTS = 'https://unpkg.com/@expo-google-fonts/';
const FONT_FILES = [
  'inter@0.4.2/400Regular/Inter_400Regular.ttf',
  'inter@0.4.2/500Medium/Inter_500Medium.ttf',
  'inter@0.4.2/600SemiBold/Inter_600SemiBold.ttf',
  'inter@0.4.2/700Bold/Inter_700Bold.ttf',
  'inter@0.4.2/800ExtraBold/Inter_800ExtraBold.ttf',
  'orbitron@0.4.2/900Black/Orbitron_900Black.ttf',
];
const LOGO = 'https://rzgspro.com/assets/logo-192.png';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
let ready: Promise<unknown> | null = null;

function base64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function bytes(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

Deno.serve(async (req) => {
  const target = (await db.rpc('rz_report_target')).data as Record<string, string> | null;
  if (!target || req.headers.get('x-report-key') !== target.report_fn_key) return new Response('forbidden', { status: 403 });

  const { data, error } = await db.rpc('rz_statement_data');
  if (error) return new Response(error.message, { status: 500 });

  ready ??= initWasm(fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'));
  const [, fonts, logo] = await Promise.all([
    ready,
    Promise.all(FONT_FILES.map((f) => bytes(FONTS + f))),
    bytes(LOGO).then((b) => 'data:image/png;base64,' + base64(b)).catch(() => null),
  ]);
  const svg = renderStatement(data, logo);
  const png = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: 'Inter', loadSystemFonts: false } }).render().asPng();

  const { data: stmtNo, error: noError } = await db.rpc('rz_next_statement_no');
  if (noError) return new Response(noError.message, { status: 500 });
  const xlsx = await buildStatement(data, stmtNo);

  const send = (method: string, field: string, file: Uint8Array, type: string, name: string, caption: string) => {
    const form = new FormData();
    form.append('chat_id', target.report_tg_chat);
    form.append('caption', caption);
    form.append(field, new Blob([file], { type }), name);
    return fetch(`https://api.telegram.org/bot${target.report_tg_token}/${method}`, { method: 'POST', body: form });
  };
  const photo = await send('sendPhoto', 'photo', png, 'image/png', `statement-${data.date}.png`, `RZGS-PRO daily statement ${data.date}`);
  const doc = await send('sendDocument', 'document', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `RZGS-PRO-Statement-${stmtNo}.xlsx`, `Statement No ${stmtNo} (Excel)`);
  const ok = photo.ok && doc.ok;
  return new Response(JSON.stringify({ photo: await photo.json(), document: await doc.json() }), { status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
