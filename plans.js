/* ==========================================================================
   RZGS-PRO: the free-trial bar at the top of the page, the client's profile in
   the header, and the plans pop-up. Every page with the site header uses this file.
   The plans are written once, in PLANS below.

   A link with data-plans opens the plans: for someone with no account yet it goes
   to the sign-up page first, and the plans open when they are back (see auth.js).
   ========================================================================== */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://zaziizzsbytkdlatoutv.supabase.co';
  // Publishable key: made to be used in the browser. Row-level security protects the data.
  const SUPABASE_KEY = 'sb_publishable_ojfdWkyt22zlG0Uz_CUd4w_IufedKpK';
  const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0';
  const AUTH_KEY = 'sb-zaziizzsbytkdlatoutv-auth-token'; // where supabase-js keeps the sign-in

  const AFTER_KEY = 'rzgs_after_login'; // the page to come back to after signing in
  const BAR_KEY = 'rzgs_trial_bar_closed';
  const PROFILE_KEY = 'rzgs_profile'; // name, picture and plan, so the header is right at once
  const BUSY_MS = 900; // how long "Processing..." stays at least
  const COMMUNITY_URL = 'https://t.me/+NvCIdtTmMIViMjg9';
  const JUST_IN_KEY = 'rzgs_just_in'; // auth.js leaves this for the next page, right after logging in
  const PRICES_KEY = 'rzgs_prices'; // the VIP price, as web_prices() said it last (for this visit)

  // This file sits in the site's top folder, so other pages are found from here on any page.
  const SITE = new URL('./', document.currentScript.src);
  const pageUrl = (name) => new URL(name, SITE).href;

  const read = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* private window */ } };
  const forget = (key) => { try { localStorage.removeItem(key); } catch (e) { /* private window */ } };
  const parse = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const signedIn = () => Boolean(read(AUTH_KEY));

  const icon = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
    check: icon('<path d="M20 6 9 17l-5-5"/>'),
    gift: icon('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
    zap: icon('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
    hexagon: icon('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
    gem: icon('<path d="M6 3h12l4 6-10 13L2 9zM11 3 8 9l4 13 4-13-3-6M2 9h20"/>'),
    gold: icon('<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>'),
    layers: icon('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>'),
    phone: icon('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
    pulse: icon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    shield: icon('<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.500 8 10 8 10z"/>'),
    user: icon('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    gear: icon('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
    group: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
    logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    right: icon('<path d="m9 18 6-6-6-6"/>'),
    updown: icon('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'),
    crown: icon('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294zM5 21h14"/>'),
    calc: icon('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>'),
    share: icon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>'),
    send: icon('<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>'),
    timer: icon('<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>'),
  };
  const SPINNER = '<span class="plan-spin" aria-hidden="true"></span>';

  /* ---------------------------------------------------------------- the plans */
  // Only what the License Rules really give. `id` is the plan's name on the website (web_users.plan).
  // VIP took the place of Diamond (the owner, 19 Nov 2026): any broker, VIP mode in the app, a month or a year,
  // sold right here like Elite. Its price is the owner's to set (admin page), so it is read from web_prices().
  const NEEDS_PARTNER = 'An MT5 hedging account opened with a partner broker: Exness, Investizo or Lirunex';
  const NEEDS_PC = 'A computer or VPS that keeps MT5 open';
  const PLANS = [
    {
      id: 'trial', name: 'Free', tone: 'free', icon: 'zap', chip: '7 days',
      lead: 'Get familiar with the strategy.',
      box: ['7 days on 1 MT5 account', 'Starts when your trial is approved', 'One free trial per person'],
      amount: '$0', per: '/ 7 days', button: 'Claim Free Trial', under: 'No payment needed',
      get: ['The same RZGS-PRO gold bot as Elite', 'Bot file and Bot Password on your dashboard', 'Phone control app', 'P/L Report in your account'],
      needs: [NEEDS_PARTNER, NEEDS_PC],
      not: ['VIP mode', 'Any broker of your choice'],
    },
    {
      id: 'elite', name: 'Elite', tone: 'elite', icon: 'hexagon', chip: 'Most popular',
      lead: 'For traders with a partner broker account.',
      box: ['30 days on 1 MT5 account', 'Starts when your bot is delivered', 'You can renew once it has ended'],
      amount: '$5', per: '/ month', button: 'Upgrade Plan', under: 'You pay by KHQR on this website',
      get: ['The RZGS-PRO gold bot for 30 days', 'Bot file and Bot Password on your dashboard', 'Phone control app', 'P/L Report in your account'],
      needs: [NEEDS_PARTNER, NEEDS_PC],
      not: ['VIP mode', 'Any broker of your choice'],
    },
    {
      id: 'vip', name: 'VIP', tone: 'vip', icon: 'crown', chip: 'Any broker', billing: true,
      lead: 'VIP mode, at any broker you like.',
      box: ['30 days on 1 MT5 account', 'Works at any broker', 'VIP mode unlocked in your app'],
      amount: '$29', per: '/ month', button: 'Go VIP', under: 'You pay by KHQR on this website',
      get: ['Everything in Elite', 'VIP mode: a first trade in profit closes after a short countdown', 'Your own VIP grid distance, set in the app', 'Keep your own broker: no partner account needed'],
      needs: ['An MT5 hedging account at any broker, one that can trade gold', NEEDS_PC],
    },
  ];
  const planById = (id) => PLANS.find((plan) => plan.id === id);

  /* ---------------------------------------------------------------- the VIP price */
  // The owner sets a month in $ and the yearly saving in % on the admin page; web_prices() in the database gives the
  // year price from them, so the checkout and every page say the same. Until it answers, the first price is shown.
  const money = (value) => {
    const cents = Math.round(Number(value) * 100) / 100;
    return `$${Number.isInteger(cents) ? cents : cents.toFixed(2)}`;
  };
  let prices = (() => {
    try { return JSON.parse(sessionStorage.getItem(PRICES_KEY)) || null; } catch (e) { return null; }
  })() || { month: 29, year_off: 17, year: 289, year_save: 59 };
  let pricesAsked = null;
  let billing = 1; // the VIP card: 1 = a month, 12 = a year
  function usePrices(vip) {
    prices = { month: Number(vip.month), year_off: Number(vip.year_off), year: Number(vip.year), year_save: Number(vip.year_save) };
    planById('vip').amount = money(prices.month);
  }
  usePrices(prices);
  function loadPrices() {
    if (pricesAsked) return pricesAsked;
    pricesAsked = fetch(`${SUPABASE_URL}/rest/v1/rpc/web_prices`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    }).then((response) => (response.ok ? response.json() : null)).then((data) => {
      const vip = data && data.vip;
      if (vip && Number(vip.month) > 0 && Number(vip.year) > 0) {
        usePrices(vip);
        try { sessionStorage.setItem(PRICES_KEY, JSON.stringify(prices)); } catch (e) { /* private window */ }
      }
      paintPrices();
      document.dispatchEvent(new CustomEvent('rzgs:prices'));
      return prices;
    }).catch(() => prices);
    return pricesAsked;
  }
  // Words with the VIP price in them, on any page: <span data-vip-price="month | year | save | off | permonth">
  function paintPrices() {
    const said = { month: money(prices.month), year: money(prices.year), save: money(prices.year_save),
      off: `${prices.year_off}%`, permonth: money(prices.year / 12) };
    document.querySelectorAll('[data-vip-price]').forEach((el) => {
      if (said[el.dataset.vipPrice]) el.textContent = said[el.dataset.vipPrice];
    });
    paintVip();
  }

  // The VIP card of the plans: a month or a year, at the price of the moment.
  function paintVip() {
    const card = dialog && dialog.querySelector('[data-plan="vip"]');
    if (!card) return;
    const year = billing === 12;
    const saves = prices.year_off > 0 && prices.year_save > 0;
    card.querySelectorAll('[data-bill]').forEach((choice) => choice.setAttribute('aria-pressed', String(Number(choice.dataset.bill) === billing)));
    const off = card.querySelector('[data-bill-off]');
    off.textContent = `Save ${prices.year_off}%`;
    off.hidden = !saves;
    card.querySelector('[data-plan-amount]').textContent = money(year ? prices.year : prices.month);
    card.querySelector('[data-plan-per]').textContent = year ? '/ year' : '/ month';
    card.querySelector('[data-plan-box]').textContent = `${year ? 365 : 30} days on 1 MT5 account`;
    const save = card.querySelector('[data-plan-save]');
    save.textContent = year ? `Only ${money(prices.year / 12)} a month. You save ${money(prices.year_save)}.` : `Pay for a year and save ${money(prices.year_save)}.`;
    save.hidden = !saves;
  }

  const EVERY_PLAN = [
    ['gold', 'Trades gold by fixed rules', 'A buy and a sell open together on XAUUSD. The bot does not try to predict the price.'],
    ['layers', 'Grid and basket close', 'The winning side takes profit. The holding side closes together at the basket target.'],
    ['phone', 'Control from your phone', 'Activate, pause, or close buys, sells or everything. Every close asks you to confirm.'],
    ['pulse', 'Live numbers', 'Balance, equity, today\'s profit and drawdown, plus every open trade on a gold chart.'],
    ['shield', 'Limits you set', 'Max spread, max total lots, Smart shield and a daily target. The bot keeps them.'],
    ['calc', 'Risk calculator', 'See the floating result at each grid level before you choose your lots.'],
  ];

  function listHtml(title, items, mark, kind = '') {
    if (!items || !items.length) return '';
    return `<div class="pc-list ${kind}"><h4>${title}</h4><ul>${items.map((item) => `<li>${mark}<span>${item}</span></li>`).join('')}</ul></div>`;
  }

  function cardHtml(plan) {
    // VIP: a month or a year (the yearly saving is the owner's to set)
    const bill = plan.billing ? `<div class="pc-bill" role="group" aria-label="Pay for">
        <button type="button" data-bill="1" aria-pressed="true">Monthly</button>
        <button type="button" data-bill="12" aria-pressed="false">Yearly <i data-bill-off>Save ${prices.year_off}%</i></button>
      </div>` : '';
    return `<article class="pc pc--${plan.tone}" data-plan="${plan.id}"><div class="pc-in">
      <div class="pc-top">
        <span class="pc-icon">${ICONS[plan.icon]}</span>
        <h3>${plan.name}</h3>
        <span class="pc-chip" data-plan-chip>${plan.chip}</span>
      </div>
      <p class="pc-lead">${plan.lead}</p>
      <div class="pc-box"><strong data-plan-box>${plan.box[0]}</strong>${plan.box.slice(1).map((line) => `<span>${line}</span>`).join('')}</div>
      ${bill}
      <p class="pc-price"><b data-plan-amount>${plan.amount}</b><span data-plan-per>${plan.per}</span></p>
      ${plan.billing ? '<p class="pc-save" data-plan-save></p>' : ''}
      <span class="plan-btn-glow"><button class="plan-btn" type="button" data-plan-go="${plan.id}"><span data-plan-label>${plan.button}</span></button></span>
      <p class="pc-under">${plan.under}</p>
      ${listHtml('What you get', plan.get, ICONS.check, 'pc-list--hot')}
      ${listHtml('What you need', plan.needs, ICONS.check)}
      ${listHtml('Not included', plan.not, ICONS.x, 'pc-list--off')}
      ${listHtml('Good to know', plan.note, ICONS.check)}
    </div></article>`;
  }

  /* ---------------------------------------------------------------- the account */
  // supabase-js is only loaded when the plans need it: most visitors never open them.
  let dbPromise = null;
  function getDb() {
    if (window.rzgsDb) return Promise.resolve(window.rzgsDb); // auth.js made one on this page
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const make = () => resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      }));
      if (window.supabase) { make(); return; }
      const script = document.createElement('script');
      script.src = SUPABASE_LIB;
      script.onload = make;
      script.onerror = () => reject(new Error('The sign-in library did not load'));
      document.head.append(script);
    });
    dbPromise.catch(() => { dbPromise = null; }); // the next click tries again
    return dbPromise;
  }

  // Resolves to the sign-in, null when there is none any more, undefined when we can't tell (no connection).
  async function activeSession() {
    try {
      const db = await getDb();
      const { data } = await db.auth.getSession();
      return data.session || null;
    } catch (e) {
      return undefined;
    }
  }

  // The checkout box (checkout.js) is only loaded when someone is buying.
  let checkoutPromise = null;
  function loadCheckout() {
    if (window.rzgsCheckout) return Promise.resolve(window.rzgsCheckout);
    if (checkoutPromise) return checkoutPromise;
    checkoutPromise = new Promise((resolve, reject) => {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = pageUrl('checkout.css?v=2');
      // before the light theme (theme.css), which has to stay the last stylesheet
      const theme = document.querySelector('link[href*="theme.css"]');
      if (theme) theme.before(style); else document.head.append(style);
      const script = document.createElement('script');
      script.src = pageUrl('checkout.js?v=7');
      script.onload = () => resolve(window.rzgsCheckout);
      script.onerror = () => reject(new Error('The checkout did not load'));
      document.head.append(script);
    });
    checkoutPromise.catch(() => { checkoutPromise = null; }); // the next click tries again
    return checkoutPromise;
  }

  // Back to this page after signing up or logging in, where the plans then open. to: somewhere else to come back to
  // (a path on this site), page: the log in page instead of sign-up.
  function toSignUp(to = '', page = 'signup') {
    const here = location.pathname;
    write(AFTER_KEY, JSON.stringify({ to: to || (/(login|signup|reset-password)(\.html)?$/.test(here) ? SITE.pathname : here), at: Date.now() }));
    location.href = pageUrl(page);
  }

  /* ---------------------------------------------------------------- the profile in the header */
  const storedProfile = () => parse(read(PROFILE_KEY)) || {};

  function paintProfile(profile) {
    paintMenu(profile);
    const name = String(profile.full_name || profile.username || profile.email || '').trim();
    const first = name.split(/[\s@]/)[0] || 'My account';
    document.querySelectorAll('[data-profile]').forEach((link) => {
      link.setAttribute('aria-label', `Your profile: ${first}`);
      const label = link.querySelector('[data-profile-name]');
      if (label) label.textContent = first;
      const pic = link.querySelector('[data-profile-pic]');
      if (!pic) return;
      pic.textContent = name ? first[0].toUpperCase() : '';
      if (profile.avatar_url) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = profile.avatar_url;
        img.addEventListener('error', () => img.remove());
        pic.append(img);
      }
    });
  }

  /* ---------------------------------------------------------------- the account card */
  // One card in three places: under the profile button of the header (computers, on hover), at the bottom of the phone
  // menu, and at the bottom of the dashboard's own menu (the owner's sketch, 2 Nov 2026). The last two open with a tap.
  const PLAN_DAYS = { trial: 7, elite: 30, vip: 30, diamond: 30 };
  let menu = null;
  const cards = [];

  const accountCardHtml = () => `<div class="pm-in">
      <a class="pm-head" href="${pageUrl('dashboard#core')}" data-profile>
        <span class="nav-profile-pic pm-pic" data-profile-pic aria-hidden="true"></span>
        <span class="pm-who"><b data-pm-name></b><small data-pm-plan></small></span>
        ${ICONS.right}
      </a>
      <div class="pm-box" data-pm-box>
        <div class="pm-box-top"><span>Plan</span><b data-pm-left></b></div>
        <div class="pm-meter" data-pm-meter aria-hidden="true">${'<i></i>'.repeat(PLAN_DAYS.elite)}</div>
        <p class="pm-until" data-pm-until></p>
        <div class="pm-go">
          <span>${ICONS.crown}<span data-pm-go></span></span>
          <a class="btn btn-primary btn-sm" href="${pageUrl('./#plans')}" data-plans data-pm-cta></a>
        </div>
      </div>
      <nav class="pm-links" aria-label="Your account">
        <a href="${pageUrl('dashboard#core')}">${ICONS.user}View profile</a>
        <a href="${pageUrl('app')}">${ICONS.phone}Control App</a>
        <a href="${pageUrl('manage-account')}">${ICONS.gear}Manage account</a>
        <a href="${pageUrl('manage-account#affiliate')}">${ICONS.share}Affiliate program</a>
        <a href="${COMMUNITY_URL}" target="_blank" rel="noopener">${ICONS.group}Community<small>Telegram group</small></a>
      </nav>
      <button class="pm-out" type="button" data-sign-out>${ICONS.logout}Log out</button>
    </div>`;

  function buildMenu(chip) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-profile-wrap';
    chip.before(wrap);
    wrap.append(chip);
    menu = document.createElement('div');
    menu.className = 'pm';
    menu.innerHTML = accountCardHtml();
    cards.push(menu);
    wrap.append(menu);
    // A click here always answers: the box goes away, even with the pointer still on it. It can open again once the
    // pointer has left, or when the keyboard comes back to it.
    wrap.addEventListener('click', () => {
      wrap.classList.add('is-shut');
      if (wrap.contains(document.activeElement)) document.activeElement.blur();
    });
    wrap.addEventListener('pointerleave', () => wrap.classList.remove('is-shut'));
    wrap.addEventListener('focusin', () => wrap.classList.remove('is-shut'));
    window.addEventListener('pageshow', () => wrap.classList.remove('is-shut'));
  }

  // A card that opens with a tap: built in `slot`, opened and closed by `button`, which shows the name and plan too.
  function mountCard(slot, button) {
    slot.innerHTML = accountCardHtml();
    const scope = slot.parentElement;
    cards.push(scope);
    const open = (yes) => {
      slot.hidden = !yes;
      button.setAttribute('aria-expanded', String(yes));
    };
    open(false);
    button.addEventListener('click', () => open(slot.hidden));
    document.addEventListener('click', (event) => { if (!slot.hidden && !scope.contains(event.target)) open(false); });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || slot.hidden) return;
      open(false);
      button.focus();
    });
    slot.addEventListener('click', (event) => { if (event.target.closest('a, button')) open(false); });
    paintProfile(storedProfile());
  }

  // the phone menu of every page but the dashboard (which has its own): the profile button at its bottom
  function buildNavMe() {
    const nav = document.getElementById('primary-nav');
    if (!nav || !signedIn() || document.body.classList.contains('acc-page') || nav.querySelector('.nav-me')) return;
    const box = document.createElement('div');
    box.className = 'nav-me signed-only';
    box.innerHTML = `<div class="pm-slot" hidden></div>
      <button class="nav-me-btn" type="button" data-profile aria-expanded="false">
        <span class="nav-profile-pic" data-profile-pic aria-hidden="true"></span>
        <span class="pm-who"><b data-pm-name></b><small data-pm-plan></small></span>
        ${ICONS.updown}
      </button>`;
    nav.append(box);
    mountCard(box.firstElementChild, box.lastElementChild);
  }

  function paintMenu(profile) {
    const chip = document.querySelector('.header-actions [data-profile]');
    if (chip && !menu) buildMenu(chip);
    cards.forEach((card) => paintCard(card, profile));
  }

  // One bar a day of the plan (the owner, 2026-11-03): lit for each day left, dark for the days used. No plan: 30 dark
  // bars. A plan given more days than its length gets a bar for each of them; a year (VIP) gets one bar a month.
  function paintMeter(meter, planId, ends, left, running) {
    const days = !planId ? PLAN_DAYS.elite : Math.max(PLAN_DAYS[planId] || 30, running && ends ? left : 0);
    const byMonth = days > 62;
    const total = byMonth ? 12 : days;
    if (meter.children.length !== total) meter.innerHTML = '<i></i>'.repeat(total);
    const lit = !running ? 0 : !ends ? total : byMonth ? Math.min(12, Math.ceil(left / 30.42)) : Math.min(total, left);
    [...meter.children].forEach((part, index) => part.classList.toggle('on', index < lit));
  }

  function paintCard(menu, profile) {
    const say = (selector, text) => { menu.querySelectorAll(selector).forEach((el) => { el.textContent = text; }); };
    const plan = planById(profile.plan);
    const ends = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
    const left = ends ? Math.ceil((ends - Date.now()) / 86400000) : 0;
    const running = Boolean(plan) && (!ends || left > 0);
    say('[data-pm-name]', String(profile.full_name || profile.username || profile.email || 'My account').trim());
    say('[data-pm-plan]', !plan ? 'No plan yet' : running ? `${plan.name} plan` : `${plan.name} plan ended`);
    say('[data-pm-left]', running && ends ? `${left} ${left === 1 ? 'day' : 'days'} left` : '');
    say('[data-pm-until]', !plan ? 'Start with 7 free days' : ends ? `${running ? 'Until' : 'Ended'} ${dateText(ends)}` : 'No end date');
    paintMeter(menu.querySelector('[data-pm-meter]'), plan && plan.id, ends, left, running);
    menu.querySelector('[data-pm-box]').dataset.tone = running && ends && left <= 3 ? 'warn' : '';
    const [go, cta] = !plan ? ['Start free', 'Get your bot']
      : !running ? [plan.id === 'trial' ? 'Choose a plan' : 'Renew your plan', 'See plans']
        : plan.id === 'trial' ? ['Go Elite', 'Upgrade']
          : plan.id === 'elite' ? ['Unlock VIP mode', 'Go VIP']
            : ['Your plan is the top one', 'See plans'];
    say('[data-pm-go]', go);
    say('[data-pm-cta]', cta);
  }

  // Name, picture and plan. Asked for with the sign-in supabase-js saved, as long as it is still good: these pages
  // don't load the library for this. Only a picture from the person's own folder is ever shown (as on the dashboard).
  // Gives back what the server said, or nothing when it could not be asked.
  async function loadProfile() {
    if (!signedIn()) { forget(PROFILE_KEY); return null; }
    const session = parse(read(AUTH_KEY)) || {};
    const user = session.user || {};
    let profile = { ...(user.user_metadata || {}), email: user.email, ...storedProfile() };
    paintProfile(profile);
    if (!user.id || !session.access_token || (session.expires_at || 0) * 1000 < Date.now()) return null;
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/web_users?select=full_name,username,avatar_url,plan,plan_expires_at&id=eq.${encodeURIComponent(user.id)}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) return null;
      const [row] = await response.json();
      if (!row) return null;
      const folder = `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/`;
      profile = { ...profile, ...row, avatar_url: String(row.avatar_url || '').startsWith(folder) ? row.avatar_url : '' };
      write(PROFILE_KEY, JSON.stringify(profile));
      paintProfile(profile);
      hideBarForClients(profile);
      return profile;
    } catch (e) { /* the name from the sign-in stays */ }
    return null;
  }

  /* ---------------------------------------------------------------- the bar at the top */
  let bar = null;

  // Closed for this visit only: the offer is back the next time (the owner, 2026-11-02).
  const barClosed = () => { try { return sessionStorage.getItem(BAR_KEY); } catch (e) { return null; } };

  function closeBar() {
    try { sessionStorage.setItem(BAR_KEY, '1'); } catch (e) { /* private window */ }
    if (!bar) return;
    const closing = bar;
    bar = null;
    closing.style.height = `${closing.offsetHeight}px`;
    closing.getBoundingClientRect(); // draws the height above, so the change below is animated
    closing.classList.add('is-closing');
    const done = () => closing.remove();
    closing.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
  }

  function hideBarForClients(profile) {
    if (bar && profile.plan) { bar.remove(); bar = null; }
  }

  function showBar() {
    const header = document.querySelector('.site-header');
    forget(BAR_KEY); // from when closing it hid the offer for good
    if (!header || document.body.dataset.authPage || barClosed() || storedProfile().plan) return;
    bar = document.createElement('div');
    bar.className = 'trial-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Free trial offer');
    // during the visitor's welcome offer: 10 days, and the time it has left
    const welcome = !signedIn() && welcomeUntil();
    bar.innerHTML = `<div class="trial-bar-in">
      <span class="trial-bar-chip">${ICONS.gift}<span class="trial-bar-chip-word">Free trial</span></span>
      <p class="trial-bar-text">${welcome
        ? `<strong>Start your free 10-day trial.</strong><span class="trial-bar-more"> Sign up in <b data-bar-left></b> to get 10 days instead of 7.</span>`
        : '<strong>Start your free 7-day trial.</strong><span class="trial-bar-more"> Try the gold bot on your own MT5 account, with no payment.</span>'}</p>
      <a class="trial-bar-go" href="${pageUrl('signup')}" data-plans>Claim now</a>
      <button class="trial-bar-x" type="button" aria-label="Close this offer">${ICONS.x}</button>
    </div>`;
    bar.querySelector('.trial-bar-x').addEventListener('click', closeBar);
    header.before(bar);
    if (welcome) tick();
  }

  /* ---------------------------------------------------------------- the plans pop-up */
  let dialog = null;
  let current = { plan: null, name: 'No plan yet', detail: '', price: '$0' };

  const dateText = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // On a running Elite plan, VIP can start now: it takes the place of Elite once paid (the checkout function allows
  // this one move while a paid plan runs; nothing is cancelled first).
  const movingUp = (now) => now.plan === 'elite' && !now.ended;

  // What the person has now, for the pop-up and the Elite confirmation.
  function describeCurrent(profile) {
    const plan = planById(profile.plan);
    if (!plan) return { plan: null, name: 'No plan yet', detail: '', price: '$0' };
    const ends = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
    const ended = Boolean(ends) && ends < new Date();
    return {
      plan: plan.id,
      name: plan.name,
      ended,
      detail: ends ? `${ended ? 'ended' : 'until'} ${dateText(ends)}` : '',
      endsText: ends ? dateText(ends) : '',
      endsAt: profile.plan_expires_at,
      price: plan.amount,
    };
  }

  function setBusy(button, busy) {
    const label = button.querySelector('[data-plan-label]');
    if (busy) {
      button.dataset.was = label.innerHTML;
      button.style.minWidth = `${button.offsetWidth}px`;
      label.innerHTML = `${SPINNER}Processing...`;
      button.disabled = true;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
    } else {
      if (button.dataset.was) label.innerHTML = button.dataset.was;
      button.disabled = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.style.minWidth = '';
    }
  }

  // The buttons follow the plan the person is on.
  function renderCurrent() {
    if (!dialog) return;
    const now = dialog.querySelector('[data-plans-now]');
    now.hidden = !current.plan;
    now.textContent = current.plan ? `Your plan: ${current.name}${current.detail ? ` · ${current.detail}` : ''}` : '';
    // a paid plan that is running: nothing else starts until it ends or is cancelled
    const paidRunning = Boolean(current.plan) && current.plan !== 'trial' && !current.ended;
    dialog.querySelector('[data-plans-rule]').hidden = !paidRunning;
    PLANS.forEach((plan) => {
      const card = dialog.querySelector(`[data-plan="${plan.id}"]`);
      const mine = current.plan === plan.id;
      card.classList.toggle('is-mine', mine);
      card.querySelector('[data-plan-chip]').textContent = mine ? 'Your plan' : plan.chip;
      const button = card.querySelector('[data-plan-go]');
      if (button.classList.contains('is-busy')) return;
      const label = button.querySelector('[data-plan-label]');
      const running = mine && !current.ended;
      if (plan.id === 'trial' && mine) {
        // one free trial per person
        label.textContent = current.ended ? 'Trial used' : 'Trial running';
        button.disabled = true;
      } else if (running) {
        // a plan can be renewed once it has ended, not before
        label.textContent = 'Plan running';
        button.disabled = true;
      } else if (plan.id === 'vip' && movingUp(current)) {
        label.textContent = 'Upgrade to VIP';
        button.disabled = false;
      } else if (paidRunning) {
        label.textContent = 'After your plan ends';
        button.disabled = true;
      } else {
        label.textContent = mine ? 'Renew Plan' : plan.button;
        button.disabled = false;
      }
      const upgrade = plan.id === 'vip' && movingUp(current);
      card.querySelector('.pc-under').textContent = upgrade ? `Upgrade now. VIP starts when you pay and takes the place of your ${current.name} plan.`
        : paidRunning && current.endsText ? `You can ${running ? 'renew' : 'start this'} after ${current.endsText}` : plan.under;
    });
    paintVip();
    // the promotions: 10 free days for an account made during the welcome offer, and a free month of Elite from the
    // Affiliate program (the checkout function then skips the payment)
    const days = (promo && promo.trial_days) || 7;
    const trial = dialog.querySelector('[data-plan="trial"]');
    dialog.querySelector('[data-plans-lead]').textContent = `Start free for ${days} days, then pick the plan that fits how you trade.`;
    trial.querySelector('[data-plan-box]').textContent = `${days} days on 1 MT5 account`;
    trial.querySelector('[data-plan-per]').textContent = `/ ${days} days`;
    if (current.plan !== 'trial') trial.querySelector('[data-plan-chip]').textContent = `${days} days`;
    const elite = dialog.querySelector('[data-plan="elite"]');
    const eliteButton = elite.querySelector('[data-plan-go]');
    const freeMonth = Boolean(promo && promo.left > 0) && !eliteButton.disabled;
    elite.querySelector('[data-plan-amount]').textContent = freeMonth ? '$0' : planById('elite').amount;
    elite.querySelector('[data-plan-per]').textContent = freeMonth ? '/ free month' : planById('elite').per;
    if (freeMonth && !eliteButton.classList.contains('is-busy')) {
      eliteButton.querySelector('[data-plan-label]').textContent = 'Use my free month';
      elite.querySelector('.pc-under').textContent = 'From inviting 5 friends. No payment needed';
    }
  }

  async function freshCurrent() {
    try {
      const db = await getDb();
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      const [{ data }] = await Promise.all([
        db.from('web_users').select('plan, plan_expires_at').eq('id', session.user.id).maybeSingle(),
        loadInvites(true),
      ]);
      if (data) current = describeCurrent(data);
      renderCurrent();
    } catch (e) { /* what the header already knew stays */ }
  }

  function lockPage(locked) {
    const root = document.documentElement;
    document.body.style.paddingRight = locked ? `${window.innerWidth - root.clientWidth}px` : '';
    root.classList.toggle('plans-open', locked);
  }

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'plans';
    dialog.setAttribute('aria-labelledby', 'plans-title');
    dialog.innerHTML = `
      <button class="plans-x" type="button" data-plans-close aria-label="Close the plans">${ICONS.x}</button>
      <div class="plans-wrap" tabindex="-1" autofocus>
        <header class="plans-head">
          <h2 id="plans-title">Choose your <span class="text-gradient">plan</span></h2>
          <p data-plans-lead>Start free for 7 days, then pick the plan that fits how you trade.</p>
          <p class="plans-now" data-plans-now hidden></p>
          <p class="plans-rule" data-plans-rule hidden>A new plan can start when this one ends. Don't want to wait? <button class="plans-cancel" type="button" data-plans-cancel>Cancel plan</button></p>
        </header>
        <div class="plans-grid">${PLANS.map(cardHtml).join('')}</div>
        <section class="plans-every" aria-labelledby="plans-every-title">
          <h3 id="plans-every-title">In every plan</h3>
          <ul>${EVERY_PLAN.map(([mark, title, text]) => `<li><span class="pc-icon">${ICONS[mark]}</span><div><strong>${title}</strong><span>${text}</span></div></li>`).join('')}</ul>
        </section>
        <p class="plans-note">Prices in US dollars. By choosing a plan you agree to our <a href="${pageUrl('license')}">License Rules</a> and <a href="${pageUrl('terms')}">Terms &amp; Conditions</a>. <a href="${pageUrl('how-to-buy')}">See how buying works</a>. Trading gold carries risk and profit is not guaranteed: read our <a href="${pageUrl('risk-disclosure')}">Risk Disclosure</a>.</p>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-plan-go]');
      const bill = event.target.closest('[data-bill]');
      if (bill) { billing = Number(bill.dataset.bill) === 12 ? 12 : 1; paintVip(); }
      else if (button) choose(planById(button.dataset.planGo), button);
      else if (event.target.closest('[data-plans-cancel]')) goCancel();
      // the X, or the empty space around the plans
      else if (event.target.closest('[data-plans-close]') || event.target === dialog || event.target.classList.contains('plans-wrap')) dialog.close();
    });
    dialog.addEventListener('close', () => lockPage(false));
  }

  // pick: a plan to bring into view and mark (the control app's "Go VIP" comes here as rzgspro.com/#vip)
  function openPlans(pick) {
    if (!dialog) buildDialog();
    loadPrices();
    if (dialog.open) return;
    current = describeCurrent(storedProfile());
    renderCurrent();
    lockPage(true);
    if (window.rzgsMotion) window.rzgsMotion.fromTap(dialog);
    dialog.showModal();
    dialog.scrollTop = 0;
    const card = pick && dialog.querySelector(`[data-plan="${pick}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.classList.add('is-picked');
      setTimeout(() => card.classList.remove('is-picked'), 2600);
    }
    freshCurrent();
  }

  async function goCancel() {
    const checkout = await loadCheckout();
    if (dialog && dialog.open) dialog.close();
    checkout.askCancel(current.plan, current.endsAt);
  }

  // Every plan goes on in the checkout box, on this same page; with no account, signing up comes first.
  async function choose(plan, button) {
    if (button.disabled) return;
    setBusy(button, true);
    const session = await activeSession();
    if (session === null) { toSignUp(); return; }
    try {
      const [checkout] = await Promise.all([loadCheckout(), wait(BUSY_MS / 3)]);
      setBusy(button, false);
      dialog.close();
      checkout.open(plan.id, plan.billing ? { months: billing } : {});
    } catch (e) {
      setBusy(button, false);
      button.querySelector('[data-plan-label]').textContent = 'Try again';
    }
  }

  /* ---------------------------------------------------------------- log out, on the pages with no box of their own */
  let logoutBox = null;
  async function logOut(yes) {
    setBusy(yes, true);
    const line = logoutBox.querySelector('[data-logout-msg]');
    line.hidden = true;
    try {
      const db = await getDb();
      const { error } = await db.auth.signOut();
      const { data } = await db.auth.getSession();
      if (error && data.session) throw error; // still logged in: say so instead of pretending
      forget(PROFILE_KEY);
      location.replace(SITE.href);
    } catch (e) {
      setBusy(yes, false);
      line.textContent = "That didn't work just now. Check your connection and try again.";
      line.hidden = false;
    }
  }
  function openLogout() {
    if (!logoutBox) {
      logoutBox = document.createElement('dialog');
      logoutBox.className = 'plan-confirm';
      logoutBox.setAttribute('aria-labelledby', 'logout-title');
      logoutBox.innerHTML = `<div class="plan-confirm-in">
        <h2 id="logout-title">Do you want to log out?</h2>
        <p class="plan-confirm-lead">This device will be logged out. Your bot keeps running in MT5.</p>
        <p class="plan-confirm-lead pm-logout-msg" data-logout-msg role="alert" hidden></p>
        <div class="pm-logout-row">
          <button class="btn btn-ghost" type="button" data-logout-no>No</button>
          <button class="plan-btn pm-yes" type="button" data-logout-yes><span data-plan-label>Yes</span></button>
        </div>
      </div>`;
      document.body.append(logoutBox);
      logoutBox.addEventListener('click', (event) => {
        if (event.target === logoutBox || event.target.closest('[data-logout-no]')) logoutBox.close();
        const yes = event.target.closest('[data-logout-yes]');
        if (yes) logOut(yes);
      });
    }
    if (window.rzgsMotion) window.rzgsMotion.fromTap(logoutBox);
    logoutBox.showModal();
  }

  /* ---------------------------------------------------------------- the promotions (the owner, 2026-11-04) */
  // Someone with no account yet: the free trial, 10 days instead of 7 if they sign up within 24 hours of their first
  // visit (the sign-up page sends the end of those 24 hours; the database and the checkout function give the 3 days).
  // Someone logged in: invite 5 friends to get a month of Elite free, the Affiliate program (1 Website/
  // web_promotions.sql). Each box comes up by itself only now and then, never over another box, and never on the log
  // in and sign-up pages. A friend's invite link is kept for the sign-up.
  const WELCOME_KEY = 'rzgs_welcome_until';
  const REF_KEY = 'rzgs_ref';
  const KNOWN_KEY = 'rzgs_has_account'; // this browser has logged in before: no welcome offer for an account that exists
  const SEEN_KEY = 'rzgs_promo_seen';
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  // ?ref=CODE on any page: kept for 30 days, and taken out of the address
  function keepInvite() {
    const params = new URLSearchParams(location.search);
    const code = String(params.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!params.has('ref')) return;
    if (code) write(REF_KEY, JSON.stringify({ code, at: Date.now() }));
    params.delete('ref');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  }
  const invitedBy = () => {
    const ref = parse(read(REF_KEY));
    return ref && ref.code && Date.now() - ref.at < 30 * DAY ? ref.code : '';
  };

  // The 24 hours start at the first visit of someone who has never logged in here.
  function startWelcome() {
    if (signedIn()) { write(KNOWN_KEY, '1'); return; }
    if (read(KNOWN_KEY) || read(WELCOME_KEY)) return;
    write(WELCOME_KEY, String(Date.now() + DAY));
  }
  const welcomeUntil = () => {
    const until = Number(read(WELCOME_KEY)) || 0;
    return until > Date.now() && !read(KNOWN_KEY) ? until : 0;
  };
  const timeLeft = (until) => {
    const s = Math.max(0, Math.floor((until - Date.now()) / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  };

  // One clock for the bar and the box: once a second while something shows the time left.
  let clock = 0;
  function tick() {
    const until = welcomeUntil();
    const [h, m, s] = timeLeft(until);
    document.querySelectorAll('[data-bar-left]').forEach((el) => { el.textContent = `${h}h ${String(m).padStart(2, '0')}m`; });
    document.querySelectorAll('[data-promo-left]').forEach((el) => {
      el.innerHTML = `<b>${h}</b>h <b>${String(m).padStart(2, '0')}</b>m <b>${String(s).padStart(2, '0')}</b>s`;
    });
    // the 24 hours are over while the page is open: the offer is the normal 7 days again
    if (!until) {
      clearTimeout(clock);
      clock = 0;
      if (bar && bar.querySelector('[data-bar-left]')) { bar.remove(); bar = null; showBar(); }
      if (promoBox && promoBox.open && promoBox.dataset.kind === 'welcome') paintWelcome();
      return;
    }
    clearTimeout(clock);
    clock = setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  // When each box last came up by itself: { welcome: time, invite: time }
  const seen = () => parse(read(SEEN_KEY)) || {};
  const markSeen = (kind) => write(SEEN_KEY, JSON.stringify({ ...seen(), [kind]: Date.now() }));

  let promoBox = null;
  function openPromo(kind, html) {
    if (!promoBox) {
      promoBox = document.createElement('dialog');
      promoBox.className = 'plan-confirm promo';
      promoBox.setAttribute('aria-labelledby', 'promo-title');
      promoBox.innerHTML = '<div class="plan-confirm-in promo-in" tabindex="-1"></div>';
      document.body.append(promoBox);
      promoBox.addEventListener('click', async (event) => {
        if (event.target === promoBox || event.target.closest('[data-promo-close]')) { promoBox.close(); return; }
        if (event.target.closest('[data-promo-signup]')) { event.preventDefault(); toSignUp(); return; }
        const copy = event.target.closest('[data-promo-copy]');
        if (copy) copyLink(copy, promoBox.querySelector('[data-promo-link]'));
        const share = event.target.closest('[data-promo-share]');
        if (share) navigator.share({ title: 'RZGS-PRO', text: SHARE_TEXT, url: share.dataset.promoShare }).catch(() => {});
      });
    }
    promoBox.dataset.kind = kind;
    promoBox.firstElementChild.innerHTML = html;
    if (!promoBox.open) promoBox.showModal();
    promoBox.firstElementChild.focus({ preventScroll: true });
  }

  // Copy: the link is copied, or selected when the browser does not allow it
  async function copyLink(button, field) {
    try {
      await navigator.clipboard.writeText(field.value);
      button.textContent = 'Copied';
    } catch (e) {
      field.select();
      button.textContent = 'Select it';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  }

  // The welcome offer's gift (the owner, 18 Nov 2026: "don't mention the 3 steps, but a box or a gift to get them
  // interested to click Claim"): a blue gift box whose lid hops now and then with a glint of light, its FREE tag
  // swinging and small sparkles round it. Drawn here (plans.css: .promo-gift); a tap on it opens the sign-up too.
  const giftArt = () => `<div class="promo-gift" data-promo-signup aria-hidden="true"><svg viewBox="0 0 220 170">
      <defs>
        <radialGradient id="rzgift-glow" cx="50%" cy="58%" r="50%"><stop offset="0" stop-color="#8dbdff" stop-opacity=".6"/><stop offset=".55" stop-color="#8dbdff" stop-opacity=".18"/><stop offset="1" stop-color="#8dbdff" stop-opacity="0"/></radialGradient>
        <linearGradient id="rzgift-box" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f86f0"/><stop offset="1" stop-color="#0a57c4"/></linearGradient>
        <linearGradient id="rzgift-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ea2ff"/><stop offset="1" stop-color="#2a78e6"/></linearGradient>
        <linearGradient id="rzgift-rib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3eeff"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#d5e5ff"/></linearGradient>
      </defs>
      <ellipse class="rzgift-glow" cx="110" cy="96" rx="104" ry="74" fill="url(#rzgift-glow)"/>
      <ellipse cx="110" cy="158" rx="64" ry="7" fill="#0b3c8c" opacity=".16"/>
      <g class="rzgift-body">
        <rect x="56" y="84" width="108" height="72" rx="12" fill="url(#rzgift-box)"/>
        <rect x="56" y="84" width="108" height="9" fill="#0a4fb3" opacity=".35"/>
        <rect x="100" y="84" width="20" height="72" fill="url(#rzgift-rib)"/>
        <path d="M68 100v40" stroke="#fff" stroke-opacity=".22" stroke-width="5" stroke-linecap="round"/>
      </g>
      <ellipse class="rzgift-light" cx="110" cy="86" rx="48" ry="9" fill="#d9e9ff"/>
      <g class="rzgift-lid">
        <rect x="48" y="62" width="124" height="28" rx="10" fill="url(#rzgift-lid)"/>
        <rect x="99" y="62" width="22" height="28" fill="url(#rzgift-rib)"/>
        <path d="M60 71h34" stroke="#fff" stroke-opacity=".4" stroke-width="4" stroke-linecap="round"/>
        <path d="M110 62C100 44 76 38 74 52c-2 10 18 12 36 10z" fill="#cfe2ff" stroke="#7fb2ff" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M110 62c10-18 34-24 36-10 2 10-18 12-36 10z" fill="#b9d6ff" stroke="#7fb2ff" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="110" cy="61" r="8" fill="#fff" stroke="#7fb2ff" stroke-width="1.6"/>
        <g class="rzgift-tag">
          <path d="M114 63c18 6 32 20 40 36" fill="none" stroke="#9cc4ff" stroke-width="1.6"/>
          <g transform="rotate(14 172 112)"><rect x="146" y="100" width="52" height="24" rx="7" fill="#fff" stroke="#cfe2fb"/><circle cx="153" cy="112" r="2.6" fill="#cfe2fb"/><text x="176" y="117" text-anchor="middle" fill="#0b74de" font-family="Poppins, sans-serif" font-weight="700" font-size="13">FREE</text></g>
        </g>
      </g>
      <g transform="translate(34 50)"><path class="rzgift-spark" d="M0-9C1-3 3-1 9 0C3 1 1 3 0 9C-1 3-3 1-9 0C-3-1-1-3 0-9Z" fill="#3d8ef5"/></g>
      <g transform="translate(186 40)"><path class="rzgift-spark" d="M0-7C1-2 2-1 7 0C2 1 1 2 0 7C-1 2-2 1-7 0C-2-1-1-2 0-7Z" fill="#8dbdff"/></g>
      <g transform="translate(26 116)"><path class="rzgift-spark" d="M0-6C1-2 2-1 6 0C2 1 1 2 0 6C-1 2-2 1-6 0C-2-1-1-2 0-6Z" fill="#8dbdff"/></g>
      <g transform="translate(200 82)"><path class="rzgift-spark" d="M0-5C.6-1.6 1.6-.6 5 0C1.6.6.6 1.6 0 5C-.6 1.6-1.6.6-5 0C-1.6-.6-.6-1.6 0-5Z" fill="#3d8ef5"/></g>
    </svg></div>`;

  function paintWelcome() {
    const until = welcomeUntil();
    const days = until ? 10 : 7;
    openPromo('welcome', `<button class="plans-x plans-x--in" type="button" data-promo-close aria-label="Close this offer">${ICONS.x}</button>
      <div class="promo-top">${until
        ? `<span class="promo-timer" role="timer" aria-label="This offer ends within 24 hours">${ICONS.timer}<span class="promo-timer-word">Offer ends in</span><span class="promo-left" data-promo-left aria-hidden="true"></span></span>`
        : `<span class="promo-chip">${ICONS.gift}Free trial</span>`}</div>
      ${invitedBy() ? '<p class="promo-friend">A friend invited you to RZGS-PRO.</p>' : ''}
      <h2 id="promo-title">Try the gold bot<br><span class="text-gradient">${days} days free</span></h2>
      <p class="plan-confirm-lead">${until ? 'Sign up before the timer ends and your free trial is 10 days instead of 7.' : 'Try the bot on your own MT5 account before you pay anything.'}</p>
      ${giftArt()}
      <span class="plan-btn-glow"><a class="plan-btn" href="${pageUrl('signup')}" data-promo-signup><span data-plan-label>${ICONS.gift}Claim my free ${days}-day trial</span></a></span>
      <button class="promo-later" type="button" data-promo-close>Maybe later</button>
      <p class="promo-small">No payment · partner broker account · one trial per person</p>`);
    if (until) tick();
  }

  /* the Affiliate program of the person logged in */
  let promo = null; // web_my_invites: code, invited, counted, earned, used, left, trial_days, friends
  const SHARE_TEXT = 'Try the RZGS-PRO gold bot free with my link:';
  const inviteLink = (code) => new URL(`./?ref=${encodeURIComponent(code)}`, SITE).href;
  const telegramShare = (link) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;

  // Asked with the sign-in saved by supabase-js while it is still good, like the profile: no library needed here.
  async function loadInvites(fresh = false) {
    if (!signedIn()) return null;
    if (promo && !fresh) return promo;
    const session = parse(read(AUTH_KEY)) || {};
    if (!session.access_token || (session.expires_at || 0) * 1000 < Date.now()) return promo;
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/web_my_invites`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = response.ok ? await response.json() : null;
      promo = data && data.ok ? data : null;
    } catch (e) { /* no promotions shown */ }
    return promo;
  }

  function paintInvite(p) {
    const link = inviteLink(p.code);
    const step = p.counted % 5;
    const ready = p.left > 0;
    const lit = ready && step === 0 ? 5 : step;
    const months = `${p.left} free month${p.left === 1 ? '' : 's'}`;
    openPromo('invite', `<button class="plans-x plans-x--in" type="button" data-promo-close aria-label="Close">${ICONS.x}</button>
      <div class="promo-top"><span class="promo-chip">${ICONS.share}Affiliate program</span></div>
      <h2 id="promo-title">Invite 5 friends,<br><span class="text-gradient">get 1 month free</span></h2>
      <p class="plan-confirm-lead">When 5 friends you invite complete 6 achievements, up to their bot's first closed trade, you get 30 days of Elite at $0. Every 5 more friends give you one more month.</p>
      <div class="promo-meter" aria-hidden="true">${Array.from({ length: 5 }, (x, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('')}</div>
      <p class="promo-count">${ready ? `You have <b>${months}</b> of Elite ready.` : `<b>${step} of 5</b> friends done`}</p>
      <div class="promo-link">
        <input type="text" value="${link}" readonly aria-label="Your invite link" data-promo-link>
        <button class="promo-copy" type="button" data-promo-copy>Copy</button>
      </div>
      <span class="plan-btn-glow"><a class="plan-btn" href="${telegramShare(link)}" target="_blank" rel="noopener"><span data-plan-label>${ICONS.send}Share on Telegram</span></a></span>
      ${navigator.share ? `<button class="btn btn-ghost btn-block promo-more" type="button" data-promo-share="${link}">${ICONS.share}More ways to share</button>` : ''}
      ${ready ? `<a class="btn btn-ghost btn-block promo-more" href="${pageUrl('./#plans')}" data-plans data-promo-close>Use my free month</a>` : ''}
      <a class="promo-later" href="${pageUrl('manage-account#affiliate')}">See my friends</a>
      <button class="promo-later" type="button" data-promo-close>Maybe later</button>`);
  }

  // By itself: the welcome box at most every 6 hours while the offer runs, every 3 days after it; the invite box once
  // a day. Only when no other box is open and the page is in front.
  function whenFree(run) {
    const go = () => {
      if (document.visibilityState !== 'visible') { document.addEventListener('visibilitychange', go, { once: true }); return; }
      if (document.querySelector('dialog[open]') || (promoBox && promoBox.open)) return;
      run();
    };
    setTimeout(go, 2800);
  }
  async function offerPromotion(profile, justLoggedIn) {
    const page = document.body.dataset.authPage;
    const last = seen();
    if (!signedIn()) {
      if (page || read(KNOWN_KEY)) return;
      const wait = welcomeUntil() ? 6 * HOUR : 3 * DAY;
      if (Date.now() - (last.welcome || 0) < wait) return;
      whenFree(() => { markSeen('welcome'); paintWelcome(); });
      return;
    }
    // logged in: not on the account's own pages but the dashboard, and not right after logging in (the plans come first)
    if ((page && page !== 'dashboard') || justLoggedIn || !profile) return;
    if (Date.now() - (last.invite || 0) < DAY) return;
    const p = await loadInvites();
    if (!p || !p.code) return;
    whenFree(() => { markSeen('invite'); paintInvite(p); });
  }

  // the log in and sign-up pages say 10 days while the visitor's offer runs
  function paintTrialDays() {
    if (!welcomeUntil()) return;
    document.querySelectorAll('[data-trial-days]').forEach((el) => { el.textContent = '10'; });
  }

  /* ---------------------------------------------------------------- the visit counter (the owner, 2026-11-06) */
  // For the statement's Website Traffic (1 Website/web_admin.sql, web_track): a random number kept in this browser,
  // the page, and what was clicked: a plan button (interested), a partner broker link (referral), a Telegram link
  // (other). No name, email or IP address. Nothing is counted when the browser asks not to be tracked, or on a PC
  // preview of the site.
  const VISITOR_KEY = 'rzgs_visitor';
  const counting = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && navigator.doNotTrack !== '1' && window.doNotTrack !== '1';
  function visitorId() {
    let id = read(VISITOR_KEY);
    if (!id || !/^[A-Za-z0-9-]{8,40}$/.test(id)) {
      id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      write(VISITOR_KEY, id);
    }
    return id;
  }
  function track(kind, target = null) {
    if (!counting) return;
    try {
      fetch(`${SUPABASE_URL}/rest/v1/rpc/web_track`, {
        method: 'POST',
        keepalive: true, // a click that opens another page is still counted
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_kind: kind, p_visitor: visitorId(), p_page: location.pathname.replace(/\.html$/, '') || '/', p_target: target }),
      }).catch(() => {});
    } catch (e) { /* not counted */ }
  }
  document.addEventListener('click', (event) => {
    const el = event.target.closest('a, button');
    if (!el) return;
    let host = '';
    try { host = el.tagName === 'A' && el.href ? new URL(el.href, location.href).hostname : ''; } catch (e) { /* not a link */ }
    if (/exness|investizo|lirunex/i.test(host)) track('referral', host);
    else if (/(^|\.)t\.me$/i.test(host)) track('other', 'telegram');
    else if (el.matches('[data-plans], [data-checkout], [data-plan-go], [data-promo-signup]')) {
      track('interested', String(el.dataset.planGo || el.dataset.checkout || el.textContent).replace(/\s+/g, ' ').trim().slice(0, 60));
    }
  }, true);
  track('visit');

  /* ---------------------------------------------------------------- wiring */
  document.addEventListener('click', (event) => {
    // the dashboard has its own question to ask (auth.js)
    if (event.target.closest('[data-sign-out]') && !document.querySelector('[data-sign-out-dialog]')) openLogout();
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-plans]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (signedIn()) openPlans();
    else toSignUp();
  });

  // A button that names its plan goes straight to the checkout box.
  document.addEventListener('click', async (event) => {
    const go = event.target.closest('[data-checkout]');
    if (!go || go.disabled || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (!signedIn()) { toSignUp(); return; }
    // VIP: a month unless the button says a year (data-months="12"); the checkout box lets them change it
    (await loadCheckout()).open(go.dataset.checkout, { months: Number(go.dataset.months) === 12 ? 12 : 1 });
  });

  keepInvite();
  startWelcome();
  buildNavMe();
  const profileLoaded = loadProfile();
  showBar();

  // The plans come up by themselves only for someone with no plan running: no plan yet, or the plan or the free days
  // have ended (the owner, 2026-10-31). Anyone can open them at any time with a plans button.
  const needsPlan = (profile) => {
    const plan = planById(profile.plan);
    return !plan || (Boolean(profile.plan_expires_at) && new Date(profile.plan_expires_at) < new Date());
  };
  const whenPageIsReady = (run) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  };
  // Just logged in: auth.js left a note for this page.
  let justIn = null;
  try {
    justIn = sessionStorage.getItem(JUST_IN_KEY);
    sessionStorage.removeItem(JUST_IN_KEY);
  } catch (e) { /* private window */ }
  if (justIn) {
    profileLoaded.then((profile) => {
      if (profile && needsPlan(profile)) whenPageIsReady(() => openPlans());
    });
  }
  whenPageIsReady(paintTrialDays);
  profileLoaded.then((profile) => whenPageIsReady(() => offerPromotion(profile, Boolean(justIn))));
  window.rzgsPlans = {
    db: getDb,
    checkout: loadCheckout,
    // the promotions of the person logged in, once asked for (the checkout box shows the right number of free days)
    get promo() { return promo; },
    // the dashboard, right after the email was confirmed
    offer(profile) {
      if (needsPlan(profile)) openPlans();
    },
    // the dashboard: the plans for its Subscription tab, the account card in its menu, and Cancel plan
    plans: PLANS,
    mountCard,
    cancel() {
      current = describeCurrent(storedProfile());
      goCancel();
    },
    // the VIP price of the moment ({ month, year_off, year, year_save }); 'rzgs:prices' tells when it is known
    prices: loadPrices,
    money,
    // the Edit profile box saved something: the header follows at once
    repaint(fields) {
      const profile = { ...storedProfile(), ...fields };
      write(PROFILE_KEY, JSON.stringify(profile));
      paintProfile(profile);
    },
  };

  // Sent here to see the plans: they asked, by a link from another page or from before the plans became a pop-up.
  // #vip: the control app's "Go VIP" (someone who has a bot, so logging in comes first, then the plans, VIP in view).
  if (/^#(plans|pricing|vip)$/.test(location.hash)) {
    const vip = location.hash === '#vip';
    history.replaceState(null, '', location.pathname + location.search);
    if (signedIn()) whenPageIsReady(() => openPlans(vip ? 'vip' : null));
    else if (vip) toSignUp(`${SITE.pathname}#vip`, 'login');
    else {
      const partners = document.getElementById('partners');
      if (partners) partners.scrollIntoView();
    }
  }
  // a page that shows the VIP price in its words, and the account pages (their plan cards): the price of the moment
  whenPageIsReady(() => {
    if (document.querySelector('[data-vip-price]') || ['dashboard', 'manage'].includes(document.body.dataset.authPage)) loadPrices();
  });
})();
