/* ==========================================================================
   RZGS-PRO: the Features section in 3D: the scenes of the video "How RZGS-PRO
   works" (5 Videos/video project files/showreel2), live on the page.

   Four stages, each a box of style.css (.fx-stage) with data-fx3d set to:
   - strategy:   one cycle of the bot on a gold chart, on one flat board seen
                 straight on. A buy and a sell open, the winner takes profit,
                 the grid steps in, the basket closes the rest. The four steps
                 beside it ([data-fx-step]) light up in turn.
   - app:        the control app on a 3D phone, tab after tab; the copy beside
                 it ([data-fx-tabname] ...) names the tab of the moment.
   - results:    one example week as glass columns, the balance rising behind
                 them; the figures beside it ([data-fx-count]) count up.
   - protection: the four limits as shields around the RZ logo.

   Each stage gets a WebGL canvas (three.js from the CDN, the version the robot
   uses) and a 2D canvas over it for the labels. A stage only runs while it is
   on screen. With "reduce motion" each shows one still frame. Without WebGL
   the boxes keep their dark panel; the copy beside them says it all.

   The figures are an example (a $1,000 account at 0.01 lot), as in the video,
   and the page says so beside them.
   ========================================================================== */

// A plain script, not a module, like robot-3d.js: a page opened straight from a folder may not
// load module scripts. Everything is inside one function.
(() => {
'use strict';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const stages = [...document.querySelectorAll('[data-fx3d]')];
if (!stages.length) return;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- the drawing kit of the video: colours, fonts, easing, 2D HUD pieces -------------------------
const C = {
  bg: '#030c13', panel: '#071922', line: '#123644', line2: '#1c4f61', chip: '#062b38',
  cyan: '#19d3ff', mint: '#37efb8', neon: '#a6ff1a', buy: '#4aa8ff', sell: '#ff9a3d', good: '#2bf391',
  bad: '#ff5a6a', warn: '#ffd23f', text: '#f3fbff', body: '#c9dde6', muted: '#7fa3b3', frame: '#1fb6d6', on: '#02131a',
};
const DISPLAY = 'Oxanium, sans-serif', SANS = '"IBM Plex Sans", sans-serif', MONO = '"IBM Plex Mono", monospace';
const f = (weight, size, family) => `${weight} ${size}px ${family}`;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  inExpo: (k) => (k <= 0 ? 0 : Math.pow(2, 10 * k - 10)),
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inCubic: (k) => k * k * k,
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outQuart: (k) => 1 - Math.pow(1 - k, 4),
  outBack: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  spring: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.cos(k * Math.PI * 2.6) * Math.exp(-k * 6.2)),
};
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i, s = 1) => { const r = rng(i * 7919 + s * 104729); r(); return r(); };
const money = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const typed = (s, k) => s.slice(0, Math.round(s.length * clamp(k)));

function text(ctx, s, x, y, o = {}) {
  ctx.save();
  ctx.font = o.font || f(400, 16, SANS);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.base || 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing || 0}px`;
  ctx.globalAlpha *= o.alpha ?? 1;
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.glowSize || 16; }
  ctx.fillStyle = o.fill || C.text;
  ctx.fillText(s, x, y);
  ctx.restore();
}
function measure(ctx, s, font, spacing = 0) {
  ctx.save(); ctx.font = font; if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}
function grad(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, C.cyan); g.addColorStop(0.52, C.mint); g.addColorStop(1, C.neon);
  return g;
}
function cutRect(ctx, x, y, w, h, c) {
  ctx.beginPath();
  ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath();
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
// a panel the way the app draws it: cut corners, gradient border, lime corner ticks
function hud(ctx, x, y, w, h, o = {}) {
  const c = o.cut ?? 12, accent = o.accent ?? C.neon;
  ctx.save();
  cutRect(ctx, x, y, w, h, c);
  ctx.fillStyle = o.fill ?? 'rgba(6,28,38,0.94)';
  ctx.fill();
  ctx.lineWidth = o.lineWidth ?? 1.2;
  ctx.strokeStyle = o.border ?? grad(ctx, x, x + w);
  ctx.stroke();
  ctx.strokeStyle = accent; ctx.lineWidth = o.tick ?? 2.2; ctx.shadowColor = accent; ctx.shadowBlur = o.glow ?? 8;
  const arm = Math.min(o.arm ?? 26, w * 0.3);
  ctx.beginPath(); ctx.moveTo(x + 1, y + c + arm * 0.5); ctx.lineTo(x + 1, y + c); ctx.lineTo(x + c, y + 1); ctx.lineTo(x + c + arm * 0.5, y + 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - 1, y + h - c - arm * 0.5); ctx.lineTo(x + w - 1, y + h - c); ctx.lineTo(x + w - c, y + h - 1); ctx.lineTo(x + w - c - arm * 0.5, y + h - 1); ctx.stroke();
  ctx.restore();
}
function ring2d(ctx, t, t0, x, y, r1, color, dur = 0.55, width = 4) {
  const k = seg(t, t0, t0 + dur);
  if (k <= 0 || k >= 1) return;
  ctx.save();
  ctx.globalAlpha *= (1 - k) * 0.9;
  ctx.strokeStyle = color; ctx.lineWidth = width * (1 - k) + 1; ctx.shadowColor = color; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(x, y, r1 * E.outExpo(k), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
// a path drawn up to fraction k of its length
function partialPath(ctx, pts, k) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(d); total += d; }
  let left = total * clamp(k);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const kk = Math.min(1, left / lens[i - 1]);
    ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], kk), lerp(pts[i - 1][1], pts[i][1], kk));
    left -= lens[i - 1];
  }
  ctx.stroke();
}
// a label in a cut-corner box, centred on x, y
function pill(ctx, s, x, y, color, alpha, size) {
  if (alpha <= 0) return;
  const font = f(600, size, MONO), w = measure(ctx, s, font, 1) + size * 1.4, h = size * 1.9;
  ctx.save();
  ctx.globalAlpha *= alpha;
  cutRect(ctx, x - w / 2, y - h / 2, w, h, size * 0.4);
  ctx.fillStyle = 'rgba(4,16,24,0.92)'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.stroke();
  ctx.restore();
  text(ctx, s, x, y + size * 0.36, { font, spacing: 1, align: 'center', fill: color, alpha });
}

// ---- the story: one cycle of the bot, the app tour, an example week (story.js of the video) ---------
// The cycle follows the bot's own rules: a BUY and a SELL open together; the side that wins closes at
// take profit (1.00$); the next pair opens a grid distance (2.00$) beyond that close; only the holding
// side grows (0.01, 0.01, 0.02); a side with 2+ trades closes together once its total reaches the
// basket profit (6.00$ in this example).
const START = 4120;
const CHART = { t0: 1.6, t1: 5.4, x0: -7.6, x1: 7.6, y0: -3.25, perDollar: 1.02 };
const KEYS = [
  [1.60, 0.0], [1.74, 0.16], [1.85, 0.0], [2.04, -0.34], [2.24, 0.08], [2.45, 0.46], [2.75, 1.0],
  [2.95, 1.32], [3.14, 2.06], [3.30, 1.84], [3.55, 3.0], [3.66, 3.28], [3.80, 4.0], [3.92, 4.42],
  [4.06, 5.2], [4.20, 6.0], [4.32, 6.46], [4.50, 5.62], [4.66, 4.3], [4.81, 3.18], [4.95, 2.25],
  [5.10, 2.62], [5.25, 2.12], [5.40, 2.4],
];
function priceAt(t) {
  if (t <= KEYS[0][0]) return KEYS[0][1];
  if (t >= KEYS[KEYS.length - 1][0]) return KEYS[KEYS.length - 1][1];
  let i = 0;
  while (t > KEYS[i + 1][0]) i++;
  const [t0, p0] = KEYS[i], [t1, p1] = KEYS[i + 1];
  const slope = (j) => {
    const a = KEYS[Math.max(0, j - 1)], b = KEYS[Math.min(KEYS.length - 1, j + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const h = t1 - t0, u = (t - t0) / h, m0 = slope(i) * h, m1 = slope(i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}
const chartX = (t) => lerp(CHART.x0, CHART.x1, clamp((t - CHART.t0) / (CHART.t1 - CHART.t0)));
const chartY = (p) => CHART.y0 + p * CHART.perDollar;
const TP = 1.0, BASKET = 6.0, BASKET_AT = 4.95;
const TRADES = [
  { id: 'B1', side: 'buy', lvl: 1, lot: 0.01, at: 1.85, p: 0, close: { at: 2.75, kind: 'tp', pl: 1 } },
  { id: 'S1', side: 'sell', lvl: 1, lot: 0.01, at: 1.85, p: 0, close: { at: BASKET_AT, kind: 'basket' } },
  { id: 'B2', side: 'buy', lvl: 2, lot: 0.01, at: 3.55, p: 3, close: { at: 3.80, kind: 'tp', pl: 1 } },
  { id: 'S2', side: 'sell', lvl: 2, lot: 0.01, at: 3.55, p: 3, close: { at: BASKET_AT, kind: 'basket' } },
  { id: 'B3', side: 'buy', lvl: 3, lot: 0.01, at: 4.20, p: 6, close: null },
  { id: 'S3', side: 'sell', lvl: 3, lot: 0.02, at: 4.20, p: 6, close: { at: BASKET_AT, kind: 'basket' } },
];
function cycleProfit(t) {
  let s = 0;
  for (const tr of TRADES) if (tr.close && t >= tr.close.at && tr.close.kind === 'tp') s += tr.close.pl;
  if (t >= BASKET_AT) s += BASKET;
  return s;
}
function sellBasket(t) {
  const p = priceAt(t);
  return TRADES.filter((tr) => tr.side === 'sell' && t >= tr.at && t < BASKET_AT).reduce((s, tr) => s + (tr.p - p) * tr.lot * 100, 0);
}
const STEP_AT = [1.6, 2.5, 3.5, 4.5];
const TABS = [
  { at: 5.5, id: 'home', name: 'Home', sub: 'Equity, balance and your account, live every second.' },
  { at: 6.5, id: 'trades', name: 'Trades', sub: 'Level and risk, every trade on the chart, and both baskets.' },
  { at: 7.5, id: 'control', name: 'Control', sub: 'Activate, pause or finish, lot mode, cooldown, close a side.' },
  { at: 8.5, id: 'tools', name: 'Tools', sub: 'Settings with sliders, then your report by week or month.' },
];
// an ordinary week, the way a client's Report tab shows it; gold does not trade on Saturday and Sunday
const WEEK = [
  { day: 'MON', v: 10.12 }, { day: 'TUE', v: 13.01 }, { day: 'WED', v: 11.96 }, { day: 'THU', v: 9.63 }, { day: 'FRI', v: 14.43 },
];
const WEEK_TOTAL = WEEK.reduce((s, d) => s + d.v, 0); // 59.15
const SHIELDS = ['MAX SPREAD', 'MAX TOTAL LOTS', 'SMART SHIELD', 'DAILY TARGET'];

// ---- the control app as app.html looks today, drawn for the screen of the 3D phone ------------------------
// Home: the equity card, the Account box and the Active / Pause bar. Trades: the status card, the grid
// ladder with every trade on the chart (◀ where it opened, its L1 0.01 tag, blue buy / yellow sell) and
// both baskets. Control: bot state, lot mode, cooldown, force close. Tools: Settings, where the take
// profit slider moves, then the Report: this week, then by week over the month.
const PW = 700, PH = 1544, TOP = 196, DOCK_H = 150;
const DOCK = ['Home', 'Trades', 'Control', 'Tools', 'Log'];
const TAB_INDEX = { home: 0, trades: 1, control: 2, tools: 3 };
const tabAt = (t) => TABS.reduce((n, s, j) => (t >= s.at ? j : n), 0);
// the moments of the tour (tour time, see buildApp)
const AT = { pause: 7.7, resume: 8.06, smart: 7.86, tp: 8.66, toast: 8.92, report: 9.32, month: 9.98, end: 10.6 };
function tap(ctx, t, t0, x, y) {
  const k = seg(t, t0 - 0.12, t0 + 0.35);
  if (k <= 0 || k >= 1) return;
  const press = seg(t, t0 - 0.12, t0) * (1 - seg(t, t0 + 0.05, t0 + 0.2));
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 4) * (1 - seg(t, t0 + 0.15, t0 + 0.35));
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.arc(x, y, 34 - press * 8, 0, Math.PI * 2); ctx.fill();
  const r = seg(t, t0, t0 + 0.35);
  if (r > 0) {
    ctx.strokeStyle = C.neon; ctx.lineWidth = 4 * (1 - r) + 1; ctx.globalAlpha *= 1 - r;
    ctx.beginPath(); ctx.arc(x, y, 34 + 70 * E.outExpo(r), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
const cap = (ctx, s, x, y, o = {}) => text(ctx, s.toUpperCase(), x, y, { font: f(500, 19, MONO), spacing: 3, fill: C.muted, ...o });
const sep = (ctx, y) => { ctx.fillStyle = '#123644'; ctx.fillRect(56, y, PW - 112, 2); };
// a panel the way the app draws it: dark, cut corners, a cyan tick in two corners, a small capital title
function panel(ctx, x, y, w, h, title) {
  cutRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = '#071922'; ctx.fill();
  ctx.strokeStyle = '#164656'; ctx.lineWidth = 2; ctx.stroke();
  ctx.save(); ctx.strokeStyle = C.frame; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 1, y + 18); ctx.lineTo(x + 18, y + 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - 1, y + h - 18); ctx.lineTo(x + w - 18, y + h - 1); ctx.stroke();
  ctx.restore();
  if (title) cap(ctx, title, x + 30, y + 50);
}
function btn(ctx, x, y, w, h, label, kind, on) {
  const fills = { go: on ? C.good : '#062a1f', hold: on ? C.warn : '#2a2208', danger: '#2c0f19', plain: '#0a2330' };
  const strokes = { go: '#1fae6b', hold: '#b98f14', danger: '#b23a4c', plain: '#1f5a6d' };
  cutRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = fills[kind]; ctx.fill();
  if (!on) { ctx.strokeStyle = strokes[kind]; ctx.lineWidth = 2; ctx.stroke(); }
  const color = on ? C.on : { go: C.good, hold: C.warn, danger: '#ff7d8c', plain: C.text }[kind];
  text(ctx, label.toUpperCase(), x + w / 2, y + h / 2 + 10, { font: f(700, 27, DISPLAY), spacing: 2, align: 'center', fill: color });
}
// a box holding a value, like the app's number fields
function field(ctx, x, y, w, h, v, left) {
  cutRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#04121a'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2; ctx.stroke();
  text(ctx, v, left ? x + 22 : x + w - 22, y + h / 2 + 10, { font: f(500, 27, MONO), align: left ? 'left' : 'right', fill: C.body });
}
function toggle(ctx, x, y) {
  cutRect(ctx, x, y, 92, 52, 8); ctx.fillStyle = '#0a2330'; ctx.fill(); ctx.strokeStyle = C.frame; ctx.lineWidth = 2; ctx.stroke();
  ctx.save(); ctx.fillStyle = C.neon; ctx.shadowColor = C.neon; ctx.shadowBlur = 10; ctx.fillRect(x + 50, y + 9, 34, 34); ctx.restore();
}
const label2 = (ctx, y, big, small) => {
  text(ctx, big, 60, y, { font: f(500, 29, SANS) });
  text(ctx, small, 60, y + 32, { font: f(400, 21, SANS), fill: C.muted });
};
// a setting with a slider, as on the Settings tab
function slider(ctx, y, big, small, value, k, min, max) {
  label2(ctx, y, big, small);
  text(ctx, value, PW - 60, y + 6, { font: f(700, 36, DISPLAY), align: 'right', fill: C.cyan });
  const ty = y + 80, tx0 = 112, tw = PW - 224;
  text(ctx, min, 60, ty + 8, { font: f(500, 19, MONO), fill: C.muted });
  text(ctx, max, PW - 60, ty + 8, { font: f(500, 19, MONO), align: 'right', fill: C.muted });
  rrect(ctx, tx0, ty - 5, tw, 10, 5); ctx.fillStyle = '#0e2f3e'; ctx.fill();
  rrect(ctx, tx0, ty - 5, Math.max(10, tw * k), 10, 5); ctx.fillStyle = C.cyan; ctx.fill();
  ctx.save(); ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(tx0 + tw * k, ty, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  return { x: tx0 + tw * k, y: ty };
}
// a capital label over a big value, in two columns
const stat = (ctx, i, y0, k, v, col, step = 100) => {
  const x = 60 + (i % 2) * 300, y = y0 + Math.floor(i / 2) * step;
  cap(ctx, k, x, y);
  text(ctx, v, x, y + 46, { font: f(700, 39, DISPLAY), fill: col });
};
const tick = (from, to, t, a, b) => lerp(from, to, E.outCubic(seg(t, a, b)));
const nowPrice = (t) => START + 2.9 + Math.sin(t * 4) * 0.06;
const sidePL = (t, side) => TRADES.filter((tr) => tr.side === side && tr.close?.kind !== 'tp')
  .reduce((s, tr) => s + (side === 'buy' ? nowPrice(t) - (START + tr.p) : START + tr.p - nowPrice(t)) * tr.lot * 100, 0);
const BALANCE = 1212.4, TODAY = 33.38;

function homeTab(ctx, t) {
  const today = tick(TODAY - 4.6, TODAY, t, 5.55, 6.15), bal = BALANCE - (TODAY - today), fl = sidePL(t, 'buy') + sidePL(t, 'sell');
  // the equity card
  hud(ctx, 26, 0, PW - 52, 322, { fill: '#061c26', cut: 22, arm: 90, accent: C.cyan, border: '#1c4f61', tick: 5, glow: 10 });
  cap(ctx, 'Equity', 60, 66, { spacing: 4 });
  text(ctx, `$${money(bal + fl)}`, 56, 166, { font: f(800, 90, DISPLAY) });
  text(ctx, `+$${money(today)} today`, 60, 218, { font: f(500, 29, MONO), fill: C.good });
  {
    const sx = 60, sw = PW - 140, base = 300, pts = [];
    for (let i = 0; i <= 40; i++) { const k = i / 40; pts.push([sx + k * sw, base - 12 - k * 40 - Math.sin(k * 5 + 0.4) * 6]); }
    ctx.save();
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(sx + sw, base); ctx.lineTo(sx, base); ctx.closePath();
    const g = ctx.createLinearGradient(0, base - 60, 0, base); g.addColorStop(0, 'rgba(55,239,184,0.2)'); g.addColorStop(1, 'rgba(55,239,184,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = grad(ctx, sx, sx + sw); ctx.lineWidth = 5; ctx.shadowColor = C.mint; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }
  // the Account box
  const y = 342;
  panel(ctx, 26, y, PW - 52, 594, 'Account');
  [['Balance', `${bal.toFixed(2)}$`, C.text], ['Floating P/L', `${fl >= 0 ? '+' : ''}${fl.toFixed(2)}$`, fl >= 0 ? C.good : C.bad],
    ['Drawdown', '0.00%', C.good], ['Trades today', String(Math.round(tick(14, 18, t, 5.55, 6.1))), C.text]]
    .forEach(([k, v, col], i) => stat(ctx, i, y + 118, k, v, col, 104));
  [['Mode', 'SMART', C.text], ['Cycles closed today', '4', C.text], ['License', '28d 4h left', C.good]].forEach(([k, v, col], i) => {
    const ry = y + 352 + i * 68;
    cap(ctx, k, 60, ry); text(ctx, v, PW - 60, ry + 2, { font: f(700, 31, DISPLAY), align: 'right', fill: col });
    sep(ctx, ry + 24);
  });
  const sy = y + 352 + 3 * 68;
  cap(ctx, 'Session', 60, sy);
  let cx = PW - 60;
  ['NEW YORK', 'LONDON', 'ASIA'].forEach((s) => {
    const font = f(500, 19, MONO), w = measure(ctx, s, font, 2.5) + 34, on = s === 'LONDON';
    cx -= w;
    ctx.fillStyle = on ? C.chip : 'rgba(4,18,26,0.6)'; ctx.fillRect(cx, sy - 34, w, 50);
    ctx.strokeStyle = on ? C.cyan : C.line2; ctx.lineWidth = 2; ctx.strokeRect(cx, sy - 34, w, 50);
    text(ctx, s, cx + w / 2, sy - 1, { font, spacing: 2.5, align: 'center', fill: on ? C.cyan : C.muted });
    cx -= 14;
  });
  // buy and sell trades, total lots
  panel(ctx, 26, 956, PW - 52, 130);
  [['1', 'Buy trades', C.good], ['3', 'Sell trades', C.good], ['0.05', 'Total lots', C.mint]].forEach(([v, k, col], i) => {
    const x = 60 + i * 210;
    text(ctx, v, x, 1018, { font: f(800, 44, DISPLAY), fill: col });
    cap(ctx, k, x, 1060, { spacing: 2 });
  });
  // the bar at the bottom of Home
  const bw = (PW - 68) / 2;
  btn(ctx, 26, 1104, bw, 84, 'Active', 'go', true);
  btn(ctx, 42 + bw, 1104, bw, 84, 'Pause', 'hold', false);
}

// the trades of the example cycle as the chart shows them: open ones with their tag, closed ones as a profit
const OPEN = [
  { side: 'sell', lvl: 1, lot: 0.01, bar: 3, p: 0, dy: 0 },
  { side: 'sell', lvl: 2, lot: 0.01, bar: 12, p: 3, dy: 0 },
  { side: 'buy', lvl: 3, lot: 0.01, bar: 22, p: 6, dy: -25 },
  { side: 'sell', lvl: 3, lot: 0.02, bar: 22, p: 6, dy: 25 },
];
const CLOSED = [{ bar: 8, p: 1, lab: '+1.00$ TP' }, { bar: 16, p: 4, lab: '+1.00$ TP' }];
const KEYP = [[0, -0.4], [3, 0], [8, 1.1], [12, 3.0], [16, 4.1], [22, 6.0], [26, 6.5], [30, 4.4], [33, 2.9]];
function pathAt(x) {
  let i = 0;
  while (i < KEYP.length - 2 && x > KEYP[i + 1][0]) i++;
  const [a, pa] = KEYP[i], [b, pb] = KEYP[i + 1];
  return lerp(pa, pb, E.inOutSine(clamp((x - a) / (b - a))));
}
function tri(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 15, y - 9); ctx.lineTo(x + 15, y + 9); ctx.closePath(); ctx.fill();
}
function tradesTab(ctx, t) {
  // the status card
  hud(ctx, 26, 0, PW - 52, 250, { fill: '#061c26', cut: 22, arm: 90, accent: C.neon, border: C.frame, tick: 4, glow: 10 });
  const cx = 150, cy = 125, R = 82;
  ctx.save();
  ctx.lineWidth = 12; ctx.strokeStyle = '#123644';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const arc = tick(0, 3 / 15, t, 6.55, 7.0);
  ctx.strokeStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + arc * Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.lineCap = 'butt';
  ctx.setLineDash([5, 10]); ctx.lineDashOffset = -t * 30; ctx.lineWidth = 3; ctx.strokeStyle = C.frame;
  ctx.beginPath(); ctx.arc(cx, cy, R - 22, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  text(ctx, 'L3', cx, cy + 16, { font: f(800, 54, DISPLAY), align: 'center' });
  text(ctx, 'OF 15', cx, cy + 46, { font: f(500, 16, MONO), spacing: 3, align: 'center', fill: C.muted });
  const px = 290;
  ctx.save(); ctx.fillStyle = C.good; ctx.shadowColor = C.good; ctx.shadowBlur = 12 + 8 * Math.sin(t * 9);
  ctx.beginPath(); ctx.arc(px + 9, 62, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  text(ctx, 'ACTIVE', px + 30, 73, { font: f(700, 32, DISPLAY), spacing: 2, fill: C.good });
  cap(ctx, 'Risk', px, 118); text(ctx, 'SAFE', px, 154, { font: f(700, 30, DISPLAY), fill: C.good });
  cap(ctx, 'Next entry', px, 196); text(ctx, `▲ ${money(START + 7.43)} (0.03)`, px, 234, { font: f(700, 30, DISPLAY) });

  // the grid ladder
  const ly = 270;
  panel(ctx, 26, ly, PW - 52, 650, 'Grid ladder');
  cutRect(ctx, 292, ly + 22, 150, 46, 8); ctx.fillStyle = '#0a2330'; ctx.fill(); ctx.strokeStyle = C.frame; ctx.lineWidth = 2; ctx.stroke();
  ctx.save(); ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(318, ly + 45, 13, 8, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(318, ly + 45, 3.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  text(ctx, 'HISTORY', 390, ly + 52, { font: f(600, 17, MONO), spacing: 2, align: 'center', fill: C.cyan });
  cutRect(ctx, 454, ly + 22, 190, 46, 8); ctx.fillStyle = '#0a2330'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.chip; ctx.fillRect(458, ly + 26, 104, 38);
  text(ctx, 'CANDLES', 510, ly + 52, { font: f(600, 16, MONO), spacing: 1.5, align: 'center', fill: C.cyan });
  text(ctx, 'LINE', 603, ly + 52, { font: f(600, 16, MONO), spacing: 1.5, align: 'center', fill: C.muted });
  const x0 = 50, x1 = 420, tagX = 432, axisX = PW - 50, y0 = ly + 100, y1 = ly + 560;
  const lo = START - 1.6, hi = START + 7.6, Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
  for (let v = Math.ceil(lo); v <= hi; v++) {
    ctx.fillStyle = 'rgba(31,182,214,0.08)'; ctx.fillRect(x0, Y(v), 516, 1.5);
    text(ctx, money(v), axisX, Y(v) + 6, { font: f(500, 17, MONO), align: 'right', fill: C.muted });
  }
  // the next entry, dashed, as in the app
  const ny = Y(START + 7.43);
  ctx.save(); ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(243,251,255,0.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1 + 120, ny); ctx.stroke(); ctx.restore();
  text(ctx, `NEXT ${money(START + 7.43)}`, x0 + 4, ny - 9, { font: f(500, 17, MONO), fill: C.body });
  // candles: they fill in as the tab opens, the last one follows the price
  const n = 34, cw = (x1 - x0) / n, X = (i) => x0 + cw * (i + 0.5);
  const shown = Math.floor(lerp(12, n, E.outCubic(seg(t, 6.5, 7.15))));
  for (let i = 0; i < shown; i++) {
    const o = START + pathAt(i - 0.5) + (hash(i, 3) - 0.5) * 0.5;
    const c = i === n - 1 ? nowPrice(t) : START + pathAt(i + 0.5) + (hash(i, 4) - 0.5) * 0.5;
    const hv = Math.max(o, c) + hash(i, 6) * 0.45, lv = Math.min(o, c) - hash(i, 7) * 0.45, col = c >= o ? C.good : C.bad;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(i), Y(hv)); ctx.lineTo(X(i), Y(lv)); ctx.stroke();
    ctx.fillRect(X(i) - cw * 0.3, Y(Math.max(o, c)), cw * 0.6, Math.max(2, Math.abs(Y(o) - Y(c))));
  }
  // closed trades: a dot and the profit, like the app's history
  CLOSED.forEach((h) => {
    const k = E.outCubic(seg(t, 6.9 + h.bar * 0.004, 7.15 + h.bar * 0.004));
    if (k <= 0 || shown <= h.bar) return;
    ctx.save(); ctx.globalAlpha *= k; ctx.fillStyle = C.good; ctx.shadowColor = C.good; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(X(h.bar), Y(START + h.p), 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    text(ctx, h.lab, X(h.bar) - 6, Y(START + h.p) - 16, { font: f(600, 18, MONO), align: 'center', fill: C.good, alpha: k });
  });
  // open trades: ◀ on the candle it opened on, a dashed line, and its tag
  OPEN.forEach((o) => {
    if (shown <= o.bar) return;
    const k = E.outBack(seg(t, 6.75 + o.bar * 0.008, 7.0 + o.bar * 0.008));
    const col = o.side === 'buy' ? C.buy : C.warn, x = X(o.bar), y = Y(START + o.p);
    ctx.save(); ctx.globalAlpha *= clamp(k);
    ctx.setLineDash([7, 6]); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.8;
    ctx.beginPath(); ctx.moveTo(x + 15, y); ctx.lineTo(tagX, y); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalAlpha *= clamp(k); tri(ctx, x, y, col); ctx.restore();
    const ty = y + o.dy;
    ctx.save(); ctx.translate(tagX + 56, ty); ctx.scale(Math.max(0.001, k), Math.max(0.001, k));
    cutRect(ctx, -56, -19, 112, 38, 8); ctx.fillStyle = 'rgba(4,16,24,0.96)'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, `L${o.lvl} ${o.lot.toFixed(2)}`, 0, 7, { font: f(600, 18, MONO), align: 'center', fill: col });
    ctx.restore();
  });
  // the price now
  const now = nowPrice(t), py = Y(now);
  ctx.save(); ctx.setLineDash([4, 6]); ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(X(n - 1), py); ctx.lineTo(axisX - 96, py); ctx.stroke(); ctx.restore();
  cutRect(ctx, axisX - 96, py - 18, 100, 36, 6); ctx.fillStyle = C.cyan; ctx.fill();
  text(ctx, money(now), axisX - 46, py + 6, { font: f(600, 17, MONO), align: 'center', fill: C.on });
  // the legend
  const gy = y1 + 54;
  tri(ctx, 56, gy - 6, C.buy); text(ctx, 'BUY', 80, gy, { font: f(500, 17, MONO), spacing: 2, fill: C.muted });
  tri(ctx, 150, gy - 6, C.warn); text(ctx, 'SELL', 174, gy, { font: f(500, 17, MONO), spacing: 2, fill: C.muted });
  ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(256, gy - 6, 6, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'CLOSED', 272, gy, { font: f(500, 17, MONO), spacing: 2, fill: C.muted });
  text(ctx, 'M1 CHART', 390, gy, { font: f(500, 17, MONO), spacing: 2, fill: C.muted });

  // both baskets
  const by = ly + 670;
  panel(ctx, 26, by, PW - 52, 300, 'Baskets');
  [['Buy side', C.buy, sidePL(t, 'buy'), '1 TRADE', '0.01 LOTS'], ['Sell side', C.sell, sidePL(t, 'sell'), '3 TRADES', '0.04 LOTS']].forEach(([k, col, pl, a, b], i) => {
    const x = 60 + i * 300;
    cap(ctx, k, x, by + 100, { fill: col });
    text(ctx, `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}$`, x, by + 150, { font: f(700, 42, DISPLAY), fill: pl >= 0 ? C.good : C.bad });
    text(ctx, a, x, by + 192, { font: f(500, 17, MONO), spacing: 1.5, fill: C.muted });
    text(ctx, b, x + 270, by + 192, { font: f(500, 17, MONO), spacing: 1.5, align: 'right', fill: C.muted });
    ctx.fillStyle = '#0e2f3e'; ctx.fillRect(x, by + 212, 270, 8);
    const fill = clamp(pl / BASKET);
    if (fill > 0) { ctx.fillStyle = C.good; ctx.fillRect(x, by + 212, 270 * fill, 8); }
  });
}

function controlTab(ctx, t) {
  panel(ctx, 26, 0, PW - 52, 300, 'Bot state');
  const paused = t >= AT.pause && t < AT.resume, bw = (PW - 52 - 60 - 32) / 3;
  btn(ctx, 56, 80, bw, 84, 'Active', 'go', !paused);
  btn(ctx, 56 + bw + 16, 80, bw, 84, 'Pause', 'hold', paused);
  btn(ctx, 56 + (bw + 16) * 2, 80, bw, 84, 'Finish', 'danger', false);
  text(ctx, 'Pause stops new trades; open baskets are still managed.', 56, 214, { font: f(400, 21, SANS), fill: C.body });
  text(ctx, 'Finish lets the running cycle end, then the bot stays idle.', 56, 246, { font: f(400, 21, SANS), fill: C.body });
  tap(ctx, t, AT.pause, 56 + bw * 1.5 + 16, 122);
  tap(ctx, t, AT.resume, 56 + bw / 2, 122);
  panel(ctx, 26, 320, PW - 52, 210, 'Lot mode (starts with the next cycle)');
  const sx = 56, sw = PW - 112, part = sw / 3, sy = 396;
  cutRect(ctx, sx, sy, sw, 92, 14); ctx.fillStyle = '#04121a'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2; ctx.stroke();
  const pos = E.spring(seg(t, AT.smart, AT.smart + 0.44));
  ctx.save();
  cutRect(ctx, sx + 6 + pos * part, sy + 6, part - 12, 80, 12); ctx.fillStyle = C.chip; ctx.fill();
  ctx.strokeStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 12; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = C.neon; ctx.shadowColor = C.neon; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx + 7 + pos * part, sy + 34); ctx.lineTo(sx + 7 + pos * part, sy + 18); ctx.lineTo(sx + 18 + pos * part, sy + 7); ctx.lineTo(sx + 34 + pos * part, sy + 7); ctx.stroke();
  ctx.restore();
  ['Basic', 'Smart', 'Risk'].forEach((s, i) => text(ctx, s.toUpperCase(), sx + part * i + part / 2, sy + 58, { font: f(700, 29, DISPLAY), spacing: 2, align: 'center', fill: Math.round(pos) === i ? C.cyan : C.muted }));
  tap(ctx, t, AT.smart, sx + part * 1.5, sy + 46);
  panel(ctx, 26, 550, PW - 52, 340, 'Cooldown');
  cap(ctx, 'Now', 60, 650); text(ctx, 'no cooldown', PW - 60, 652, { font: f(700, 29, DISPLAY), align: 'right' });
  ['+1 min', '+5 min', '+30 min'].forEach((s, i) => btn(ctx, 56 + i * (bw + 16), 690, bw, 76, s, 'plain', false));
  btn(ctx, 56, 784, PW - 112, 76, 'Cancel cooldown', 'plain', false);
  panel(ctx, 26, 910, PW - 52, 330, 'Force close');
  btn(ctx, 56, 986, (PW - 128) / 2, 80, 'Close buy', 'danger', false);
  btn(ctx, 72 + (PW - 128) / 2, 986, (PW - 128) / 2, 80, 'Close sell', 'danger', false);
  btn(ctx, 56, 1082, PW - 112, 80, 'Close all + pause', 'danger', false);
}

function settingsView(ctx, t) {
  panel(ctx, 26, 96, PW - 52, 740, 'Strategy');
  const tp = lerp(1.0, 1.5, E.outQuart(seg(t, AT.tp - 0.02, AT.tp + 0.28)));
  const a = slider(ctx, 206, 'Take profit', `price move per trade = ${Math.round(tp * 100)} points`, `${tp.toFixed(2)}$`, (tp - 0.1) / 4.9, '0.1', '5');
  tap(ctx, t, AT.tp, a.x, a.y);
  sep(ctx, 322);
  label2(ctx, 380, 'Grid distance', 'points after a TP hit'); field(ctx, PW - 230, 348, 170, 70, '200');
  sep(ctx, 444);
  slider(ctx, 500, 'Basket profit', '$ to close a whole side', `${BASKET.toFixed(2)}$`, (BASKET - 0.1) / 9.9, '0.1', '10');
  sep(ctx, 616);
  label2(ctx, 672, 'Max grid levels', 'pairs per cycle'); field(ctx, PW - 230, 640, 170, 70, '15');
  sep(ctx, 736);
  label2(ctx, 790, 'Cooldown', 'seconds after a cycle'); field(ctx, PW - 230, 758, 170, 70, '20');
  panel(ctx, 26, 856, PW - 52, 420, 'Lots');
  label2(ctx, 954, 'Basic lot list', 'one lot per grid level, separated by commas');
  field(ctx, 56, 1006, PW - 112, 72, '0.01, 0.01, 0.02, 0.03', true);
  sep(ctx, 1100);
  label2(ctx, 1152, 'Only the holding side grows', 'the TP side stays at base lot'); toggle(ctx, PW - 152, 1128);
}
// the Report: this week, then by week over the month
const WEEKS = [{ day: 'W1', v: 48.2 }, { day: 'W2', v: 61.75 }, { day: 'W3', v: 52.9 }, { day: 'W4', v: 66.31 }, { day: 'NOW', v: WEEK_TOTAL, now: true }];
function reportView(ctx, t) {
  panel(ctx, 26, 96, PW - 52, 372, 'Today');
  [['Closed profit', '+14.43$', C.good], ['Max drawdown', '-1.20%', C.bad], ['TP hits', '12', C.text], ['Baskets closed', '1', C.text], ['Cycles closed', '3', C.text], ['Trades opened', '19', C.text]]
    .forEach(([k, v, col], i) => stat(ctx, i, 196, k, v, col, 96));
  const month = seg(t, AT.month, AT.month + 0.3), m = month >= 0.5;
  panel(ctx, 26, 488, PW - 52, 700, m ? 'Closed profit by week ($)' : 'Closed profit this week ($)');
  // the range switch
  const rw = (PW - 112) / 4, glide = lerp(0, 2, E.outExpo(month));
  cutRect(ctx, 56, 560, PW - 112, 70, 10); ctx.fillStyle = '#04121a'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.chip; ctx.fillRect(60 + rw * glide, 564, rw - 8, 62);
  ctx.fillStyle = C.neon; ctx.fillRect(66 + rw * glide, 622, rw - 20, 4);
  ['This week', 'Last week', 'Month', 'All time'].forEach((s, i) => text(ctx, s.toUpperCase(), 56 + rw * i + rw / 2, 604, { font: f(600, 17, MONO), spacing: 1, align: 'center', fill: i === (m ? 2 : 0) ? C.cyan : C.muted }));
  tap(ctx, t, AT.month - 0.02, 56 + rw * 2.5, 595);
  // the columns
  const base = 900, room = 150, bx0 = 70, bx1 = PW - 70;
  ctx.fillStyle = '#123644'; ctx.fillRect(bx0, base, bx1 - bx0, 2);
  const columns = (list, slots, since, alpha) => {
    const max = Math.max(...list.map((d) => d.v)), cw = (bx1 - bx0) / slots;
    for (let i = 0; i < slots; i++) {
      const d = list[i], x = bx0 + cw * i + cw / 2;
      text(ctx, d ? d.day : ['SAT', 'SUN'][i - list.length], x, base + 34, { font: f(600, 17, MONO), align: 'center', fill: d ? (d.now ? C.cyan : C.body) : '#3d5a66', alpha });
      if (!d) continue;
      const k = E.outCubic(seg(since, i * 0.05, i * 0.05 + 0.35)), h = (d.v / max) * room * k;
      ctx.save(); ctx.globalAlpha *= alpha;
      ctx.fillStyle = d.now ? C.cyan : '#1597b5'; if (d.now) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 12; }
      ctx.fillRect(x - cw * 0.3, base - h, cw * 0.6, h);
      ctx.restore();
      if (k > 0.05) text(ctx, d.v.toFixed(2), x, base - h - 12, { font: f(600, 17, MONO), align: 'center', fill: C.text, alpha: alpha * k });
    }
  };
  if (month < 1) columns(WEEK.map((d, i) => ({ day: i === WEEK.length - 1 ? 'TODAY' : d.day, v: d.v, now: i === WEEK.length - 1 })), 7, t - AT.report - 0.06, 1 - month);
  if (month > 0) columns(WEEKS, 5, t - AT.month - 0.05, month);
  sep(ctx, 966);
  const vals = WEEK.map((d) => d.v), monthTotal = WEEKS.reduce((s, d) => s + d.v, 0);
  (m ? [['Total', monthTotal], ['Average a week', monthTotal / WEEKS.length], ['Best week', Math.max(...WEEKS.map((d) => d.v))], ['Worst week', Math.min(...WEEKS.map((d) => d.v))]]
    : [['Total', WEEK_TOTAL], ['Average a day', WEEK_TOTAL / WEEK.length], ['Best day', Math.max(...vals)], ['Worst day', Math.min(...vals)]])
    .forEach(([k, v], i) => stat(ctx, i, 1016, k, `+${v.toFixed(2)}$`, C.good, 92));
}
function toolsTab(ctx, t) {
  const tw = (PW - 52) / 4, sub = t >= AT.report ? 2 : 0, glide = lerp(0, 2, E.outExpo(seg(t, AT.report, AT.report + 0.25)));
  cutRect(ctx, 26, 0, PW - 52, 76, 12); ctx.fillStyle = '#071922'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.chip; ctx.fillRect(30 + tw * glide, 4, tw - 8, 68);
  ctx.fillStyle = C.neon; ctx.fillRect(38 + tw * glide, 68, tw - 24, 4);
  ['Settings', 'Risk calc', 'Report', 'Account'].forEach((s, i) => text(ctx, s.toUpperCase(), 26 + tw * i + tw / 2, 47, { font: f(600, 18, MONO), spacing: 2, align: 'center', fill: i === sub ? C.cyan : C.muted }));
  // the view under the bar slides like the app's
  const k = E.outExpo(seg(t, AT.report, AT.report + 0.28));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 88, PW, PH); ctx.clip();
  if (k < 1) { ctx.save(); ctx.translate(-PW * 0.3 * k, 0); ctx.globalAlpha *= 1 - k; settingsView(ctx, t); ctx.restore(); }
  if (k > 0) { ctx.save(); ctx.translate(PW * (1 - k), 0); reportView(ctx, t); ctx.restore(); }
  ctx.restore();
  tap(ctx, t, AT.report - 0.02, 26 + tw * 2.5, 38);
}
const DRAW = [homeTab, tradesTab, controlTab, toolsTab];
function drawPhone(ctx, t) {
  ctx.save();
  ctx.clearRect(0, 0, PW, PH);
  rrect(ctx, 0, 0, PW, PH, 64); ctx.clip();
  ctx.fillStyle = '#030c13'; ctx.fillRect(0, 0, PW, PH);
  ctx.strokeStyle = 'rgba(25,211,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x < PW; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PH); ctx.stroke(); }
  for (let y = 0; y < PH; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); }
  text(ctx, '9:41', 60, 52, { font: f(600, 24, SANS), fill: C.body });
  text(ctx, '5G', PW - 60, 52, { font: f(600, 20, SANS), align: 'right', fill: C.body });
  ctx.fillStyle = '#000'; rrect(ctx, PW / 2 - 70, 16, 140, 38, 19); ctx.fill();
  text(ctx, 'RZGS-PRO.BOT', 40, 128, { font: f(700, 44, DISPLAY), spacing: 1 });
  text(ctx, '#10012345 | XAUUSD', 40, 164, { font: f(400, 22, MONO), spacing: 1, fill: C.muted });
  ctx.save(); ctx.fillStyle = C.good; ctx.shadowColor = C.good; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(PW - 196, 116, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  text(ctx, 'LIVE', PW - 178, 124, { font: f(600, 22, MONO), spacing: 3, fill: C.body });
  cutRect(ctx, PW - 106, 84, 66, 66, 14); ctx.fillStyle = '#071922'; ctx.fill(); ctx.strokeStyle = C.line2; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = C.body;
  ctx.beginPath(); ctx.arc(PW - 73, 120, 15, -Math.PI * 0.32, Math.PI * 1.32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PW - 73, 100); ctx.lineTo(PW - 73, 118); ctx.stroke();
  // the tab of the moment, sliding in from the right; a short fade when the tour starts again
  const i = tabAt(t), at = TABS[i].at, slide = E.outExpo(seg(t, at, at + 0.28));
  ctx.save();
  ctx.beginPath(); ctx.rect(0, TOP, PW, PH - TOP - DOCK_H); ctx.clip();
  ctx.globalAlpha = seg(t, TABS[0].at, TABS[0].at + 0.12) * (1 - seg(t, AT.end - 0.12, AT.end));
  if (i > 0 && slide < 1) { ctx.save(); ctx.translate(-PW * slide, TOP); ctx.globalAlpha *= 1 - slide; DRAW[i - 1](ctx, at - 0.001); ctx.restore(); }
  ctx.save(); ctx.translate(i > 0 ? PW * (1 - slide) : 0, TOP); DRAW[i](ctx, t); ctx.restore();
  ctx.restore();
  // the dock, as in the app: Home (a house), Trades, Control (a hexagon), Tools (sliders), Log
  const dy = PH - DOCK_H;
  ctx.fillStyle = 'rgba(4,14,20,0.98)'; ctx.fillRect(0, dy, PW, DOCK_H);
  ctx.fillStyle = C.line2; ctx.fillRect(0, dy, PW, 2);
  const active = TAB_INDEX[TABS[i].id];
  const glide = i > 0 ? lerp(TAB_INDEX[TABS[i - 1].id], active, E.outExpo(seg(t, at - 0.05, at + 0.2))) : active;
  const cell = PW / 5;
  ctx.save(); ctx.fillStyle = C.neon; ctx.shadowColor = C.neon; ctx.shadowBlur = 12;
  ctx.fillRect(cell * glide + 10, dy, cell - 20, 5); ctx.restore();
  DOCK.forEach((s, j) => {
    const x = cell * j + cell / 2, on = j === active, col = on ? C.cyan : C.muted, cy = dy + 54;
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    if (j === 0) { ctx.beginPath(); ctx.moveTo(x - 20, cy - 2); ctx.lineTo(x, cy - 19); ctx.lineTo(x + 20, cy - 2); ctx.moveTo(x - 15, cy - 6); ctx.lineTo(x - 15, cy + 18); ctx.lineTo(x + 15, cy + 18); ctx.lineTo(x + 15, cy - 6); ctx.moveTo(x - 5, cy + 18); ctx.lineTo(x - 5, cy + 6); ctx.lineTo(x + 5, cy + 6); ctx.lineTo(x + 5, cy + 18); ctx.stroke(); }
    if (j === 1) { ctx.beginPath(); ctx.moveTo(x, cy - 20); ctx.lineTo(x, cy + 20); ctx.moveTo(x - 18, cy - 12); ctx.lineTo(x - 6, cy - 12); ctx.moveTo(x - 18, cy); ctx.lineTo(x - 6, cy); ctx.moveTo(x + 6, cy - 4); ctx.lineTo(x + 18, cy - 4); ctx.moveTo(x + 6, cy + 8); ctx.lineTo(x + 18, cy + 8); ctx.stroke(); }
    if (j === 2) { ctx.beginPath(); for (let a = 0; a < 6; a++) { const ang = -Math.PI / 2 + (a * Math.PI) / 3; const px = x + Math.cos(ang) * 20, py = cy + Math.sin(ang) * 20; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(x, cy, 6, 0, Math.PI * 2); ctx.stroke(); }
    if (j === 3) { ctx.beginPath(); ctx.moveTo(x - 20, cy - 10); ctx.lineTo(x + 20, cy - 10); ctx.moveTo(x - 20, cy + 10); ctx.lineTo(x + 20, cy + 10); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 6, cy - 10, 6, 0, Math.PI * 2); ctx.arc(x - 6, cy + 10, 6, 0, Math.PI * 2); ctx.fill(); }
    if (j === 4) { for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.moveTo(x - 10, cy - 14 + r * 14); ctx.lineTo(x + 20, cy - 14 + r * 14); ctx.stroke(); ctx.fillRect(x - 22, cy - 16 + r * 14, 4, 4); } }
    ctx.restore();
    text(ctx, s.toUpperCase(), x, dy + 114, { font: f(600, 19, MONO), spacing: 2, align: 'center', fill: col });
  });
  for (let j = 1; j < TABS.length; j++) tap(ctx, t, TABS[j].at - 0.06, cell * TAB_INDEX[TABS[j].id] + cell / 2, dy + 60);
  // the app's toast after a change from the phone
  const toast = E.outExpo(seg(t, AT.toast, AT.toast + 0.12)) * (1 - seg(t, AT.toast + 0.3, AT.toast + 0.4));
  if (toast > 0) {
    ctx.save(); ctx.globalAlpha = toast;
    cutRect(ctx, 80, dy - 110 + (1 - toast) * 40, PW - 160, 76, 14); ctx.fillStyle = C.neon; ctx.shadowColor = C.neon; ctx.shadowBlur = 20; ctx.fill();
    ctx.shadowBlur = 0;
    text(ctx, '✓ Sent · the bot confirmed', PW / 2, dy - 62 + (1 - toast) * 40, { font: f(700, 27, SANS), align: 'center', fill: C.on });
    ctx.restore();
  }
  ctx.restore();
}

// ---- 3D helpers --------------------------------------------------------------------------------------
let THREE = null;
const col = (hex) => new THREE.Color(hex);
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const additive = (map, color, opacity = 1) => new THREE.SpriteMaterial({ map, color: col(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
function gradientColors(count, stops) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0 : i / (count - 1), s = k * (stops.length - 1), a = Math.floor(s), b = Math.min(stops.length - 1, a + 1);
    out.push(stops[a].clone().lerp(stops[b], s - a));
  }
  return out;
}
// a gradient tube along a curve, plus a wider, faint copy of it: the glow the video got from bloom
function glowTube(curve, samples, radius, stops) {
  const make = (r, opacity, blending) => {
    const geo = new THREE.TubeGeometry(curve, samples, r, 8, false);
    const cs = gradientColors(samples + 1, stops), arr = [];
    for (let i = 0; i <= samples; i++) for (let j = 0; j <= 8; j++) arr.push(cs[i].r, cs[i].g, cs[i].b);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, blending, depthWrite: opacity >= 1 }));
  };
  return [make(radius, 1, THREE.NormalBlending), make(radius * 3.2, 0.16, THREE.AdditiveBlending)];
}
// the grid floor of the video: thin cyan lines every 2, lime ones every 10, fading with distance
function gridFloor(size, y) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uA: { value: col(C.frame) }, uB: { value: col(C.neon) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uA; uniform vec3 uB; varying vec3 vW;
      float line(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){ float d = distance(vW.xz, cameraPosition.xz); float fade = exp(-d * 0.045);
        float a = line(vW.xz, 2.0) * 0.3, b = line(vW.xz, 10.0) * 0.5;
        gl_FragColor = vec4(uA * a + uB * b, max(a, b) * fade); }`,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  return floor;
}
function dust(n, box, seed) {
  const r = rng(seed), pos = new Float32Array(n * 3), cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (r() - 0.5) * box[0]; pos[i * 3 + 1] = (r() - 0.3) * box[1]; pos[i * 3 + 2] = (r() - 0.5) * box[2];
    const c = r() < 0.2 ? col(C.neon) : col(C.cyan);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
}
// a slab with rounded corners (in place of the add-on RoundedBoxGeometry, which needs an import map)
function roundedSlab(w, h, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -d / 2);
  return g;
}
// the camera distance at which a w x h box fits the view with a margin
function fitDistance(camera, w, h, margin = 1.08) {
  const v = THREE.MathUtils.degToRad(camera.fov) / 2, hz = Math.atan(Math.tan(v) * camera.aspect);
  return Math.max((w * margin) / 2 / Math.tan(hz), (h * margin) / 2 / Math.tan(v));
}
// how big the 2D labels are drawn: a stage 820 px wide is the measure
const unit = (S) => clamp(S.w / 820, 0.62, 1.12);

// ---- 1. the strategy ---------------------------------------------------------------------------------
function buildStrategy(S) {
  const { scene, camera } = S;
  const glow = glowTexture();
  const chart = new THREE.Group();
  scene.add(chart);
  // one flat board: the stage's own frame is its border, and the price grid runs to its edges
  const panelW = 17.2, panelH = 9.6;
  const edge = (w, h, x, y, color, opacity = 1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity }));
    m.position.set(x, y, 0.02);
    chart.add(m);
    return m;
  };
  for (let p = -4; p <= 10; p++) edge(60, 0.012, 0, chartY(p), C.frame, 0.16);
  for (let x = -30; x <= 30; x += 2) edge(0.012, 40, x, 0, C.frame, 0.08);
  // the price, as a glowing tube that draws itself
  const SAMPLES = 600, pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = CHART.t0 + (i / SAMPLES) * (CHART.t1 - CHART.t0);
    pts.push(new THREE.Vector3(chartX(t), chartY(priceAt(t)), 0.12));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const tubes = glowTube(curve, SAMPLES, 0.065, [col(C.cyan), col(C.mint), col(C.neon)]);
  chart.add(...tubes);
  const area = new THREE.BufferGeometry();
  {
    const pos = [], cols = [], idx = [], bottom = -panelH / 2 + 0.3, cs = gradientColors(SAMPLES + 1, [col(C.cyan), col(C.mint), col(C.neon)]);
    for (let i = 0; i <= SAMPLES; i++) {
      pos.push(pts[i].x, pts[i].y, 0.06, pts[i].x, bottom, 0.06);
      cols.push(cs[i].r, cs[i].g, cs[i].b, 0.3, cs[i].r, cs[i].g, cs[i].b, 0.0);
      if (i < SAMPLES) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    area.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    area.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    area.setIndex(idx);
  }
  chart.add(new THREE.Mesh(area, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const headGlow = new THREE.Sprite(additive(glow, C.mint, 0.9)); headGlow.scale.set(1.8, 1.8, 1);
  chart.add(head, headGlow);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(0.04, panelH - 0.6), new THREE.MeshBasicMaterial({ color: col(C.cyan), transparent: true, opacity: 0.3, depthWrite: false }));
  scan.position.z = 0.05;
  chart.add(scan);
  // trades: a marker, its level line, and for a buy its take profit line
  const trades = TRADES.map((tr) => {
    const color = tr.side === 'buy' ? C.buy : C.sell;
    const x = chartX(tr.at), y = chartY(tr.p) + (tr.side === 'buy' ? 0.3 : -0.3);
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), new THREE.MeshBasicMaterial({ color: col(color), transparent: true }));
    marker.position.set(x, y, 0.2);
    const markerGlow = new THREE.Sprite(additive(glow, color, 0.5)); markerGlow.scale.set(0.9, 0.9, 1);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.3, 0.025), new THREE.MeshBasicMaterial({ color: col(color), transparent: true }));
    stem.position.set(x, (y + chartY(tr.p)) / 2, 0.18);
    const len = panelW / 2 - 0.35 - x;
    const level = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity: 0.75 }));
    level.position.set(x + len / 2, chartY(tr.p), 0.15);
    level.userData = { x, len };
    chart.add(marker, markerGlow, stem, level);
    let tpLine = null;
    if (tr.side === 'buy') {
      tpLine = new THREE.Group();
      for (let d = 0; d < 24; d++) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: col(C.good), transparent: true, opacity: 0.8 }));
        dash.position.set(x + 0.2 + d * 0.4, chartY(tr.p + TP), 0.15);
        tpLine.add(dash);
      }
      chart.add(tpLine);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.0, 64), new THREE.MeshBasicMaterial({ color: col(tr.side === 'buy' ? C.good : C.neon), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(x, chartY(tr.p), 0.22);
    chart.add(ring);
    return { tr, marker, markerGlow, stem, level, tpLine, ring, color };
  });
  // the basket: lightning to one point, then a burst and a shock ring
  const bolts = TRADES.filter((tr) => tr.side === 'sell').map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col(C.neon), transparent: true }));
    chart.add(line);
    return line;
  });
  const BURST = 200, burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST * 3), 3));
  {
    const cs = new Float32Array(BURST * 3), palette = [C.neon, C.mint, C.cyan, '#ffffff'].map(col);
    for (let i = 0; i < BURST; i++) { const c = palette[i % 4]; cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; }
    burstGeo.setAttribute('color', new THREE.BufferAttribute(cs, 3));
  }
  const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({ size: 0.16, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  chart.add(burst);
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 96), new THREE.MeshBasicMaterial({ color: col(C.neon), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  chart.add(shock);
  const core = new THREE.Vector3(chartX(BASKET_AT), chartY(priceAt(BASKET_AT)), 0.25);
  const tmp = new THREE.Vector3();

  // the four steps of the copy beside the stage
  const steps = [...(S.el.closest('.fx-row')?.querySelectorAll('[data-fx-step]') || [])];
  let lit = -1;
  // one cycle takes 5.2 seconds of the story; on the page it runs at half speed, then starts again
  const LOOP = 5.2, SPEED = 0.5;
  const story = (t) => 1.45 + ((t * SPEED) % LOOP);
  let s = 1.6;

  return {
    stillAt: (4.6 - 1.45) / SPEED,
    fit() {
      // seen straight on, with a narrow lens, so the board stays flat
      camera.fov = 22;
      S.dist = fitDistance(camera, panelW + 0.6, panelH + 1.6, 1.0);
      camera.position.set(0, 0, S.dist);
      camera.lookAt(0, 0, 0);
    },
    update(t) {
      s = story(t);
      const now = STEP_AT.reduce((n, at, i) => (s >= at ? i : n), 0);
      if (now !== lit) { lit = now; steps.forEach((li, i) => li.classList.toggle('is-on', i === now)); }
      const k = clamp((s - CHART.t0) / (CHART.t1 - CHART.t0));
      const segs = Math.max(1, Math.floor(k * SAMPLES));
      for (const m of tubes) m.geometry.setDrawRange(0, segs * 8 * 6);
      area.setDrawRange(0, segs * 6);
      const hp = pts[Math.min(SAMPLES, segs)];
      head.position.copy(hp); headGlow.position.copy(hp);
      head.visible = headGlow.visible = s >= CHART.t0;
      scan.position.x = hp.x;
      scan.material.opacity = s >= CHART.t0 && s < CHART.t1 ? 0.14 : 0;
      for (const o of trades) {
        const { tr } = o;
        const open = E.spring(seg(s, tr.at, tr.at + 0.45));
        const closeAt = tr.close?.at ?? Infinity;
        const gone = tr.close?.kind === 'basket' ? E.inCubic(seg(s, closeAt + 0.02, closeAt + 0.22)) : tr.close ? E.inCubic(seg(s, closeAt, closeAt + 0.25)) : 0;
        const shown = s >= tr.at && gone < 1;
        o.marker.visible = o.stem.visible = o.level.visible = o.markerGlow.visible = shown;
        o.marker.scale.setScalar(Math.max(0.0001, open * (1 - gone) * (1 + (tr.close?.kind === 'basket' ? 0.6 * seg(s, closeAt - 0.12, closeAt) : 0))));
        if (tr.close?.kind === 'tp' && s >= closeAt) o.marker.position.y = lerp(chartY(tr.p) + 0.3, chartY(tr.p + TP) + 0.15, E.outExpo(seg(s, closeAt, closeAt + 0.25)));
        else o.marker.position.y = chartY(tr.p) + (tr.side === 'buy' ? 0.3 : -0.3);
        o.markerGlow.position.copy(o.marker.position);
        o.markerGlow.material.opacity = 0.45 * open * (1 - gone);
        const flashWhite = tr.close?.kind === 'basket' ? 0.5 * seg(s, closeAt - 0.14, closeAt) : 0;
        o.marker.material.color.set(o.color).lerp(new THREE.Color(1, 1, 1), flashWhite);
        o.stem.scale.y = Math.max(0.0001, open);
        const wipe = E.outExpo(seg(s, tr.at + 0.05, tr.at + 0.5));
        o.level.scale.x = Math.max(0.0001, o.level.userData.len * wipe);
        o.level.position.x = o.level.userData.x + (o.level.userData.len * wipe) / 2;
        o.level.material.opacity = 0.75 * (1 - gone);
        o.level.material.color.set(o.color).lerp(new THREE.Color(1, 1, 1), flashWhite);
        if (o.tpLine) {
          const tk = E.outExpo(seg(s, tr.at + 0.1, tr.at + 0.5)), done = tr.close ? seg(s, closeAt, closeAt + 0.3) : 0;
          o.tpLine.visible = s >= tr.at && done < 1;
          o.tpLine.children.forEach((d, n) => { d.visible = n / 24 < tk; d.material.opacity = 0.85 * (1 - done) * (0.6 + 0.4 * Math.sin(s * 9 + n)); });
        }
        const rAt = tr.close?.kind === 'tp' && s >= closeAt ? closeAt : tr.at, rk = seg(s, rAt, rAt + 0.55);
        o.ring.visible = rk > 0 && rk < 1;
        o.ring.scale.setScalar(0.15 + 0.85 * E.outExpo(rk));
        o.ring.material.opacity = (1 - rk) * 0.7;
        o.ring.position.y = rAt === closeAt ? chartY(tr.p + TP) : chartY(tr.p);
      }
      const bt = s - BASKET_AT, sells = trades.filter((o) => o.tr.side === 'sell');
      bolts.forEach((line, n) => {
        const on = bt > -0.14 && bt < 0.12;
        line.visible = on;
        if (!on) return;
        const from = sells[n].marker.position, arr = line.geometry.attributes.position.array, fr = Math.floor(s * 60);
        for (let i = 0; i < 14; i++) {
          const k2 = i / 13, j = i === 0 || i === 13 ? 0 : 0.35;
          tmp.copy(from).lerp(core, k2);
          arr[i * 3] = tmp.x + (hash(fr * 31 + i, n + 3) - 0.5) * j;
          arr[i * 3 + 1] = tmp.y + (hash(fr * 31 + i, n + 9) - 0.5) * j;
          arr[i * 3 + 2] = 0.3;
        }
        line.geometry.attributes.position.needsUpdate = true;
      });
      const bk = seg(s, BASKET_AT, BASKET_AT + 1.0);
      burst.visible = bk > 0 && bk < 1;
      if (burst.visible) {
        const arr = burstGeo.attributes.position.array;
        for (let i = 0; i < BURST; i++) {
          const ang = hash(i, 71) * Math.PI * 2, b = (hash(i, 72) - 0.5) * Math.PI, v = 2 + hash(i, 73) * 6;
          const d = v * (1 - Math.exp(-4 * bk)) / 4;
          arr[i * 3] = core.x + Math.cos(ang) * Math.cos(b) * d;
          arr[i * 3 + 1] = core.y + Math.sin(b) * d - 1.2 * bk * bk;
          arr[i * 3 + 2] = core.z + Math.sin(ang) * Math.cos(b) * d * 0.6;
        }
        burstGeo.attributes.position.needsUpdate = true;
        burst.material.opacity = 1 - bk;
      }
      const sk = seg(s, BASKET_AT, BASKET_AT + 0.7);
      shock.visible = sk > 0 && sk < 1;
      shock.position.copy(core);
      shock.scale.setScalar(0.2 + 4.2 * E.outExpo(sk));
      shock.material.opacity = (1 - sk) * 0.6;
    },
    draw(ctx) {
      const u = unit(S), P = (x, y) => S.project(x, y, 0.2, chart);
      // trade labels, kept inside the board
      for (const o of trades) {
        const { tr } = o;
        if (s < tr.at + 0.08) continue;
        const closeAt = tr.close?.at ?? Infinity, gone = seg(s, closeAt, closeAt + 0.2);
        if (gone >= 1) continue;
        const p = P(chartX(tr.at), chartY(tr.p) + (tr.side === 'buy' ? 0.82 : -0.82));
        const lab = `${tr.side.toUpperCase()} L${tr.lvl}  ${tr.lot.toFixed(2)}`, size = 12 * u, half = (measure(ctx, lab, f(600, size, MONO), 1) + size * 1.4) / 2;
        pill(ctx, lab, clamp(p.x, half + 6, S.w - half - 6), p.y, o.color, E.outExpo(seg(s, tr.at + 0.08, tr.at + 0.35)) * (1 - gone), size);
      }
      // take profits: the gain rises from the take profit line
      for (const tr of TRADES) {
        if (tr.close?.kind !== 'tp') continue;
        const k = seg(s, tr.close.at, tr.close.at + 0.85);
        if (k <= 0 || k >= 1) continue;
        const p = P(chartX(tr.close.at), chartY(tr.p + TP) + 0.95);
        text(ctx, '+1.00$', p.x, p.y - k * 60 * u, { font: f(800, 30 * u, DISPLAY), align: 'center', fill: C.good, alpha: 1 - k * k, glow: C.good, glowSize: 14 });
        text(ctx, 'TAKE PROFIT', p.x, p.y - k * 60 * u + 20 * u, { font: f(600, 11 * u, MONO), spacing: 2, align: 'center', fill: C.good, alpha: 1 - k * k });
        ring2d(ctx, s, tr.close.at, p.x, p.y + 40 * u, 54 * u, C.good, 0.45, 3);
      }
      // the price at the head of the line
      if (s >= 1.6 && s < 5.4) {
        const p = P(chartX(s), chartY(priceAt(s)) + 0.5);
        const lab = money(START + priceAt(s)), font = f(600, 13 * u, MONO);
        text(ctx, lab, Math.min(p.x + 12 * u, S.w - measure(ctx, lab, font) - 8), p.y - 4, { font, fill: '#ffffff', alpha: 0.9 });   // kept inside the board
      }
      // BASKET CLOSED (smaller and calmer on a phone, and never on top of the cycle profit card)
      const bk = seg(s, BASKET_AT, BASKET_AT + 0.22);
      if (bk > 0 && s < BASKET_AT + 0.95) {
        const p = S.project(core.x, core.y, core.z, chart), e = E.outExpo(bk), fade = 1 - seg(s, BASKET_AT + 0.7, BASKET_AT + 0.95);
        const narrow = S.w < 560, pu = u * (narrow ? 0.78 : 1), bw = 330 * pu, bh = 74 * pu;
        const cardRight = (narrow ? 12 : 22) + 250 * clamp(S.w / 820, 0.5, 1.1), maxX = S.w - bw / 2 - 8;
        const zoom = lerp(narrow ? 1.12 : 1.5, 1, e);
        ctx.save();
        ctx.globalAlpha *= fade;
        ctx.translate(clamp(p.x, Math.min(cardRight + 8 + bw / 2, maxX), maxX), clamp(p.y - (narrow ? 76 : 100) * u, bh / 2 + 8, S.h - bh / 2 - 8));
        ctx.scale(zoom, zoom);
        cutRect(ctx, -bw / 2, -bh / 2, bw, bh, 12 * pu); ctx.fillStyle = 'rgba(3,12,19,0.9)'; ctx.fill();
        ctx.strokeStyle = C.neon; ctx.lineWidth = 2; ctx.shadowColor = C.neon; ctx.shadowBlur = narrow ? 10 : 20; ctx.stroke();
        text(ctx, 'BASKET CLOSED', 0, 2 * pu, { font: f(800, 30 * pu, DISPLAY), align: 'center', spacing: lerp(narrow ? 7 : 20, 3, e) * pu, fill: grad(ctx, -bw / 2.4, bw / 2.4), glow: 'rgba(166,255,26,0.6)', glowSize: narrow ? 10 : 18 });
        text(ctx, narrow ? '+6.00$  ·  3 sells closed' : '+6.00$  ·  3 sells closed together', 0, 25 * pu, { font: f(500, Math.max(9, 12 * pu), MONO), align: 'center', fill: C.body });
        ctx.restore();
      }
      // the cycle profit and the sell basket meter, top left (smaller on a phone, so the chart keeps its room)
      {
        const u = clamp(S.w / 820, 0.5, 1.1);
        const k = E.outExpo(seg(s, 1.75, 2.1)), bx = S.w > 560 ? 22 : 12, by = bx, bw = 250 * u, bh = 152 * u;
        ctx.save();
        ctx.globalAlpha *= k;
        hud(ctx, bx, by, bw, bh, { fill: 'rgba(3,16,24,0.9)', cut: 10 * u, arm: 22 * u });
        text(ctx, 'CYCLE PROFIT', bx + 16 * u, by + 26 * u, { font: f(500, 11 * u, MONO), spacing: 2, fill: C.muted });
        const cp = cycleProfit(s);
        let shown = cp;
        for (const tr of TRADES) if (tr.close?.kind === 'tp' && s >= tr.close.at && s < tr.close.at + 0.3) shown = lerp(cp - 1, cp, E.outCubic(seg(s, tr.close.at, tr.close.at + 0.3)));
        if (s >= BASKET_AT && s < BASKET_AT + 0.4) shown = lerp(cp - BASKET, cp, E.outCubic(seg(s, BASKET_AT, BASKET_AT + 0.4)));
        text(ctx, `+${shown.toFixed(2)}$`, bx + 16 * u, by + 68 * u, { font: f(800, 40 * u, DISPLAY), fill: grad(ctx, bx, bx + 200 * u), glow: 'rgba(55,239,184,0.5)', glowSize: 12 });
        // one take-profit chip that adds up, then the basket chip, so the row always fits the card
        const tps = TRADES.filter((tr) => tr.close?.kind === 'tp' && s >= tr.close.at), chips = [];
        if (tps.length) chips.push(['TP', tps[tps.length - 1].close.at, `+${(tps.length * TP).toFixed(2)}`, tps.length > 1]);
        if (s >= BASKET_AT) chips.push(['BASKET', BASKET_AT, `+${BASKET.toFixed(2)}`, false]);
        let px = bx + 16 * u;
        for (const [n, at, v, again] of chips) {
          const pk = again ? 1 + 0.25 * Math.sin(Math.PI * seg(s, at, at + 0.25)) : E.outBack(seg(s, at, at + 0.25));
          if (pk <= 0) continue;
          const lab = `${n} ${v}`, font = f(600, 10 * u, MONO), w = measure(ctx, lab, font, 1) + 12 * u;
          ctx.save(); ctx.translate(px + w / 2, by + 90 * u); ctx.scale(pk, pk);
          cutRect(ctx, -w / 2, -10 * u, w, 20 * u, 4 * u); ctx.fillStyle = n === 'TP' ? 'rgba(43,243,145,0.14)' : 'rgba(166,255,26,0.16)'; ctx.fill();
          text(ctx, lab, 0, 4 * u, { font, spacing: 1, align: 'center', fill: n === 'TP' ? C.good : C.neon });
          ctx.restore();
          px += w + 6 * u;
        }
        const sb = s < BASKET_AT ? Math.max(0, sellBasket(s)) : BASKET, mk = clamp(sb / BASKET);
        text(ctx, 'SELL BASKET', bx + 16 * u, by + 124 * u, { font: f(500, 10 * u, MONO), spacing: 1.5, fill: C.sell });
        text(ctx, `${sb.toFixed(2)} / ${BASKET.toFixed(2)}$`, bx + bw - 16 * u, by + 124 * u, { font: f(600, 11 * u, MONO), align: 'right', fill: mk >= 1 ? C.neon : C.body });
        ctx.fillStyle = '#0e2f3e'; ctx.fillRect(bx + 16 * u, by + 132 * u, bw - 32 * u, 6 * u);
        ctx.fillStyle = mk >= 1 ? C.neon : C.sell; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.fillRect(bx + 16 * u, by + 132 * u, (bw - 32 * u) * mk, 6 * u);
        ctx.restore();
      }
      // the loop starts again: a quick fade through the dark
      const fade = Math.max(1 - seg(s, 1.45, 1.62), seg(s, 6.35, 6.65));
      if (fade > 0) { ctx.fillStyle = `rgba(3,12,19,${fade})`; ctx.fillRect(0, 0, S.w, S.h); }
    },
  };
}

// ---- 2. the app on a phone ------------------------------------------------------------------------------
function buildApp(S) {
  const { scene, camera } = S;
  const glow = glowTexture();
  const phone = new THREE.Group();
  scene.add(phone);
  const body = new THREE.Mesh(roundedSlab(3.45, 7.3, 0.34, 0.44), new THREE.MeshPhongMaterial({ color: col('#0b141b'), specular: col('#3a5866'), shininess: 60 }));
  const shellGeo = roundedSlab(3.56, 7.41, 0.16, 0.48);
  {
    const p = shellGeo.attributes.position, arr = [], top = col(C.cyan), bot = col(C.neon);
    for (let i = 0; i < p.count; i++) { const k = clamp((p.getY(i) + 3.7) / 7.4); const c = bot.clone().lerp(top, k); arr.push(c.r, c.g, c.b); }
    shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  shell.position.z = -0.06;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = PW; screenCanvas.height = PH;
  const screenCtx = screenCanvas.getContext('2d');
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 4;
  const SW = 3.17, SH = 3.17 * (PH / PW);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, color: col('#d4d8da') }));
  screen.position.z = 0.176;
  const halo = new THREE.Sprite(additive(glow, C.cyan, 0.32)); halo.scale.set(10, 12, 1); halo.position.z = -0.6;
  phone.add(halo, shell, body, screen);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(4, 6, 8); scene.add(key);
  const rim = new THREE.PointLight(col(C.neon), 18, 14); rim.position.set(-4, -3, 2); scene.add(rim);
  const sd = dust(260, [16, 12, 10], 11); scene.add(sd);

  const row = S.el.closest('.fx-row');
  const nameEl = row?.querySelector('[data-fx-tabname]'), subEl = row?.querySelector('[data-fx-tabsub]'), countEl = row?.querySelector('[data-fx-tabcount]');
  const dots = [...(row?.querySelectorAll('[data-fx-dot]') || [])];
  let shownTab = -1, frameNo = 0, ts = 5.5;
  // the tour of the four tabs runs at about half the video's speed, then starts again
  const tour = (t) => 5.5 + ((t * 0.55) % (AT.end - 5.5));
  // where a callout points on the screen (fractions of it), its words, and when it shows (tour time) if not with its tab
  const CALLOUTS = {
    home: [[0.43, 0.21, 'LIVE EQUITY', 'balance + open trades, every second'], [0.5, 0.44, 'ACCOUNT', 'balance · drawdown · mode']],
    trades: [[0.21, 0.21, 'STATUS', 'level · risk · next entry'], [0.7, 0.52, 'GRID LADDER', 'every trade on the chart']],
    control: [[0.5, 0.205, 'ONE TAP', 'active · pause · finish'], [0.5, 0.41, 'LOT MODE', 'basic · smart · risk']],
    tools: [[0.36, 0.31, 'TAKE PROFIT', '1.00$  →  1.50$', null, AT.report], [0.5, 0.64, 'REPORT', 'this week · month · all time', AT.report + 0.1]],
  };
  let wide = true;
  return {
    stillAt: 0.6,
    fit() {
      camera.fov = 34;
      wide = S.w / S.h > 1.05;
      S.dist = fitDistance(camera, wide ? 9.2 : 4.6, 8.4, 1.0);
      phone.position.x = wide ? -2.0 : 0;
    },
    update(t) {
      ts = tour(t);
      camera.position.set(Math.sin(t * 0.3) * 0.6, 0.35, S.dist);
      camera.lookAt(0, 0, 0);
      phone.position.y = Math.sin(t * 1.6) * 0.06;
      phone.rotation.set(-0.06 + Math.sin(t * 0.5) * 0.03, Math.sin(t * 0.55) * 0.2 + (wide ? 0.12 : 0), 0);
      let bump = 0;
      for (const tb of TABS.slice(1)) bump += Math.exp(-Math.max(0, ts - tb.at) * 10) * (ts >= tb.at ? 0.03 : 0);
      phone.scale.setScalar(1 + bump);
      if (frameNo++ % 2 === 0 || still) { drawPhone(screenCtx, ts); screenTex.needsUpdate = true; }
      halo.material.opacity = 0.28 + 0.08 * Math.sin(t * 3);
      sd.rotation.y = t * 0.02;
      const i = tabAt(ts);
      if (i !== shownTab) {
        shownTab = i;
        if (nameEl) nameEl.textContent = TABS[i].name;
        if (subEl) subEl.textContent = TABS[i].sub;
        if (countEl) countEl.textContent = `Tab ${i + 1} / ${TABS.length}`;
        dots.forEach((d, j) => d.classList.toggle('is-on', j === i));
      }
    },
    draw(ctx) {
      if (!wide) return;                                          // on a narrow stage the phone has the room to itself
      const u = unit(S), tab = TABS[tabAt(ts)];
      (CALLOUTS[tab.id] || []).forEach(([cu, cv, ttl, sub, from, until], n) => {
        const start = from ?? tab.at + 0.06 + n * 0.1, ck = seg(ts, start, start + 0.24);
        const fade = until ? 1 - seg(ts, until - 0.12, until) : 1;
        if (ck <= 0 || fade <= 0) return;
        ctx.save();
        ctx.globalAlpha = fade;
        const p = S.project((cu - 0.5) * SW, (0.5 - cv) * SH, 0.18, phone);
        const tx = S.w * 0.6, ty = S.h * (0.3 + n * 0.32);
        ctx.save();
        ctx.strokeStyle = C.neon; ctx.lineWidth = 1.6; ctx.shadowColor = C.neon; ctx.shadowBlur = 8;
        partialPath(ctx, [[p.x, p.y], [lerp(p.x, tx, 0.55), p.y], [lerp(p.x, tx, 0.55), ty], [tx, ty]], E.outCubic(ck));
        ctx.shadowBlur = 0;
        ctx.fillStyle = C.neon; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 + 2 * Math.sin(ts * 10), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ring2d(ctx, ts, start, p.x, p.y, 36 * u, C.neon, 0.5, 2);
        const tk = seg(ts, start + 0.1, start + 0.32);
        text(ctx, typed(ttl, tk), tx + 12 * u, ty - 4 * u, { font: f(700, 21 * u, DISPLAY), spacing: 2 });
        text(ctx, typed(sub, tk), tx + 12 * u, ty + 18 * u, { font: f(500, 13 * u, MONO), fill: C.cyan });
        ctx.restore();
      });
    },
  };
}

// ---- 3. results: one example week -------------------------------------------------------------------------
function buildResults(S) {
  const { scene, camera } = S;
  const glow = glowTexture();
  scene.add(gridFloor(120, -0.02));
  const sd = dust(220, [26, 12, 18], 21); scene.add(sd);
  const bars = new THREE.Group();
  scene.add(bars);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(17, 5.6), new THREE.MeshBasicMaterial({ color: col('#061c26'), transparent: true, opacity: 0.85, depthWrite: false }));
  deck.rotation.x = -Math.PI / 2; deck.position.y = 0.01;
  bars.add(deck);
  const deckEdge = (w, d, x, z, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), new THREE.MeshBasicMaterial({ color: col(color) })); m.position.set(x, 0.02, z); bars.add(m); };
  deckEdge(17, 0.03, 0, 2.8, C.frame); deckEdge(17, 0.03, 0, -2.8, C.frame); deckEdge(0.03, 5.6, -8.5, 0, C.frame); deckEdge(0.03, 5.6, 8.5, 0, C.frame);
  deckEdge(1.8, 0.07, -7.6, 2.8, C.neon); deckEdge(1.8, 0.07, 7.6, -2.8, C.neon);
  const maxV = Math.max(...WEEK.map((d) => d.v)), best = WEEK.findIndex((d) => d.v === maxV);
  // the columns share the deck evenly, however many days the week has
  const GAP = 17 / (WEEK.length + 0.6), CW = Math.min(1.8, GAP * 0.62), colX = (i) => (i - (WEEK.length - 1) / 2) * GAP;
  const columns = WEEK.map((d, i) => {
    const geo = new THREE.BoxGeometry(CW, 1, CW);
    geo.translate(0, 0.5, 0);
    const p = geo.attributes.position, arr = [], low = col('#03161d'), high = col('#0b4652');
    for (let j = 0; j < p.count; j++) { const c = p.getY(j) > 0.5 ? high : low; arr.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    const top = i === best;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    m.position.set(colX(i), 0, 0);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col(top ? C.neon : C.cyan), transparent: true, opacity: 0.9 })));
    const capM = new THREE.Mesh(new THREE.PlaneGeometry(CW, CW), new THREE.MeshBasicMaterial({ color: col(top ? C.neon : C.mint), transparent: true }));
    capM.rotation.x = -Math.PI / 2;
    bars.add(m, capM);
    return { m, cap: capM, h: 0.6 + (d.v / maxV) * 5.6 };
  });
  // the balance, from 100 to 159.15, as a ribbon behind the columns
  const eqPts = [new THREE.Vector3(colX(0) - GAP * 0.75, 0.6, -2.2)];
  let run = 0;
  WEEK.forEach((d, i) => { run += d.v; eqPts.push(new THREE.Vector3(colX(i) + 0.4, 0.6 + (run / WEEK_TOTAL) * 6.2, -2.2)); });
  const eqCurve = new THREE.CatmullRomCurve3(eqPts, false, 'centripetal');
  const EQS = 200, eqTubes = glowTube(eqCurve, EQS, 0.07, [col(C.cyan), col(C.mint), col(C.neon)]);
  bars.add(...eqTubes);
  const eqHead = new THREE.Sprite(additive(glow, C.neon, 1)); eqHead.scale.set(1.5, 1.5, 1);
  bars.add(eqHead);

  // the figures beside the stage count up while the columns rise
  const counts = [...(S.el.closest('.fx-row')?.querySelectorAll('[data-fx-count]') || [])].map((el) => ({
    el, to: Number(el.dataset.fxCount), d: Number(el.dataset.fxDec || 0), pre: el.dataset.fxPrefix || '', post: el.dataset.fxSuffix || '',
  }));
  let tt = 0;
  return {
    replay: true,
    stillAt: 6,
    fit() {
      camera.fov = 38;
      S.dist = fitDistance(camera, 17.6, 8.4, 1.0);
    },
    update(t) {
      tt = t;
      const a = Math.sin(t * 0.22) * 0.3 - 0.12;
      camera.position.set(Math.sin(a) * S.dist, 3.3, Math.cos(a) * S.dist);
      camera.lookAt(0, 2.7, 0);
      sd.rotation.y = t * 0.015;
      columns.forEach((c, i) => {
        const k = E.spring(seg(t, 0.25 + i * 0.11, 0.95 + i * 0.11)), h = Math.max(0.001, c.h * k);
        c.m.scale.y = h;
        c.cap.position.set(colX(i), h + 0.004, 0);
        c.cap.visible = k > 0.01;
        c.cap.material.opacity = 0.55 + 0.25 * Math.sin(t * 4 + i);
      });
      const ek = E.inOutCubic(seg(t, 0.7, 2.6)), segs = Math.max(1, Math.floor(ek * EQS));
      for (const m of eqTubes) m.geometry.setDrawRange(0, segs * 8 * 6);
      eqHead.position.copy(eqCurve.getPointAt(Math.min(0.999, segs / EQS)));
      eqHead.visible = ek > 0;
      const ck = E.outCubic(seg(t, 0.3, 2.4));
      if (S.live) for (const c of counts) c.el.textContent = c.pre + money(c.to * ck, c.d) + c.post;   // off screen the page keeps the full figures
    },
    draw(ctx) {
      const u = unit(S);
      columns.forEach((c, i) => {
        const k = seg(tt, 0.45 + i * 0.11, 0.85 + i * 0.11);
        if (k <= 0) return;
        const top = S.project(colX(i), c.m.scale.y + 0.55, 0, bars), base = S.project(colX(i), 0.05, 1.0, bars);
        // a dark plate under each figure, so the balance line never runs through it
        const lab = `${WEEK[i].v.toFixed(2)}$`, font = f(700, 16 * u, MONO), w = measure(ctx, lab, font) + 14 * u;
        ctx.save();
        ctx.globalAlpha *= k;
        cutRect(ctx, top.x - w / 2, top.y - 18 * u, w, 25 * u, 5 * u);
        ctx.fillStyle = 'rgba(3,12,19,0.85)';
        ctx.fill();
        ctx.restore();
        text(ctx, lab, top.x, top.y, { font, align: 'center', fill: i === best ? C.neon : C.text, alpha: k });
        text(ctx, WEEK[i].day, base.x, base.y + 20 * u, { font: f(600, 12 * u, MONO), spacing: 2, align: 'center', fill: C.muted, alpha: k });
      });
    },
  };
}

// ---- 4. protection: four shields around the logo -------------------------------------------------------------
function buildProtection(S) {
  const { scene, camera } = S;
  const glow = glowTexture();
  scene.add(gridFloor(120, -3.1));
  const sd = dust(240, [20, 10, 14], 31); scene.add(sd);
  const logo = new THREE.Group();
  scene.add(logo);
  const halo = new THREE.Sprite(additive(glow, C.mint, 0.16)); halo.scale.set(4.2, 4.2, 1);
  const tex = new THREE.TextureLoader().load(S.el.dataset.fxLogo || 'assets/logo-512.png');
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  const rings = [[1.32, 0.018, C.cyan, Math.PI * 1.4], [1.5, 0.012, C.neon, Math.PI * 2], [1.68, 0.026, C.cyan, Math.PI * 0.6], [1.86, 0.01, C.mint, Math.PI * 1.1]]
    .map(([r, tube, color, arc]) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 160, arc), new THREE.MeshBasicMaterial({ color: col(color), transparent: true }));
      logo.add(m);
      return m;
    });
  logo.add(halo, plate);
  const shields = SHIELDS.map((name, i) => {
    const g = new THREE.Group();
    const hex = new THREE.CylinderGeometry(0.95, 0.95, 0.12, 6);
    hex.rotateX(Math.PI / 2);
    const face = new THREE.Mesh(hex, new THREE.MeshBasicMaterial({ color: col('#073443'), transparent: true, opacity: 0.86 }));
    const rimL = new THREE.LineSegments(new THREE.EdgesGeometry(hex), new THREE.LineBasicMaterial({ color: col(C.neon), transparent: true }));
    const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.6, 0.6, 0.13, 6).rotateX(Math.PI / 2)), new THREE.LineBasicMaterial({ color: col(C.cyan), transparent: true }));
    const sglow = new THREE.Sprite(additive(glow, C.neon, 0.18)); sglow.scale.set(3, 3, 1);
    g.add(sglow, face, rimL, inner);
    scene.add(g);
    return { g, rimL, i, name };
  });
  // where shield i is: it flies in, spinning, and locks into its place around the logo
  const shieldAt = (i, t, out) => {
    const lock = E.outExpo(seg(t, 0.2 + i * 0.12, 1.1 + i * 0.12));
    const a = Math.PI / 4 + (i * Math.PI) / 2 + (1 - lock) * 1.6;
    const r = lerp(12, 3.35, lock);
    out.set(Math.cos(a) * r, -0.2 + Math.sin(a) * r * 0.55 + Math.sin(t * 1.3 + i) * 0.08, lerp(8, 0, lock));
    return lock;
  };
  const wanted = new THREE.Vector3();
  let tt = 0;
  return {
    replay: true,
    stillAt: 4,
    fit() {
      camera.fov = 38;
      S.dist = fitDistance(camera, S.w < 520 ? 9.2 : 13.4, 7.2, 1.0);
    },
    update(t) {
      tt = t;
      camera.position.set(Math.sin(t * 0.25) * 0.8, 1.2, S.dist);
      camera.lookAt(0, -0.25, 0);
      plate.scale.setScalar(1 + 0.03 * Math.sin(t * 2));
      halo.material.opacity = 0.12 + 0.06 * Math.max(0, Math.sin(t * 2.4));
      rings.forEach((m, i) => { m.rotation.z = t * (i % 2 ? -0.7 : 0.55) + i; m.rotation.x = Math.sin(t * 0.6 + i) * 0.22; });
      sd.rotation.y = t * 0.02;
      for (const sh of shields) {
        const lock = shieldAt(sh.i, t, wanted);
        sh.g.position.copy(wanted);
        sh.g.rotation.y = (1 - lock) * Math.PI * 2 + Math.sin(t * 0.8 + sh.i) * 0.18;
        sh.rimL.material.opacity = 0.6 + 0.4 * Math.sin(t * 5 + sh.i);
      }
    },
    draw(ctx) {
      const u = unit(S), narrow = S.w < 560;
      for (const sh of shields) {
        const k = seg(tt, 0.9 + sh.i * 0.12, 1.3 + sh.i * 0.12);
        if (k <= 0) continue;
        const p = S.project(sh.g.position.x, sh.g.position.y, sh.g.position.z);
        if (narrow) {
          // a phone: the name over a top shield, under a bottom one, so it stays inside the box
          const top = p.y < S.h / 2, y = p.y + (top ? -46 : 56) * u;
          text(ctx, sh.name, p.x, y, { font: f(700, 13 * u, DISPLAY), spacing: 1.5, align: 'center', alpha: k });
          continue;
        }
        const right = p.x > S.w / 2, tx = p.x + (right ? 1 : -1) * 64 * u;
        text(ctx, sh.name, tx, p.y - 2, { font: f(700, 17 * u, DISPLAY), spacing: 2, align: right ? 'left' : 'right', alpha: k });
        text(ctx, 'your limit', tx, p.y + 17 * u, { font: f(500, 12 * u, MONO), align: right ? 'left' : 'right', fill: C.cyan, alpha: k });
      }
    },
  };
}

const BUILD = { strategy: buildStrategy, app: buildApp, results: buildResults, protection: buildProtection };

// ---- a stage: a WebGL canvas, a 2D canvas over it, a scene, and its own little clock -------------------------
function startStage(el) {
  const build = BUILD[el.dataset.fx3d];
  if (!build) return;
  const gl = document.createElement('canvas'), ov = document.createElement('canvas');
  gl.className = 'fx-gl'; ov.className = 'fx-ov';
  gl.setAttribute('aria-hidden', 'true'); ov.setAttribute('aria-hidden', 'true');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return;                                                       // no WebGL: the box keeps its dark panel
  }
  el.prepend(gl, ov);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);
  const ctx = ov.getContext('2d');
  const v = new THREE.Vector3();
  const S = {
    el, scene, camera, w: 1, h: 1, dpr: 1, dist: 18, live: false,
    // a point (in an object's own space, or the world's) to CSS pixels of the stage
    project(x, y, z, obj) {
      v.set(x, y, z);
      if (obj) obj.localToWorld(v);
      v.project(camera);
      return { x: (v.x + 1) / 2 * S.w, y: (1 - v.y) / 2 * S.h };
    },
  };
  const sc = build(S);
  let t = 0, last = 0, raf = 0, visible = false;
  function draw() {
    sc.update(t);
    renderer.render(scene, camera);
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.w, S.h);
    sc.draw(ctx);
  }
  function resize() {
    const r = el.getBoundingClientRect();
    S.w = Math.max(1, Math.round(r.width)); S.h = Math.max(1, Math.round(r.height));
    S.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(S.dpr);
    renderer.setSize(S.w, S.h, false);
    ov.width = Math.round(S.w * S.dpr); ov.height = Math.round(S.h * S.dpr);
    camera.aspect = S.w / S.h;
    sc.fit();
    camera.updateProjectionMatrix();
    if (still || !raf) draw();
  }
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function run() {
    if (still) return;
    if (visible && !document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  if (still) t = sc.stillAt;
  new ResizeObserver(resize).observe(el);
  resize();
  new IntersectionObserver(([entry]) => {
    const was = visible;
    visible = S.live = entry.isIntersecting;
    if (visible && !was && sc.replay && !still) t = 0;            // the columns rise and the shields fly in again
    run();
  }, { rootMargin: '80px 0px' }).observe(el);
  document.addEventListener('visibilitychange', run);
  el.classList.add('is-live');
}

// three.js is fetched when the first stage comes near the screen
let asked = false;
const near = new IntersectionObserver((entries) => {
  if (asked || !entries.some((e) => e.isIntersecting)) return;
  asked = true;
  near.disconnect();
  import(THREE_URL).then((m) => { THREE = m; stages.forEach(startStage); }).catch(() => {});
}, { rootMargin: '600px 0px' });
stages.forEach((el) => near.observe(el));
})();
