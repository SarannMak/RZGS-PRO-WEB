// Draws the RZGS-PRO daily statement as one SVG (1080 px wide), from rz_statement_data().
import { ICONS } from './icons.js';

const C = {
  bg: '#050d0d', panel: '#0a1919', panel2: '#0d2020', line: '#17403b', edge: '#1d6b60',
  teal: '#19e3b1', tealDim: '#0f7d68', text: '#eaf6f3', muted: '#86a9a3', faint: '#4d6f6a',
  hi: '#0e4c44', red: '#ff7a7a', amber: '#ffc861',
};
const W = 1080;
const PAD = 40;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n) => (n == null ? '—' : '$' + Number(n).toFixed(2));
const num = (n) => (n == null ? '—' : String(n));

function text(x, y, s, { size = 24, weight = 400, fill = C.text, anchor = 'start', font = 'Inter', spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(s)}</text>`;
}
function icon(name, x, y, size = 28, color = C.teal) {
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}
function panel(x, y, w, h, { fill = C.panel, stroke = C.edge, r = 18 } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}
function iconBadge(name, x, y, s = 56) {
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="14" fill="${C.panel2}" stroke="${C.teal}" stroke-width="2"/>` + icon(name, x + s / 2 - 14, y + s / 2 - 14, 28);
}
function sectionHead(x, y, w, iconName, title) {
  return icon(iconName, x + 24, y + 22, 34) + text(x + 74, y + 48, title, { size: 27, weight: 800, spacing: 1 })
    + `<line x1="${x + 20}" y1="${y + 72}" x2="${x + w - 20}" y2="${y + 72}" stroke="${C.line}" stroke-width="1.5"/>`;
}

// A table: cols = [{ title, x (relative), anchor, w }], rows = [[cell, ...]], hiRow = index to highlight
function table(x, y, w, cols, rows, { rowH = 50, head = 46, hiRow = -1, size = 23, headSize = 20 } = {}) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${head}" fill="${C.panel2}"/>`;
  cols.forEach((c) => { s += text(x + c.x, y + head - 15, c.title, { size: headSize, weight: 700, fill: C.muted, anchor: c.anchor || 'start' }); });
  rows.forEach((row, i) => {
    const ry = y + head + i * rowH;
    if (i === hiRow) s += `<rect x="${x}" y="${ry}" width="${w}" height="${rowH}" fill="${C.hi}"/>`;
    else if (i % 2) s += `<rect x="${x}" y="${ry}" width="${w}" height="${rowH}" fill="#0c1d1d"/>`;
    s += `<line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="${C.line}" stroke-width="1"/>`;
    row.forEach((cell, j) => {
      const c = cols[j];
      const v = typeof cell === 'object' && cell !== null ? cell : { t: cell };
      const strong = i === hiRow;
      s += text(x + c.x, ry + rowH / 2 + size * 0.36, v.t, {
        size: v.size || size, weight: v.weight || (strong ? 800 : c.weight || 500),
        fill: v.fill || (strong && j === cols.length - 1 ? C.teal : c.fill || C.text), anchor: c.anchor || 'start',
      });
      if (v.sub) s += text(x + c.x + v.subX, ry + rowH / 2 + 8, v.sub, { size: 18, fill: C.muted });
    });
  });
  return { svg: s, h: head + rows.length * rowH };
}

// List panel like the mock-up: icon, label, value (+ optional small total)
function listPanel(x, y, w, iconName, title, items) {
  const rowH = 62;
  const h = 90 + items.length * rowH + 14;
  let s = panel(x, y, w, h) + sectionHead(x, y, w, iconName, title);
  items.forEach(([ic, label, value, sub], i) => {
    const ry = y + 86 + i * rowH;
    if (i) s += `<line x1="${x + 20}" y1="${ry}" x2="${x + w - 20}" y2="${ry}" stroke="${C.line}" stroke-width="1"/>`;
    s += icon(ic, x + 28, ry + 17, 28, C.text) + text(x + 76, ry + 40, label, { size: 23 });
    s += text(x + w - 28, ry + 41, value, { size: 30, weight: 800, fill: C.teal, anchor: 'end' });
    if (sub) s += text(x + w - 28 - String(value).length * 19 - 14, ry + 40, sub, { size: 17, fill: C.muted, anchor: 'end' });
  });
  return { svg: s, h };
}

export function renderStatement(d, logo) {
  const parts = [];
  let y = 0;

  // header
  if (logo) parts.push(`<image href="${logo}" x="${PAD}" y="26" width="104" height="104"/>`);
  parts.push(text(PAD + 124, 92, 'RZGS', { size: 58, weight: 900, font: 'Orbitron', spacing: 2 }));
  parts.push(text(PAD + 124 + 192, 92, '-PRO', { size: 58, weight: 900, font: 'Orbitron', fill: C.teal, spacing: 2 }));
  parts.push(text(PAD + 128, 124, 'AUTOMATED TRADING SYSTEM', { size: 17, weight: 600, fill: C.muted, spacing: 5 }));
  parts.push(text(W - PAD, 78, 'TRADE SMART', { size: 15, weight: 600, fill: C.muted, anchor: 'end', spacing: 4 }));
  parts.push(text(W - PAD, 102, 'GROW CONSISTENTLY', { size: 15, weight: 600, fill: C.muted, anchor: 'end', spacing: 4 }));
  parts.push(`<line x1="${W - 330}" y1="118" x2="${W - PAD}" y2="118" stroke="${C.teal}" stroke-width="2" opacity=".6"/>`);
  y = 160;

  // title + date
  parts.push(panel(PAD, y, W - 2 * PAD, 130));
  parts.push(icon('bar-chart-3', PAD + 26, y + 30, 46));
  parts.push(text(PAD + 92, y + 66, 'DAILY STATEMENT REPORT', { size: 40, weight: 900, font: 'Orbitron' }));
  parts.push(text(PAD + 94, y + 104, 'BUSINESS OVERVIEW', { size: 17, weight: 700, fill: C.teal, spacing: 5 }));
  parts.push(panel(W - PAD - 268, y + 20, 244, 90, { fill: C.bg, stroke: C.line, r: 14 }));
  parts.push(icon('calendar-days', W - PAD - 250, y + 46, 38));
  parts.push(text(W - PAD - 198, y + 52, 'DATE', { size: 15, weight: 700, fill: C.muted, spacing: 2 }));
  parts.push(text(W - PAD - 198, y + 86, d.date, { size: 27, weight: 700 }));
  y += 154;

  // KPI tiles
  const growth = d.users_yesterday ? (d.signup_today / d.users_yesterday) * 100 : 0;
  const kpis = [
    ['coins', 'NET INCOME', usd(d.income_30d), 'Last 30 days'],
    ['bot', 'ACTIVE BOTS', String(d.bots_running), `Running of ${d.bots_total}`],
    ['users', 'TOTAL USERS', String(d.users_total), `${d.active_users} active`],
    [growth >= 0 ? 'trending-up' : 'trending-down', "TODAY'S GROWTH", (growth > 0 ? '+' : '') + growth.toFixed(1) + '%', `+${d.signup_today} new users`],
  ];
  const kw = (W - 2 * PAD) / 4;
  parts.push(panel(PAD, y, W - 2 * PAD, 196));
  kpis.forEach(([ic, label, value, sub], i) => {
    const kx = PAD + i * kw;
    if (i) parts.push(`<line x1="${kx}" y1="${y + 22}" x2="${kx}" y2="${y + 174}" stroke="${C.line}" stroke-width="1.5"/>`);
    parts.push(iconBadge(ic, kx + 20, y + 24, 50));
    parts.push(text(kx + 20, y + 106, label, { size: 15, weight: 700, fill: C.muted, spacing: 1 }));
    parts.push(text(kx + 20, y + 150, value, { size: value.length > 6 ? 36 : 44, weight: 800, fill: i === 3 && growth > 0 ? C.teal : C.text }));
    parts.push(text(kx + 20, y + 178, sub, { size: 17, fill: C.muted }));
  });
  y += 220;

  // income statement
  const p = d.plans || {};
  const is = table(PAD, y + 86, W - 2 * PAD, [
    { title: 'No.', x: 34, anchor: 'middle' }, { title: 'Description', x: 80 }, { title: 'Users', x: 690, anchor: 'end' }, { title: 'Amount (USD)', x: W - 2 * PAD - 28, anchor: 'end' },
  ], [
    ['1', 'Sales  (all plan orders)', num(d.orders), usd(d.orders_value)],
    ['2', 'Completed  (bot delivered)', num(d.done), usd(d.done_value)],
    ['3', 'Incomplete  (not finished)', num(d.open), usd(d.open_value)],
    ['4', 'Net Income  (completed sales)', num(d.done), usd(d.done_value)],
    ['5', 'Free  (Trial plan)', num(p.trial?.users), usd(p.trial?.usd)],
    ['6', 'Elite  ($5 plan)', num(p.elite?.users), usd(p.elite?.usd)],
    ['7', 'Diamond  ($49 plan)', num(p.diamond?.users), usd(p.diamond?.usd)],
  ], { hiRow: 3 });
  parts.push(panel(PAD, y, W - 2 * PAD, 86 + is.h + 12) + sectionHead(PAD, y, W - 2 * PAD, 'file-text', 'INCOME STATEMENT') + is.svg);
  y += 86 + is.h + 12 + 24;

  // two list panels
  const half = (W - 2 * PAD - 24) / 2;
  const b = d.brokers || {};
  const reg = listPanel(PAD, y, half, 'user-plus', 'REGISTRATION', [
    ['user', 'Sign Up', d.signup_today, `of ${d.users_total}`],
    ['link', 'Register (Broker)', d.broker_today, `of ${d.broker_users}`],
    ['landmark', 'Lirunex', b.Lirunex?.today ?? 0, `of ${b.Lirunex?.users ?? 0}`],
    ['landmark', 'Exness', b.Exness?.today ?? 0, `of ${b.Exness?.users ?? 0}`],
    ['landmark', 'Investizo', b.Investizo?.today ?? 0, `of ${b.Investizo?.users ?? 0}`],
  ]);
  const act = listPanel(PAD + half + 24, y, half, 'bot', 'BOT & USER ACTIVITY', [
    ['log-in', 'Login Back', d.login_today],
    ['user-check', 'Active User', d.active_users],
    ['user-x', 'Inactive User', d.inactive_users],
    ['circle-check', 'Complete Bot', d.done],
    ['triangle-alert', 'Incomplete Bot', d.open],
  ]);
  parts.push(reg.svg, act.svg);
  y += Math.max(reg.h, act.h) + 24;

  // website traffic
  const t = d.traffic || {};
  const tr = (k) => (t[k] || [0, 0, 0]).map(String);
  const tt = table(PAD, y + 86, W - 2 * PAD, [
    { title: 'Activity', x: 28 }, { title: 'Day', x: 640, anchor: 'end' }, { title: 'Week', x: 810, anchor: 'end' }, { title: 'Month', x: W - 2 * PAD - 28, anchor: 'end' },
  ], [
    ['Visitors', ...tr('visitors')],
    ['Page views', ...tr('views')],
    ['Interested  (bot & plan clicks)', ...tr('interested')],
    ['Referral clicks  (broker links)', ...tr('referral')],
    ['Other  (Telegram group)', ...tr('other')],
  ]);
  parts.push(panel(PAD, y, W - 2 * PAD, 86 + tt.h + 12) + sectionHead(PAD, y, W - 2 * PAD, 'globe', 'WEBSITE TRAFFIC') + tt.svg);
  y += 86 + tt.h + 12 + 24;

  // income from website / broker
  const iw = table(PAD, y + 86, half, [
    { title: 'No.', x: 30, anchor: 'middle' }, { title: 'Source', x: 66 }, { title: 'Amount', x: half - 24, anchor: 'end' },
  ], [
    ['1', 'Sign ups', num(d.signup_30d)],
    ['2', 'Payment', usd(d.income_30d)],
    ['3', 'Commission', usd(d.commission_30d)],
  ], { size: 21 });
  const ib = table(PAD + half + 24, y + 86, half, [
    { title: 'Broker', x: 20 }, { title: 'Users', x: 270, anchor: 'end' }, { title: 'Commission', x: half - 24, anchor: 'end' },
  ], ['Lirunex', 'Exness', 'Investizo'].map((n) => [n, num(b[n]?.users ?? 0), usd(b[n]?.commission)]), { size: 21 });
  const ih = 86 + Math.max(iw.h, ib.h) + 12;
  parts.push(panel(PAD, y, half, ih) + sectionHead(PAD, y, half, 'globe', 'INCOME: WEBSITE') + iw.svg);
  parts.push(panel(PAD + half + 24, y, half, ih) + sectionHead(PAD + half + 24, y, half, 'landmark', 'INCOME: BROKER') + ib.svg);
  y += ih + 26;

  // notes + footer
  parts.push(text(PAD, y + 4, 'Day = last 24 h. Income and Commission = last 30 days. Amounts are worked out from plan prices.', { size: 17, fill: C.faint }));
  parts.push(text(PAD, y + 28, 'Commission shows "—" until it is entered in the rz_commission table.', { size: 17, fill: C.faint }));
  y += 52;
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.line}" stroke-width="1.5"/>`);
  parts.push(text(PAD, y + 46, 'RZGS', { size: 26, weight: 900, font: 'Orbitron' }) + text(PAD + 88, y + 46, '-PRO', { size: 26, weight: 900, font: 'Orbitron', fill: C.teal }));
  parts.push(text(W / 2, y + 44, 'Trade Smarter', { size: 26, weight: 600, fill: C.teal, anchor: 'middle' }));
  parts.push(text(W - PAD, y + 34, 'RZGS-PRO TEAM', { size: 16, weight: 700, anchor: 'end', spacing: 2 }));
  parts.push(text(W - PAD, y + 56, 'Daily report generated automatically', { size: 14, fill: C.muted, anchor: 'end' }));
  const H = y + 84;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071716"/><stop offset=".45" stop-color="${C.bg}"/><stop offset="1" stop-color="#061412"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<path d="M0 0 L180 0 L0 180 Z" fill="${C.teal}" opacity=".06"/><path d="M${W} ${H} L${W - 220} ${H} L${W} ${H - 220} Z" fill="${C.teal}" opacity=".05"/>
${parts.join('\n')}
</svg>`;
}
