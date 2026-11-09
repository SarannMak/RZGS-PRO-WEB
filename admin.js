/* ==========================================================================
   RZGS-PRO: the owner's page (rzgspro.com/admin), 6 Nov 2026. A menu of every part of the site: Overview,
   Orders, Clients, Bots, Sign-ups, Statement, Reports, Affiliate, Traffic and Admins.
   The figures come from web_admin() in Supabase (web_admin.sql); orders, Give Diamond and sending to Telegram go
   through the checkout function. Both answer only the website accounts in rz_config checkout_admins.
   ========================================================================== */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://zaziizzsbytkdlatoutv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ojfdWkyt22zlG0Uz_CUd4w_IufedKpK';
  const API = `${SUPABASE_URL}/functions/v1/checkout`;
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const PLAN_NAMES = { trial: 'Free', elite: 'Elite', diamond: 'Diamond' };
  const BROKER_NAMES = { exness: 'Exness', investizo: 'Investizo', lirunex: 'Lirunex' };
  const STEP_NAMES = { broker: 'Broker account', mt5: 'MT5 account', pay: 'Payment' };
  const STAGE_NAMES = { broker: 'At broker step', mt5: 'At MT5 step', pay: 'Waiting for payment', review: 'Needs you', done: 'Delivered' };
  const PERIOD_WORDS = { daily: 'today', weekly: 'this week', monthly: 'this month' };
  const PREV_WORDS = { daily: 'day', weekly: 'week', monthly: 'month' };
  const KIND_NAMES = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  const RANGE_WORDS = { today: 'today', week: 'this week', month: 'this month', all: 'all time' };
  // the customer list's steps, in the words of its Excel file
  const CUSTOMER_STEPS = {
    plan: 'Choosing a plan', ask_broker: 'Opening broker account', ask_broker_email: 'Sending broker email',
    review_referral: 'Broker check', pay: 'Waiting for payment', review_payment: 'Payment check',
    ask_mt5: 'Sending MT5 number', review_mt5: 'MT5 check', build: 'Bot being built', active: 'Active',
  };
  const PAY_STATES = { confirm: ['Needs your confirmation', 'warn'], waiting: ['Waiting for payment', 'off'], paid: ['Paid', 'good'], expired: ['Expired', 'bad'] };
  const CLICK_KINDS = { interested: 'Plan button', referral: 'Broker link', other: 'Telegram link' };
  const VIEW_NAMES = {
    overview: 'Overview', orders: 'Orders', clients: 'Clients', bots: 'Bots', signups: 'Sign-ups', statement: 'Statement',
    reports: 'Reports', affiliate: 'Affiliate', traffic: 'Traffic', admins: 'Admins',
  };
  const ERRORS = {
    not_admin: "This page is for the owner of the site. Sign in with the owner's website account.",
    no_sql: 'This part needs the database file web_admin.sql. Paste it in the Supabase SQL Editor, press Run, then press Refresh here.',
    net: 'This could not be loaded. Check the connection and press Refresh.',
  };
  const SEND_WORDS = {
    statement_off: "It can't be sent: the report key is missing in the Supabase vault.",
    statement_failed: 'The statement function answered with an error. Try again in a minute.',
    not_admin: ERRORS.not_admin,
    net: 'No connection to the server. Try again.',
  };
  const OLD_FUNCTION = 'That did not work. Is the newest "checkout" function deployed?';

  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  const dateOnly = (date) => (date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
  const local = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const dayLabel = (iso) => local(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fullDay = (iso) => local(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const span = (from, to) => (!from ? `up to ${fullDay(to)}` : from === to ? fullDay(from) : `${dayLabel(from)} – ${fullDay(to)}`);
  const count = (n) => Number(n || 0).toLocaleString('en-US');
  const money = (n) => {
    const v = Number(n || 0);
    return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
  };
  const ago = (date) => {
    if (!date) return 'never';
    const s = (Date.now() - new Date(date).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const cap = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1).toLowerCase();
  const isLive = (plan, expires) => Boolean(plan) && (!expires || new Date(expires).getTime() > Date.now());

  const state = {
    view: null,
    period: { overview: 'daily', signups: '7', statement: 'daily', payments: 'month', users: 'month', traffic: 'daily' },
    filter: 'all',
    search: '',
    brokers: {},
    me: '',
    locked: false,
  };

  /* ---------------------------------------------------------------- the two servers */
  async function session() {
    const { data } = await db.auth.getSession();
    if (!data.session) { location.replace('login'); return new Promise(() => {}); }
    state.me = data.session.user.email || '';
    return data.session;
  }
  // the checkout function: orders, Give Diamond, statements
  async function call(action, fields = {}) {
    const current = await session();
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${current.access_token}` },
        body: JSON.stringify({ action, ...fields }),
      });
      return await response.json();
    } catch (e) {
      return { ok: false, code: 'net' };
    }
  }
  // web_admin() in the database: everything the menu shows
  async function part(name, arg = null) {
    await session();
    try {
      const { data, error } = await db.rpc('web_admin', { p_part: name, p_arg: arg });
      if (error) return { ok: false, err: /PGRST202|42883|find the function|does not exist/i.test(`${error.code} ${error.message}`) ? 'no_sql' : 'net' };
      return data || { ok: false, err: 'net' };
    } catch (e) {
      return { ok: false, err: 'net' };
    }
  }
  const cache = new Map();
  function get(key, load, fresh) {
    if (!fresh && cache.has(key)) return cache.get(key);
    const job = load().then((answer) => { if (!answer || !answer.ok) cache.delete(key); return answer; });
    cache.set(key, job);
    return job;
  }
  const overview = (kind, fresh) => get(`overview:${kind}`, () => part('overview', kind), fresh);
  const clients = (fresh) => get('clients', () => part('clients'), fresh);
  const list = (name, range, fresh) => get(`${name}:${range}`, () => part(name, range), fresh);
  const admins = (fresh) => get('admins', () => part('admins'), fresh);

  /* ---------------------------------------------------------------- page lines */
  function status(text, bad) {
    const line = $('[data-adm-status]');
    line.textContent = text;
    line.classList.toggle('is-bad', Boolean(bad));
  }
  function locked() {
    state.locked = true;
    $('.adm-body').hidden = true;
    status(ERRORS.not_admin, true);
  }
  // a line at the top of a view when its figures could not be loaded
  function say(view, err) {
    const box = $(`[data-adm-view="${view}"]`);
    let line = $('[data-adm-view-msg]', box);
    if (!err) { if (line) line.remove(); return; }
    if (err === 'not_admin') { locked(); return; }
    if (!line) {
      line = document.createElement('p');
      line.className = 'adm-status is-bad';
      line.setAttribute('data-adm-view-msg', '');
      line.setAttribute('role', 'status');
      $('.adm-view-head', box).after(line);
    }
    line.textContent = ERRORS[err] || ERRORS.net;
  }
  function stamp() {
    $('[data-adm-updated]').textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }
  function badge(name, value) {
    const el = $(`[data-adm-badge="${name}"]`);
    if (!el) return;
    el.textContent = count(value);
    el.hidden = !value;
  }

  /* ---------------------------------------------------------------- building blocks */
  const tile = ({ label, value, sub, hot, href }) => {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="adm-tile${hot ? ' adm-tile--hot' : ''}"${href ? ` href="${href}"` : ''}>
      <span class="adm-tile-label">${esc(label)}</span>
      <span class="adm-num">${esc(value)}</span>
      ${sub ? `<span class="adm-sub">${esc(sub)}</span>` : ''}
    </${tag}>`;
  };
  // cols: [{ t: heading, v: row => html, num }]
  function table(cols, rows, { empty = 'Nothing here yet.', limit = 0 } = {}) {
    if (!rows.length) return `<p class="adm-empty">${esc(empty)}</p>`;
    const shown = limit ? rows.slice(0, limit) : rows;
    return `<table class="adm-table">
      <thead><tr>${cols.map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.t)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((row) => `<tr>${cols.map((c) => `<td${c.num ? ' class="num"' : ''}>${c.v(row)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>${limit && rows.length > limit ? `<p class="adm-more">Showing ${limit} of ${count(rows.length)}. Search or pick a group to find the others.</p>` : ''}`;
  }
  const muted = (text = '-') => `<span class="muted">${esc(text)}</span>`;
  const plain = (value) => (value == null || value === '' ? muted() : esc(value));
  const who = (row) => `<span class="who"><b>${esc(row.name || row.email || '-')}</b>${row.name ? `<span>${esc(row.email || '')}</span>` : ''}</span>`;
  const telegram = (name) => (name ? `@${esc(String(name).replace(/^@/, ''))}` : muted());
  const stateTag = (word, tone) => `<span class="adm-state adm-state--${tone}">${esc(word)}</span>`;
  const planTag = (plan, expires) => {
    if (!plan) return muted('No plan');
    const live = isLive(plan, expires);
    return `<span class="adm-plan adm-plan--${live ? esc(plan) : 'ended'}">${esc(PLAN_NAMES[plan] || plan)}</span>${expires ? ` ${muted(live ? `until ${dateOnly(expires)}` : 'ended')}` : ''}`;
  };
  const amount = (value) => (value == null || value === '' ? muted() : esc(Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })));
  const profit = (value) => {
    if (value == null || value === '') return muted();
    const v = Number(value);
    return `<span class="${v > 0 ? 'adm-up' : v < 0 ? 'adm-down' : ''}">${v > 0 ? '+' : ''}${esc(v.toLocaleString('en-US', { maximumFractionDigits: 2 }))}</span>`;
  };
  const brokerName = (name) => (name ? esc(BROKER_NAMES[String(name).toLowerCase()] || name) : muted());

  // where a client's bot is, from what it last reported to the control app
  function bot(row) {
    if (!row.bot_seen) return row.mt5 ? { key: 'never', word: 'Never connected', tone: 'off' } : { key: 'none', word: 'No bot', tone: 'off' };
    const online = Date.now() - new Date(row.bot_seen).getTime() < 120e3;
    const active = String(row.bot_status || '').toUpperCase() === 'ACTIVE';
    if (online && active) return { key: 'running', word: 'Running', tone: 'good' };
    if (online) return { key: 'paused', word: row.bot_status ? cap(row.bot_status) : 'Trading off', tone: 'warn' };
    return { key: 'offline', word: `Offline, ${ago(row.bot_seen)}`, tone: 'bad' };
  }
  const orderStep = (row) => {
    if (!row.order) return muted();
    if (row.order === 'review') return `${STAGE_NAMES.review}${row.order_from ? ` (${esc((STEP_NAMES[row.order_from] || row.order_from).toLowerCase())})` : ''}`;
    return esc(STAGE_NAMES[row.order] || row.order);
  };
  const nextStep = (row) => {
    const b = bot(row);
    if (b.key === 'running') return stateTag('Bot running', 'good');
    if (row.order && row.order !== 'done') return orderStep(row);
    if (row.mt5) return esc(b.word);
    if (row.plan) return 'Has a plan';
    return muted('Nothing yet');
  };

  /* ---------------------------------------------------------------- charts: one series per chart */
  const nice = (m) => {
    if (m <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(m));
    for (const f of [1, 2, 4, 5, 10]) if (f * p >= m) return f * p;
    return 10 * p;
  };
  const sizer = 'ResizeObserver' in window
    ? new ResizeObserver((entries) => entries.forEach(({ target }) => { if (target._chart && Math.abs((target._w || 0) - target.clientWidth) > 4) draw(target); }))
    : null;
  function chart(name, days, key, label, isMoney) {
    const el = $(`[data-adm-chart="${name}"]`);
    if (!el) return;
    el.classList.add('adm-chart');
    el._chart = { rows: (days || []).map((d) => ({ day: d.day, value: Number(d[key]) || 0 })), label, isMoney };
    draw(el);
    if (sizer && !el._watched) { sizer.observe(el); el._watched = true; }
  }
  function draw(el) {
    const { rows, label, isMoney } = el._chart;
    const fmt = isMoney ? money : count;
    if (!rows.length) { el.innerHTML = '<p class="adm-empty">No days to show.</p>'; return; }
    el._w = el.clientWidth;
    const W = Math.max(240, Math.round(el.clientWidth || 600));
    const H = 168, L = 38, R = 4, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B, base = T + ph;
    const max = nice(Math.max(0, ...rows.map((r) => r.value)));
    const slot = pw / rows.length, bw = Math.max(1, slot - 2);
    const f2 = (n) => Math.round(n * 100) / 100;
    let marks = '';
    rows.forEach((r, i) => {
      const x = L + i * slot + 1;
      const h = r.value > 0 ? Math.max(2, (r.value / max) * ph) : 2;
      const top = base - h;
      const rad = Math.min(4, bw / 2, h);
      const d = `M${f2(x)},${base}V${f2(top + rad)}Q${f2(x)},${f2(top)} ${f2(x + rad)},${f2(top)}H${f2(x + bw - rad)}Q${f2(x + bw)},${f2(top)} ${f2(x + bw)},${f2(top + rad)}V${base}Z`;
      marks += `<g data-i="${i}"><rect class="hit" x="${f2(L + i * slot)}" y="${T}" width="${f2(slot)}" height="${ph}"/><path class="bar${r.value > 0 ? '' : ' is-zero'}" d="${d}"/></g>`;
    });
    const half = max / 2;
    const showHalf = isMoney || Number.isInteger(half);
    const yl = (v, y) => `<text x="${L - 6}" y="${f2(y)}" text-anchor="end" dominant-baseline="middle">${esc(fmt(v))}</text>`;
    const mid = Math.floor((rows.length - 1) / 2);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const open = $('details', el)?.open;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label} per day, last 30 days. Total ${fmt(total)}.`)}">
        <line class="grid" x1="${L}" x2="${W - R}" y1="${T}" y2="${T}"/>
        ${showHalf ? `<line class="grid" x1="${L}" x2="${W - R}" y1="${f2(T + ph / 2)}" y2="${f2(T + ph / 2)}"/>` : ''}
        <line class="axis" x1="${L}" x2="${W - R}" y1="${base + 0.5}" y2="${base + 0.5}"/>
        ${yl(max, T)}${showHalf ? yl(half, T + ph / 2) : ''}${yl(0, base)}
        ${marks}
        <text x="${L}" y="${H - 4}" text-anchor="start">${esc(dayLabel(rows[0].day))}</text>
        <text x="${f2(L + (mid + 0.5) * slot)}" y="${H - 4}" text-anchor="middle">${esc(dayLabel(rows[mid].day))}</text>
        <text x="${W - R}" y="${H - 4}" text-anchor="end">${esc(dayLabel(rows[rows.length - 1].day))}</text>
      </svg>
      <div class="adm-tip" hidden></div>
      <div class="adm-chart-foot"><span>30 days: <b>${esc(fmt(total))}</b></span><span>Today: <b>${esc(fmt(rows[rows.length - 1].value))}</b></span></div>
      <details${open ? ' open' : ''}><summary>Show as a table</summary><div class="adm-scroll">${table(
        [{ t: 'Day', v: (r) => esc(fullDay(r.day)) }, { t: label, v: (r) => esc(fmt(r.value)), num: true }],
        rows.slice().reverse(),
      )}</div></details>`;
    const tip = $('.adm-tip', el);
    const svg = $('svg', el);
    const scale = () => (svg.getBoundingClientRect().width || W) / W;
    svg.addEventListener('pointerover', (event) => {
      const g = event.target.closest('g[data-i]');
      if (!g) return;
      const i = Number(g.dataset.i);
      const r = rows[i];
      const h = r.value > 0 ? Math.max(2, (r.value / max) * ph) : 2;
      tip.innerHTML = `${esc(dayLabel(r.day))}: <b>${esc(fmt(r.value))}</b>`;
      tip.hidden = false;
      const s = scale();
      const half = tip.offsetWidth / 2 + 2;
      tip.style.left = `${Math.min(Math.max((L + (i + 0.5) * slot) * s, half), W * s - half)}px`;
      tip.style.top = `${(base - h) * s}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  /* ---------------------------------------------------------------- views */
  async function viewOverview(fresh) {
    const kind = state.period.overview;
    const data = await overview(kind, fresh);
    if (!data.ok) return say('overview', data.err);
    say('overview');
    const { period: p, now: n } = data;
    const word = PERIOD_WORDS[kind];
    const plans = n.plans || {};
    const running = (plans.trial || 0) + (plans.elite || 0) + (plans.diamond || 0);
    $('[data-adm-tiles="overview"]').innerHTML = [
      { label: 'Waiting for you', value: count(n.review), sub: n.review ? 'Open Orders to decide' : 'Nothing to decide', hot: n.review > 0, href: '#orders' },
      { label: `Income ${word}`, value: money(p.plan_income), sub: `${money(n.income_total)} in all, plans only` },
      { label: `Sign-ups ${word}`, value: count(p.signup), sub: `${count(p.signup_prev)} the ${PREV_WORDS[kind]} before`, href: '#signups' },
      { label: 'Accounts', value: count(n.accounts), sub: `${count(n.unconfirmed)} email not confirmed`, href: '#clients' },
      { label: 'Plans running', value: count(running), sub: `Free ${count(plans.trial)} · Elite ${count(plans.elite)} · Diamond ${count(plans.diamond)}` },
      { label: 'Bots online now', value: count(n.bots_online), sub: `${count(n.bots_today)} reported today · ${count(n.bots_total)} in all`, href: '#bots' },
      { label: 'Orders in progress', value: count(n.open_orders), sub: 'At the broker, MT5 or payment step', href: '#orders' },
      { label: `Visitors ${word}`, value: count(p.traffic && p.traffic.visitors), sub: `${count(p.traffic && p.traffic.views)} page views`, href: '#traffic' },
    ].map(tile).join('');
    chart('signups', data.days, 'signups', 'Sign-ups');
    chart('income', data.days, 'income', 'Income', true);
    badge('clients', n.accounts);
  }

  // ---- orders: the first admin page, unchanged in what it does
  function card(order) {
    const email = order.web_users ? order.web_users.email : '';
    return `<article class="adm-card" data-order="${order.id}">
      <h3>${STEP_NAMES[order.review_from] || 'Order'}: ${PLAN_NAMES[order.plan] || esc(order.plan)}${Number(order.amount) > 0 ? ` $${Number(order.amount)}` : ''}</h3>
      <dl>
        <dt>Client</dt><dd>${esc(email)}</dd>
        ${order.broker ? `<dt>Broker</dt><dd>${esc(BROKER_NAMES[order.broker] || order.broker)}${order.broker_email ? ` · ${esc(order.broker_email)}` : ''}</dd>` : ''}
        ${order.mt5 ? `<dt>MT5</dt><dd>${esc(order.mt5)}</dd>` : ''}
        <dt>Asked</dt><dd>${when(order.updated_at)}</dd>
      </dl>
      <p class="adm-why">${esc(order.review_detail || 'No reason was saved.')}</p>
      <input class="adm-note" type="text" maxlength="300" placeholder="If you refuse: what the client should read" aria-label="Note to the client">
      <div class="dash-row">
        <button class="btn btn-primary btn-sm" type="button" data-approve>Approve</button>
        <button class="btn btn-danger btn-sm" type="button" data-refuse>Refuse</button>
      </div>
    </article>`;
  }
  async function loadOrders() {
    const data = await call('admin_list');
    if (!data.ok) {
      if (data.code === 'not_admin') return locked();
      status(data.code === 'net' ? ERRORS.net : 'The orders could not be loaded. Is the "checkout" function deployed?', true);
      $('[data-adm-waiting]').innerHTML = '<p class="adm-empty">The orders could not be loaded.</p>';
      return;
    }
    const s = data.status || {};
    const files = (data.files || []).length;
    status([
      s.bakong_on ? `Bakong on: ${s.bakong_used} of ${s.bakong_day} checks used today` : 'Bakong is OFF on the website server',
      `${files} of 7 bot files`,
      s.secret ? 'Bot Passwords can be made' : 'The licence secret is MISSING',
    ].join(' · '), !s.secret || files < 7);
    const waiting = data.waiting || [];
    badge('orders', waiting.length);
    // a note being typed is never wiped by the refresh
    if (!$('[data-adm-waiting] .adm-note:focus')) {
      $('[data-adm-waiting]').innerHTML = waiting.length ? waiting.map(card).join('') : '<p class="adm-empty">Nothing is waiting for you.</p>';
    }
    $('[data-adm-recent]').innerHTML = (data.recent || []).map((order) => `<tr>
      <td>${when(order.created_at)}</td>
      <td>${esc(order.web_users ? order.web_users.email : '')}</td>
      <td>${PLAN_NAMES[order.plan] || esc(order.plan)}</td>
      <td>${esc(BROKER_NAMES[order.broker] || order.broker || '-')}</td>
      <td>${esc(order.mt5 || '-')}</td>
      <td>${order.tx ? `$${Number(order.amount)}` : '-'}</td>
      <td>${STAGE_NAMES[order.stage] || esc(order.stage)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No orders yet.</td></tr>';
  }

  // ---- clients
  const FILTERS = {
    all: () => true,
    running: (r) => isLive(r.plan, r.expires),
    trial: (r) => r.plan === 'trial' && isLive(r.plan, r.expires),
    elite: (r) => r.plan === 'elite' && isLive(r.plan, r.expires),
    diamond: (r) => r.plan === 'diamond' && isLive(r.plan, r.expires),
    ended: (r) => Boolean(r.plan) && !isLive(r.plan, r.expires),
    none: (r) => !r.plan,
    unconfirmed: (r) => !r.confirmed,
  };
  const CLIENT_COLS = [
    { t: 'Client', v: who },
    { t: 'Joined', v: (r) => `${esc(dateOnly(r.joined))}${r.confirmed ? '' : `<br>${muted('email not confirmed')}`}` },
    { t: 'Last login', v: (r) => esc(ago(r.last_login)) },
    { t: 'Plan', v: (r) => planTag(r.plan, r.expires) },
    { t: 'Bot', v: (r) => { const b = bot(r); return stateTag(b.word, b.tone); } },
    { t: 'MT5', v: (r) => (r.mt5 ? `${esc(r.mt5)}<br>${muted(BROKER_NAMES[String(r.broker || '').toLowerCase()] || r.broker || '')}` : muted()) },
    { t: 'Balance', v: (r) => amount(r.balance), num: true },
    { t: 'Order', v: orderStep },
    { t: 'Friends who count', v: (r) => (r.friends ? `${count(r.friends_done)} of ${count(r.friends)}` : muted()) },
    { t: 'Invited by', v: (r) => plain(r.invited_by) },
    { t: 'Telegram', v: (r) => telegram(r.telegram) },
    { t: 'Country', v: (r) => plain(r.country) },
    { t: 'Phone', v: (r) => plain(r.phone) },
  ];
  async function viewClients(fresh) {
    const data = await clients(fresh);
    if (!data.ok) return say('clients', data.err);
    say('clients');
    const rows = data.rows || [];
    badge('clients', rows.length);
    $$('[data-adm-filter="clients"] button').forEach((button) => {
      let n = $('span', button);
      if (!n) { n = document.createElement('span'); button.append(n); }
      n.textContent = count(rows.filter(FILTERS[button.dataset.filter]).length);
      button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    });
    const q = state.search.trim().toLowerCase();
    const shown = rows.filter(FILTERS[state.filter])
      .filter((r) => !q || [r.name, r.email, r.mt5, r.telegram, r.phone, r.code, r.country].some((v) => String(v || '').toLowerCase().includes(q)));
    $('[data-adm-count="clients"]').textContent = `${count(shown.length)} of ${count(rows.length)}`;
    $('[data-adm-table="clients"]').innerHTML = table(CLIENT_COLS, shown, { empty: q ? 'No client matches that search.' : 'No client in this group.', limit: 200 });
  }

  // ---- bots: who uses the bot and who doesn't
  const BOT_COLS = [
    { t: 'Client', v: who },
    { t: 'MT5', v: (r) => `${plain(r.mt5)}<br>${muted(BROKER_NAMES[String(r.broker || '').toLowerCase()] || r.broker || '')}` },
    { t: 'Plan', v: (r) => planTag(r.plan, r.expires) },
    { t: 'Status', v: (r) => { const b = bot(r); return stateTag(b.word, b.tone); } },
    { t: 'Last report', v: (r) => (r.bot_seen ? esc(when(r.bot_seen)) : muted('never')) },
    { t: 'Balance', v: (r) => amount(r.balance), num: true },
    { t: 'Equity', v: (r) => amount(r.equity), num: true },
    { t: 'Today', v: (r) => profit(r.day_profit), num: true },
  ];
  const NO_BOT_COLS = [
    { t: 'Client', v: who },
    { t: 'Joined', v: (r) => esc(dateOnly(r.joined)) },
    { t: 'Last login', v: (r) => esc(ago(r.last_login)) },
    { t: 'Plan', v: (r) => planTag(r.plan, r.expires) },
    { t: 'Order', v: orderStep },
    { t: 'Telegram', v: (r) => telegram(r.telegram) },
  ];
  async function viewBots(fresh) {
    const [data, ov] = await Promise.all([clients(fresh), overview(state.period.overview, fresh)]);
    if (!data.ok) return say('bots', data.err);
    say('bots');
    const groups = { running: [], paused: [], offline: [], never: [], none: [] };
    (data.rows || []).forEach((r) => groups[bot(r).key].push(r));
    groups.running.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
    groups.offline.sort((a, b) => new Date(b.bot_seen) - new Date(a.bot_seen));
    const known = ov.ok ? ov.now.bots_total : null;
    $('[data-adm-tiles="bots"]').innerHTML = [
      { label: 'Running now', value: count(groups.running.length), sub: 'Trading on, reported in the last 2 minutes' },
      { label: 'Trading off', value: count(groups.paused.length), sub: 'Online, but auto trading is off', hot: groups.paused.length > 0 },
      { label: 'Offline', value: count(groups.offline.length), sub: 'Reported before, silent now' },
      { label: 'Never connected', value: count(groups.never.length), sub: 'Has an MT5 number, no report yet' },
      { label: 'No bot yet', value: count(groups.none.length), sub: 'Accounts without an MT5 number' },
      ...(known != null ? [{ label: 'Bots known', value: count(known), sub: 'Every MT5 account that ever reported, website or not' }] : []),
    ].map(tile).join('');
    const block = (key, title, hint, cols, open) => `<details class="dash-panel adm-group" data-group="${key}"${open ? ' open' : ''}>
      <summary><h3>${esc(title)}</h3><small>${count(groups[key].length)}</small></summary>
      <p>${esc(hint)}</p>
      <div class="adm-scroll">${table(cols, groups[key], { empty: 'Nobody here.', limit: 200 })}</div>
    </details>`;
    const opened = new Set($$('[data-adm-bot-groups] details[open]').map((d) => d.dataset.group));
    const isOpen = (key, first) => (opened.size ? opened.has(key) : first);
    $('[data-adm-bot-groups]').innerHTML = [
      block('running', 'Running now', 'These bots are trading.', BOT_COLS, isOpen('running', true)),
      block('paused', 'Trading off', 'The bot is online but its auto trading is off: the client may have paused it, or MT5 has AutoTrading off.', BOT_COLS, isOpen('paused', true)),
      block('offline', 'Offline', 'The bot reported before but not in the last 2 minutes: MT5 or the computer may be closed.', BOT_COLS, isOpen('offline', true)),
      block('never', 'Never connected', 'The client has an MT5 number on the site, but their bot has never reported. They may need help installing it.', BOT_COLS, isOpen('never', true)),
      block('none', 'No bot yet', 'Accounts that have not got a bot yet.', NO_BOT_COLS, isOpen('none', false)),
    ].join('');
  }

  // ---- sign-ups
  const SIGNUP_COLS = [
    { t: 'Client', v: who },
    { t: 'Joined', v: (r) => esc(when(r.joined)) },
    { t: 'Email', v: (r) => (r.confirmed ? stateTag('Confirmed', 'good') : stateTag('Not confirmed', 'warn')) },
    { t: 'Came from', v: (r) => (r.invited_by ? `Invited by ${esc(r.invited_by)}` : muted('Direct')) },
    { t: 'Next', v: nextStep },
    { t: 'Plan', v: (r) => planTag(r.plan, r.expires) },
    { t: 'Last login', v: (r) => esc(ago(r.last_login)) },
    { t: 'Country', v: (r) => plain(r.country) },
  ];
  async function viewSignups(fresh) {
    const [data, ov] = await Promise.all([clients(fresh), overview(state.period.overview, fresh)]);
    if (!data.ok) return say('signups', data.err);
    say('signups');
    if (ov.ok) chart('signups2', ov.days, 'signups', 'Sign-ups');
    const range = state.period.signups;
    const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400e3;
    const rows = (data.rows || []).filter((r) => new Date(r.joined).getTime() >= since);
    const words = range === 'all' ? 'in all' : `in the last ${range} days`;
    $('[data-adm-table="signups"]').innerHTML = `<h2 class="adm-flush-title">${count(rows.length)} sign-up${rows.length === 1 ? '' : 's'} ${words}</h2>
      ${table(SIGNUP_COLS, rows, { empty: 'Nobody signed up in this time.', limit: 200 })}`;
  }

  // ---- statement: the figures of the Excel sent to Telegram at 20:00
  const stPanel = (title, head, rows) => `<section class="dash-panel"><h2>${esc(title)}</h2><table class="adm-st">
      ${head ? `<thead><tr><th scope="col"><span class="sr-only">Item</span></th>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>` : ''}
      <tbody>${rows.map((r) => `<tr${r.total ? ' class="is-total"' : ''}><td>${esc(r.t)}${r.hint ? `<span class="hint">${esc(r.hint)}</span>` : ''}</td>${[].concat(r.v).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></section>`;
  async function viewStatement(fresh) {
    const kind = state.period.statement;
    const data = await overview(kind, fresh);
    if (!data.ok) return say('statement', data.err);
    say('statement');
    const p = data.period;
    const B = state.brokers[kind];
    const names = ['exness', 'lirunex', 'investizo'];
    const commission = B ? names.reduce((s, n) => s + (Number(B[n] && B[n].commission) || 0), 0) : 0;
    const net = Number(p.plan_income || 0) + commission;
    const growth = p.signup_prev ? (p.signup - p.signup_prev) / p.signup_prev : 0;
    const plans = p.plans || {};
    const br = p.brokers || {};
    const t = p.traffic || {};
    $('[data-adm-statement-period]').textContent = `${KIND_NAMES[kind]} statement · ${span(p.from, p.to)} · the same figures as the Excel sent at 20:00`;
    $('[data-adm-statement]').innerHTML = [
      stPanel('Summary', null, [
        { t: `Net income (${PERIOD_WORDS[kind]})`, hint: B ? 'Plans + broker commission' : 'Plans only. Load broker income below to add it.', v: money(net), total: true },
        { t: 'New users', v: count(p.signup) },
        { t: 'Total users', v: count(p.users_total) },
        { t: 'Active bots (running / total)', v: `${count(p.bots_running)} / ${count(p.bots_total)}` },
        { t: `New users vs the ${PREV_WORDS[kind]} before`, v: `${(growth * 100).toFixed(1)}%` },
      ]),
      stPanel('Income statement', null, [
        { t: 'Sales (plan orders)', v: count(p.orders) },
        { t: 'Completed (bot delivered)', v: count(p.done) },
        { t: 'Incomplete (not finished)', v: count(p.open) },
        { t: 'Free (trial plan)', v: count(plans.trial) },
        { t: 'Elite ($5 plan)', v: count(plans.elite) },
        { t: 'Diamond ($49 plan)', v: count(plans.diamond) },
        { t: 'Plan income', v: money(p.plan_income), total: true },
      ]),
      stPanel('User registration', ['This period', 'Total'], [
        { t: 'Sign up', v: [count(p.signup), count(p.users_total)] },
        { t: 'Register (broker)', v: [count(p.broker_regs), count(p.broker_regs_total)] },
        ...['Exness', 'Lirunex', 'Investizo'].map((n) => ({ t: n, v: [count(br[n] && br[n].period), count(br[n] && br[n].total)] })),
      ]),
      stPanel('Bot and user activity', null, [
        { t: 'Logins (this period)', v: count(p.login) },
        { t: 'Active users', hint: 'Signed in within 30 days', v: count(p.active_users) },
        { t: 'Inactive users', hint: 'No sign-in for 30 days', v: count(p.inactive_users) },
        { t: 'Complete bots (total)', v: count(p.done_total) },
        { t: 'Incomplete bots (total)', v: count(p.open_total) },
      ]),
      stPanel('Website traffic', null, [
        { t: 'Visitors', v: count(t.visitors) },
        { t: 'Page views', v: count(t.views) },
        { t: 'Interested (plan clicks)', v: count(t.interested) },
        { t: 'Referral clicks (broker links)', v: count(t.referral) },
        { t: 'Other (Telegram links)', v: count(t.other) },
      ]),
    ].join('');
    const loadButton = $('[data-adm-load-brokers]');
    if (!loadButton.disabled) loadButton.textContent = B ? 'Load broker income again' : 'Load broker income';
    if (!B) { $('[data-adm-brokers]').innerHTML = ''; return; }
    const lines = [['Clients (total)', 'clients'], ['Active clients', 'active'], ['Inactive clients', 'inactive'], ['Trades', 'trades'], ['Commission', 'commission', true]];
    const down = names.filter((n) => !B[n]).map((n) => BROKER_NAMES[n]);
    $('[data-adm-brokers]').innerHTML = `<div class="adm-scroll"><table class="adm-table">
        <thead><tr><th scope="col">Broker</th>${names.map((n) => `<th scope="col" class="num">${BROKER_NAMES[n]}</th>`).join('')}<th scope="col" class="num">Total</th></tr></thead>
        <tbody>${lines.map(([label, key, isMoney]) => {
          const fmt = isMoney ? money : count;
          const vals = names.map((n) => (B[n] ? B[n][key] : null));
          const total = vals.reduce((s, v) => s + (Number(v) || 0), 0);
          return `<tr><td>${label}</td>${vals.map((v) => `<td class="num">${v == null ? muted() : esc(fmt(v))}</td>`).join('')}<td class="num">${esc(fmt(total))}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${down.length ? `<p class="adm-more">Could not be reached: ${esc(down.join(', '))}.</p>` : ''}
      <p class="adm-more">Loaded ${esc(when(B.at))}. "-" means the broker does not report it.</p>`;
  }

  // ---- reports: the payment statement and the customer list, as sent to Telegram
  const PAY_COLS = [
    { t: 'Client', v: who },
    { t: 'Telegram', v: (r) => telegram(r.telegram) },
    { t: 'Plan', v: (r) => esc(PLAN_NAMES[r.plan] || r.plan) },
    { t: 'Amount', v: (r) => esc(money(r.amount)), num: true },
    { t: 'Status', v: (r) => { const [word, tone] = PAY_STATES[r.status] || [r.status, 'off']; return stateTag(word, tone); } },
    { t: 'Since', v: (r) => plain(r.since) },
    { t: 'Plan ends', v: (r) => plain(r.expires) },
    { t: 'Days left', v: (r) => plain(r.days_left), num: true },
  ];
  const customerStep = (r) => (r.stage === 'active' && r.expired ? 'Expired' : CUSTOMER_STEPS[r.stage] || 'Not started');
  const USER_COLS = [
    { t: 'Client', v: who },
    { t: 'Telegram', v: (r) => telegram(r.telegram) },
    { t: 'Phone', v: (r) => plain(r.phone) },
    { t: 'Country', v: (r) => plain(r.country) },
    { t: 'Signed up', v: (r) => plain(r.signed_up) },
    { t: 'Last login', v: (r) => plain(r.last_login) },
    { t: 'Plan', v: (r) => plain(PLAN_NAMES[r.plan] || r.plan) },
    { t: 'Step', v: (r) => { const s = customerStep(r); return s === 'Active' ? stateTag(s, 'good') : s === 'Expired' ? stateTag(s, 'bad') : esc(s); } },
    { t: 'Broker', v: (r) => brokerName(r.broker) },
    { t: 'MT5', v: (r) => plain(r.mt5) },
    { t: 'Plan ends', v: (r) => plain(r.expires) },
  ];
  async function viewReports(fresh) {
    const [pay, users] = await Promise.all([list('payments', state.period.payments, fresh), list('users', state.period.users, fresh)]);
    if (!pay.ok) return say('reports', pay.err);
    if (!users.ok) return say('reports', users.err);
    say('reports');
    const rows = pay.list.rows || [];
    const sum = (keys) => rows.filter((r) => keys.includes(r.status)).reduce((s, r) => s + Number(r.amount || 0), 0);
    const confirm = rows.filter((r) => r.status === 'confirm').length;
    $('[data-adm-tiles="payments"]').innerHTML = [
      { label: 'Received', value: money(sum(['paid', 'expired'])), sub: 'Paid, and paid plans that have ended' },
      { label: 'Not received yet', value: money(sum(['confirm', 'waiting'])), sub: 'Waiting, or waiting for your check' },
      { label: 'Need your confirmation', value: count(confirm), sub: confirm ? 'Open Orders to decide' : 'None', hot: confirm > 0, href: confirm ? '#orders' : '' },
    ].map(tile).join('');
    $('[data-adm-table="payments"]').innerHTML = `<p class="adm-more">${esc(span(pay.list.from, pay.list.to))} · ${count(rows.length)} payment${rows.length === 1 ? '' : 's'} · amounts are plan prices · free months are not payments</p>
      ${table(PAY_COLS, rows, { empty: 'No payments in this period.' })}`;
    const people = users.list.rows || [];
    const active = people.filter((r) => customerStep(r) === 'Active').length;
    const going = people.filter((r) => r.stage && r.stage !== 'active').length;
    $('[data-adm-table="users"]').innerHTML = `<p class="adm-more">${esc(span(users.list.from, users.list.to))} · ${count(people.length)} customer${people.length === 1 ? '' : 's'} · active ${count(active)} · in progress ${count(going)} · not started ${count(people.filter((r) => !r.stage).length)}</p>
      ${table(USER_COLS, people, { empty: 'Nobody signed up in this period.', limit: 300 })}`;
  }

  // ---- affiliate program
  const INVITER_COLS = [
    { t: 'Inviter', v: who },
    { t: 'Code', v: (r) => (r.code ? `<code>${esc(r.code)}</code>` : muted()) },
    { t: 'Friends joined', v: (r) => esc(count(r.friends)), num: true },
    { t: 'Friends who count', v: (r) => esc(count(r.friends_done)), num: true },
    { t: 'Next free month', v: (r) => `${count(Number(r.friends_done || 0) % 5)} of 5` },
    { t: 'Months earned', v: (r) => esc(count(Math.floor(Number(r.friends_done || 0) / 5))), num: true },
  ];
  const INVITED_COLS = [
    { t: 'Friend', v: who },
    { t: 'Joined', v: (r) => esc(dateOnly(r.joined)) },
    { t: 'Invited by', v: (r) => esc(r.invited_by) },
    { t: 'Plan', v: (r) => planTag(r.plan, r.expires) },
    { t: 'Bot', v: (r) => { const b = bot(r); return stateTag(b.word, b.tone); } },
  ];
  async function viewAffiliate(fresh) {
    const [data, ov] = await Promise.all([clients(fresh), overview(state.period.overview, fresh)]);
    if (!data.ok) return say('affiliate', data.err);
    say('affiliate');
    const rows = data.rows || [];
    const inviters = rows.filter((r) => r.friends > 0)
      .sort((a, b) => b.friends_done - a.friends_done || b.friends - a.friends);
    const invited = rows.filter((r) => r.invited_by);
    const n = ov.ok ? ov.now : {};
    $('[data-adm-tiles="affiliate"]').innerHTML = [
      { label: 'Friends invited', value: count(n.invited ?? invited.length), sub: 'Accounts that signed up with a code' },
      { label: 'Friends who count', value: count(n.friends_done), sub: 'Reached 6 achievements' },
      { label: 'Free months given', value: count(n.free_months_used), sub: 'Elite months delivered' },
      { label: 'Inviters', value: count(inviters.length), sub: 'Accounts with at least one friend' },
    ].map(tile).join('');
    $('[data-adm-table="affiliate"]').innerHTML = `<h2 class="adm-flush-title">Inviters</h2>
      ${table(INVITER_COLS, inviters, { empty: 'Nobody has invited a friend yet.' })}
      <h2 class="adm-flush-title">Invited friends</h2>
      ${table(INVITED_COLS, invited, { empty: 'No account has signed up with a code yet.', limit: 200 })}`;
  }

  // ---- traffic
  const pageName = (page) => (!page || page === '/' || page === '/index' ? 'Home' : page);
  async function viewTraffic(fresh) {
    const kind = state.period.traffic;
    const data = await overview(kind, fresh);
    if (!data.ok) return say('traffic', data.err);
    say('traffic');
    const t = data.period.traffic || {};
    const word = PERIOD_WORDS[kind];
    $('[data-adm-tiles="traffic"]').innerHTML = [
      { label: `Visitors ${word}`, value: count(t.visitors), sub: 'Different browsers' },
      { label: 'Page views', value: count(t.views), sub: 'The same page counts once in 30 min' },
      { label: 'Plan clicks', value: count(t.interested), sub: 'See plans, Claim and plan buttons' },
      { label: 'Broker link clicks', value: count(t.referral), sub: 'Exness, Investizo, Lirunex' },
      { label: 'Telegram clicks', value: count(t.other), sub: 'Links to Telegram' },
    ].map(tile).join('');
    chart('visitors', data.days, 'visitors', 'Visitors');
    $('[data-adm-table="pages"]').innerHTML = table(
      [{ t: 'Page', v: (r) => esc(pageName(r.page)) }, { t: 'Views', v: (r) => esc(count(r.views)), num: true }],
      data.pages || [], { empty: `No page was opened ${word} yet.` },
    );
    $('[data-adm-table="clicks"]').innerHTML = table(
      [{ t: 'What', v: (r) => esc(CLICK_KINDS[r.kind] || r.kind) }, { t: 'Text or link', v: (r) => plain(r.target) }, { t: 'Clicks', v: (r) => esc(count(r.clicks)), num: true }],
      data.clicks || [], { empty: `Nothing was clicked ${word} yet.` },
    );
  }

  // ---- admins: the list only
  async function viewAdmins(fresh) {
    const data = await admins(fresh);
    if (!data.ok) return say('admins', data.err);
    say('admins');
    const rows = data.rows || [];
    const me = state.me.toLowerCase();
    const others = rows.filter((r) => String(r.email || '').toLowerCase() !== me).length;
    const line = rows.length === 1 && !others ? 'Just you: there is one admin.'
      : `${count(rows.length)} admins: you${others ? ` and ${count(others)} other${others === 1 ? '' : 's'}` : ''}.`;
    $('[data-adm-table="admins"]').innerHTML = `<h2 class="adm-flush-title">${esc(line)}</h2>
      ${table([
        { t: 'Name', v: (r) => `${plain(r.name)}${String(r.email || '').toLowerCase() === me ? ` ${muted('(you)')}` : ''}` },
        { t: 'Email', v: (r) => plain(r.email) },
        { t: 'Joined', v: (r) => esc(dateOnly(r.joined)) },
        { t: 'Last login', v: (r) => esc(ago(r.last_login)) },
      ], rows, { empty: 'No admin is listed.' })}`;
  }

  /* ---------------------------------------------------------------- the page builds itself (the owner, 9 Nov 2026) */
  // build-motion.js: a few cursors draw, drag, scale and type the page. The header and the menu at once; a part of the
  // page the first time it is opened, as soon as its figures are in (unseen until then, 3 s at most).
  const builder = window.rzgsBuild && window.rzgsBuild.active() ? window.rzgsBuild : null;
  const BUILD_BLOCKS = '.adm-head, .adm-nav, .adm-view-head, .adm-tools, .adm-lead, .adm-tile, .dash-panel, .adm-statement > *';
  const BUILD_BITS = '.adm-tile-label, .adm-num, .adm-sub, .adm-empty, .adm-count, .adm-chart-foot, .dash-hint, p, summary, a';
  const builtViews = new Set();
  function buildView(name, ready) {
    if (!builder || builtViews.has(name)) return;
    builtViews.add(name);
    const view = $(`[data-adm-view="${name}"]`);
    view.classList.add('rzb-wait');
    Promise.race([ready, new Promise((done) => setTimeout(done, 3000))]).then(() => {
      view.classList.remove('rzb-wait');
      builder.play({ blocks: builder.blocksIn(view, BUILD_BLOCKS), bits: BUILD_BITS });
    });
  }
  if (builder) builder.play({ blocks: [$('.adm-head'), $('.adm-nav')], bits: BUILD_BITS });

  /* ---------------------------------------------------------------- menu */
  const VIEWS = {
    overview: viewOverview, orders: loadOrders, clients: viewClients, bots: viewBots, signups: viewSignups,
    statement: viewStatement, reports: viewReports, affiliate: viewAffiliate, traffic: viewTraffic, admins: viewAdmins,
  };
  async function run(name, fresh) {
    try {
      await VIEWS[name](fresh);
      stamp();
    } catch (error) {
      console.error(error);
      say(name, 'net');
    }
  }
  function route() {
    if (state.locked) return;
    const hash = location.hash.slice(1);
    const name = VIEWS[hash] ? hash : 'overview';
    if (name !== state.view) {
      $$('[data-adm-view]').forEach((view) => { view.hidden = view.dataset.admView !== name; });
      $$('[data-adm-go]').forEach((link) => {
        if (link.dataset.admGo === name) {
          link.setAttribute('aria-current', 'page');
          if (window.matchMedia('(max-width: 1023px)').matches) link.scrollIntoView({ block: 'nearest', inline: 'center' });
        } else {
          link.removeAttribute('aria-current');
        }
      });
      document.title = `${VIEW_NAMES[name]} · Admin — RZGS-PRO`;
      const top = $('.adm-body').getBoundingClientRect().top;
      if (state.view && top < 0) window.scrollTo({ top: window.scrollY + top - 12 });
      state.view = name;
    }
    buildView(name, run(name));
  }
  window.addEventListener('hashchange', route);

  // period switches and filter chips
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-adm-period] button, [data-adm-filter] button');
    if (!button) return;
    const group = button.parentElement;
    $$('button', group).forEach((one) => one.setAttribute('aria-pressed', String(one === button)));
    if (group.dataset.admFilter) {
      state.filter = button.dataset.filter;
      viewClients();
      return;
    }
    const key = group.dataset.admPeriod;
    state.period[key] = button.dataset.period;
    $$('[data-adm-send]').forEach(unsure);
    $$('[data-adm-send-msg]').forEach((line) => { line.hidden = true; });
    run(state.view);
  });
  let typing = 0;
  $('[data-adm-search="clients"]').addEventListener('input', (event) => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.search = event.target.value; viewClients(); }, 120);
  });

  $('[data-adm-refresh]').addEventListener('click', () => {
    cache.clear();
    loadOrders();
    run(state.view, true);
  });

  /* ---------------------------------------------------------------- orders: approve or refuse */
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-approve], [data-refuse]');
    if (!button) return;
    const article = button.closest('[data-order]');
    article.querySelectorAll('button').forEach((one) => { one.disabled = true; });
    const result = await call('admin_decide', {
      order: Number(article.dataset.order),
      approve: button.hasAttribute('data-approve'),
      note: article.querySelector('.adm-note').value,
    });
    if (!result.ok) {
      article.querySelector('.adm-why').textContent = `That did not work (${result.code}). The list is loaded again.`;
    }
    cache.clear();
    setTimeout(loadOrders, result.ok ? 0 : 1800);
  });

  /* ---------------------------------------------------------------- a Diamond plan sold on Telegram */
  const GIVE_WORDS = {
    email_bad: 'Please type the email of the client\'s website account.',
    mt5_bad: 'That is not an MT5 number. It has 5 to 12 digits and no letters.',
    no_account: 'No website account has this email. Ask the client to sign up on rzgspro.com first, then try again.',
    mt5_taken: 'This MT5 number is already used on another account.',
    not_admin: 'This page is for the owner of the site.',
  };
  const giveForm = $('[data-adm-give]');
  const giveLine = $('[data-adm-give-msg]');
  const giveGo = $('[data-adm-give-go]');
  const giveSay = (html) => { giveLine.innerHTML = html; giveLine.hidden = false; };
  const giveReset = () => { delete giveForm.dataset.sure; giveGo.textContent = 'Give Diamond'; };
  giveForm.addEventListener('input', () => { giveReset(); giveLine.hidden = true; });
  giveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = giveForm.elements.email.value.trim();
    const account = giveForm.elements.account.value.replace(/\s+/g, '');
    // asked once more: this starts a plan for a real client
    if (!giveForm.dataset.sure) {
      giveForm.dataset.sure = '1';
      giveGo.textContent = 'Yes, give it';
      giveSay(`Give Diamond for 30 days to <b>${esc(email)}</b>, MT5 <b>${esc(account)}</b>?`);
      return;
    }
    giveGo.disabled = true;
    const result = await call('admin_give', { email, account });
    giveGo.disabled = false;
    giveReset();
    if (result.ok && result.licence) {
      giveSay(`Done. It is on their dashboard, until ${when(result.licence.expires_at)}.<br>Bot Password: <code>${esc(result.licence.bot_password)}</code><br>App Password: <code>${esc(result.licence.app_password)}</code>`);
      giveForm.reset();
    } else if (result.ok) {
      giveSay('It could not be finished by itself. Look under Waiting for you.');
    } else if (result.code === 'paid_running') {
      giveSay(`This client has a paid plan running${result.until ? ` until ${when(result.until)}` : ''}. It has to end first, or they can cancel it under See plans.`);
    } else {
      giveSay(esc(GIVE_WORDS[result.code] || OLD_FUNCTION));
    }
    cache.clear();
    loadOrders();
  });

  /* ---------------------------------------------------------------- statements: broker income, send to Telegram */
  $('[data-adm-load-brokers]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const kind = state.period.statement;
    button.disabled = true;
    button.textContent = 'Loading... (a few seconds)';
    const result = await call('admin_statement', { kind });
    button.disabled = false;
    const got = result.ok && result.figures;
    if (got) state.brokers[kind] = { ...result.figures, at: Date.now() };
    button.textContent = state.brokers[kind] ? 'Load broker income again' : 'Load broker income';
    if (state.view === 'statement' && state.period.statement === kind) await viewStatement();
    if (!got) $('[data-adm-brokers]').innerHTML = `<p class="form-msg is-bad">${esc(SEND_WORDS[result.code] || OLD_FUNCTION)}</p>`;
  });

  function unsure(button) {
    clearTimeout(button._wait);
    if (!button.dataset.sure) return;
    delete button.dataset.sure;
    $('span', button).textContent = button.dataset.label;
  }
  function tell(line, text, tone) {
    line.textContent = text;
    line.hidden = false;
    line.classList.toggle('is-good', tone === 'good');
    line.classList.toggle('is-bad', tone === 'bad');
  }
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-adm-send]');
    if (!button || button.disabled) return;
    const what = button.dataset.admSend;
    const line = $(`[data-adm-send-msg="${what}"]`);
    const label = $('span', button);
    const job = what === 'statement' ? { kind: state.period.statement } : { list: what, range: state.period[what] };
    const name = what === 'statement' ? `The ${KIND_NAMES[job.kind].toLowerCase()} statement`
      : what === 'payments' ? `The payment statement (${RANGE_WORDS[job.range]})` : `The customer list (${RANGE_WORDS[job.range]})`;
    // asked once more on the button itself: this posts in the report group
    if (!button.dataset.sure) {
      button.dataset.sure = '1';
      button.dataset.label = label.textContent;
      label.textContent = 'Yes, send it now';
      tell(line, `${name} goes to your report group in Telegram, as Excel and PDF.${what === 'statement' ? ' It gets the next statement number.' : ''} Press again to send.`);
      button._wait = setTimeout(() => { unsure(button); line.hidden = true; }, 8000);
      return;
    }
    clearTimeout(button._wait);
    button.disabled = true;
    label.textContent = 'Sending...';
    const result = await call('admin_send', job);
    button.disabled = false;
    unsure(button);
    if (result.ok) tell(line, `Sent. ${name} is in your report group.`, 'good');
    else tell(line, SEND_WORDS[result.code] || OLD_FUNCTION, 'bad');
  });

  /* ---------------------------------------------------------------- start */
  (async () => {
    await session();
    loadOrders().then(stamp);
    route();
  })();
  // every 30 s: the orders, and the live views (bots online, today's figures)
  setInterval(() => {
    if (state.locked || document.hidden || document.activeElement.matches('input, textarea')) return;
    loadOrders();
    if (state.view === 'overview' || state.view === 'bots') run(state.view, true);
  }, 30000);
})();
