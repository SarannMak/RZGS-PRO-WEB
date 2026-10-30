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
  const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const AUTH_KEY = 'sb-zaziizzsbytkdlatoutv-auth-token'; // where supabase-js keeps the sign-in
  const BOT_URL = 'https://t.me/rzgsprobot';

  const AFTER_KEY = 'rzgs_after_login'; // the page to come back to after signing in
  const BAR_KEY = 'rzgs_trial_bar_closed';
  const PROFILE_KEY = 'rzgs_profile'; // name, picture and plan, so the header is right at once
  const BUSY_MS = 900; // how long "Processing..." stays at least

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
    calc: icon('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>'),
  };
  const SPINNER = '<span class="plan-spin" aria-hidden="true"></span>';

  /* ---------------------------------------------------------------- the plans */
  // Only what the License Rules and the sales bot really give. `id` is the plan's name on the
  // website (web_users.plan), `bot` is its name in the Telegram bot's start link.
  const NEEDS_PARTNER = 'An MT5 hedging account opened with a partner broker: Exness, Investizo or Lirunex';
  const NEEDS_PC = 'A computer or VPS that keeps MT5 open';
  const PLANS = [
    {
      id: 'trial', bot: 'free', name: 'Free', tone: 'free', icon: 'zap', chip: '7 days',
      lead: 'Get familiar with the strategy.',
      box: ['7 days on 1 MT5 account', 'Starts when your trial is approved', 'One free trial per person'],
      amount: '$0', per: '/ 7 days', button: 'Claim Free Trial', under: 'No payment needed',
      get: ['The same RZGS-PRO gold bot as Elite', 'Bot file and Bot Password from our Telegram bot', 'Phone control app', 'Setup help on Telegram'],
      needs: [NEEDS_PARTNER, NEEDS_PC],
      not: ['Any broker of your choice', 'Basic VPS'],
    },
    {
      id: 'elite', bot: 'elite', name: 'Elite', tone: 'elite', icon: 'hexagon', chip: 'Most popular',
      lead: 'For traders with a partner broker account.',
      box: ['30 days on 1 MT5 account', 'Starts when your bot is delivered', 'Renew early: new days are added on top'],
      amount: '$5', per: '/ month', button: 'Upgrade Plan', under: 'You pay in Telegram by KHQR',
      get: ['The RZGS-PRO gold bot for 30 days', 'Bot file and Bot Password from our Telegram bot', 'Phone control app', 'Setup help on Telegram'],
      needs: [NEEDS_PARTNER, NEEDS_PC],
      not: ['Any broker of your choice', 'Basic VPS'],
    },
    {
      id: 'diamond', bot: 'diamond', name: 'Diamond', tone: 'diamond', icon: 'gem', chip: 'Any broker',
      lead: 'Keep your own broker. Hosting included.',
      box: ['Monthly on 1 MT5 account', 'Works at any broker', '1 basic VPS included while paid'],
      amount: '$49', per: '/ month', button: 'Contact Sales', under: 'We continue with you in Telegram',
      get: ['Everything in Elite', 'No partner broker needed: keep your own', '1 basic VPS, so the bot can run 24/7', 'The bot file made for every broker'],
      needs: ['An MT5 hedging account at any broker, one that can trade gold'],
      note: ['When the plan ends the VPS is removed, so keep a copy of anything you need from it.'],
    },
  ];
  const planById = (id) => PLANS.find((plan) => plan.id === id);

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
    return `<article class="pc pc--${plan.tone}" data-plan="${plan.id}"><div class="pc-in">
      <div class="pc-top">
        <span class="pc-icon">${ICONS[plan.icon]}</span>
        <h3>${plan.name}</h3>
        <span class="pc-chip" data-plan-chip>${plan.chip}</span>
      </div>
      <p class="pc-lead">${plan.lead}</p>
      <div class="pc-box"><strong>${plan.box[0]}</strong>${plan.box.slice(1).map((line) => `<span>${line}</span>`).join('')}</div>
      <p class="pc-price"><b>${plan.amount}</b><span>${plan.per}</span></p>
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

  // The bot learns which website account this is from a one-time code, and acts on the plan at once (free, elite,
  // diamond, or none). Without a code it still opens at the plan.
  async function telegramLink(botPlan) {
    let code = '';
    try {
      const db = await getDb();
      const { data } = await db.rpc('web_link_code');
      if (data && data.ok) code = data.code;
    } catch (e) { /* no code: the plain link */ }
    const payload = [code && `l_${code}`, botPlan].filter(Boolean).join('_');
    return payload ? `${BOT_URL}?start=${payload}` : BOT_URL;
  }

  // Back to this page after signing up or logging in, where the plans then open.
  function toSignUp() {
    const here = location.pathname;
    write(AFTER_KEY, JSON.stringify({ to: /(login|signup|reset-password)(\.html)?$/.test(here) ? SITE.pathname : here, at: Date.now() }));
    location.href = pageUrl('signup');
  }

  /* ---------------------------------------------------------------- the profile in the header */
  const storedProfile = () => parse(read(PROFILE_KEY)) || {};

  function paintProfile(profile) {
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

  // Name, picture and plan. Asked for with the sign-in supabase-js saved, as long as it is still good: these pages
  // don't load the library for this. Only a picture from the person's own folder is ever shown (as on the dashboard).
  async function loadProfile() {
    if (!signedIn()) { forget(PROFILE_KEY); return; }
    const session = parse(read(AUTH_KEY)) || {};
    const user = session.user || {};
    let profile = { ...(user.user_metadata || {}), email: user.email, ...storedProfile() };
    paintProfile(profile);
    if (!user.id || !session.access_token || (session.expires_at || 0) * 1000 < Date.now()) return;
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/web_users?select=full_name,username,avatar_url,plan,plan_expires_at&id=eq.${encodeURIComponent(user.id)}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) return;
      const [row] = await response.json();
      if (!row) return;
      const folder = `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/`;
      profile = { ...profile, ...row, avatar_url: String(row.avatar_url || '').startsWith(folder) ? row.avatar_url : '' };
      write(PROFILE_KEY, JSON.stringify(profile));
      paintProfile(profile);
      hideBarForClients(profile);
    } catch (e) { /* the name from the sign-in stays */ }
  }

  /* ---------------------------------------------------------------- the bar at the top */
  let bar = null;

  function closeBar() {
    write(BAR_KEY, '1');
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
    if (!header || document.body.dataset.authPage || read(BAR_KEY) || storedProfile().plan) return;
    bar = document.createElement('div');
    bar.className = 'trial-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Free trial offer');
    bar.innerHTML = `<div class="trial-bar-in">
      <span class="trial-bar-chip">${ICONS.gift}Free trial</span>
      <p class="trial-bar-text"><strong>Start your free 7-day trial.</strong><span class="trial-bar-more"> Try the gold bot on your own MT5 account, with no payment.</span></p>
      <a class="trial-bar-go" href="${pageUrl('signup')}" data-plans>Claim now</a>
      <button class="trial-bar-x" type="button" aria-label="Close this offer">${ICONS.x}</button>
    </div>`;
    bar.querySelector('.trial-bar-x').addEventListener('click', closeBar);
    header.before(bar);
  }

  /* ---------------------------------------------------------------- the plans pop-up */
  let dialog = null;
  let confirmBox = null;
  let current = { plan: null, name: 'No plan yet', detail: '', price: '$0' };

  const dateText = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
    PLANS.forEach((plan) => {
      const card = dialog.querySelector(`[data-plan="${plan.id}"]`);
      const mine = current.plan === plan.id;
      card.classList.toggle('is-mine', mine);
      card.querySelector('[data-plan-chip]').textContent = mine ? 'Your plan' : plan.chip;
      const button = card.querySelector('[data-plan-go]');
      if (button.classList.contains('is-busy')) return;
      const label = button.querySelector('[data-plan-label]');
      if (plan.id === 'trial' && mine) {
        // one free trial per person
        label.textContent = current.ended ? 'Trial used' : 'Trial running';
        button.disabled = true;
      } else {
        label.textContent = plan.id === 'elite' && mine ? 'Renew Plan' : plan.button;
        button.disabled = false;
      }
    });
  }

  async function freshCurrent() {
    try {
      const db = await getDb();
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      const { data } = await db.from('web_users').select('plan, plan_expires_at').eq('id', session.user.id).maybeSingle();
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
          <p>Start free for 7 days, then pick the plan that fits how you trade.</p>
          <p class="plans-now" data-plans-now hidden></p>
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
      if (button) choose(planById(button.dataset.planGo), button);
      // the X, or the empty space around the plans
      else if (event.target.closest('[data-plans-close]') || event.target === dialog || event.target.classList.contains('plans-wrap')) dialog.close();
    });
    dialog.addEventListener('close', () => lockPage(false));
  }

  function openPlans() {
    if (!dialog) buildDialog();
    if (dialog.open) return;
    current = describeCurrent(storedProfile());
    renderCurrent();
    lockPage(true);
    dialog.showModal();
    dialog.scrollTop = 0;
    freshCurrent();
  }

  // Free and Diamond go to the Telegram bot at their plan. Elite is confirmed first.
  async function choose(plan, button) {
    if (button.disabled) return;
    setBusy(button, true);
    const session = await activeSession();
    if (session === null) { toSignUp(); return; }
    if (plan.id === 'elite') {
      await Promise.all([freshCurrent(), wait(BUSY_MS)]);
      setBusy(button, false);
      renderCurrent();
      openConfirm(plan);
      return;
    }
    const [link] = await Promise.all([telegramLink(plan.bot), wait(BUSY_MS)]);
    location.href = link;
  }

  function buildConfirm() {
    confirmBox = document.createElement('dialog');
    confirmBox.className = 'plan-confirm';
    confirmBox.setAttribute('aria-labelledby', 'plan-confirm-title');
    document.body.append(confirmBox);
    confirmBox.addEventListener('click', async (event) => {
      if (event.target === confirmBox || event.target.closest('[data-confirm-close]')) { confirmBox.close(); return; }
      const yes = event.target.closest('[data-confirm-yes]');
      if (!yes) return;
      setBusy(yes, true);
      const session = await activeSession();
      if (session === null) { toSignUp(); return; }
      const [link] = await Promise.all([telegramLink(planById('elite').bot), wait(BUSY_MS)]);
      location.href = link;
    });
  }

  function openConfirm(plan) {
    if (!confirmBox) buildConfirm();
    const running = current.plan && !current.ended;
    const kind = !running || current.plan === 'trial' ? 'upgrade' : current.plan === plan.id ? 'renew' : 'change';
    const words = {
      upgrade: ['Upgrading plan', 'Your new plan starts when your bot is delivered in Telegram.', 'Confirm Upgrade'],
      renew: ['Renewing plan', 'The new 30 days are added to the time you have left.', 'Confirm Renewal'],
      change: ['Changing plan', 'Your new plan starts when your bot is delivered in Telegram.', 'Confirm Change'],
    }[kind];
    confirmBox.innerHTML = `<div class="plan-confirm-in" tabindex="-1" autofocus>
      <button class="plans-x plans-x--in" type="button" data-confirm-close aria-label="Close">${ICONS.x}</button>
      <h2 id="plan-confirm-title">${words[0]}</h2>
      <p class="plan-confirm-lead">${words[1]}</p>
      <div class="plan-confirm-group">
        <h3>Current plan</h3>
        <div class="plan-confirm-row"><span><b>${current.name}</b>${current.detail ? ` · ${current.detail}` : ''}</span><b>${current.price}</b></div>
      </div>
      <div class="plan-confirm-group plan-confirm-group--new">
        <h3>New plan</h3>
        <div class="plan-confirm-row"><span><b>${plan.name}</b> · 30 days</span><b>${plan.amount}</b></div>
        <small>1 MT5 account · partner broker · phone control app</small>
      </div>
      <div class="plan-confirm-row plan-confirm-due"><span>Amount due</span><b>${plan.amount}</b></div>
      <p class="plan-confirm-note">By confirming you agree to our <a href="${pageUrl('license')}">License Rules</a> and <a href="${pageUrl('terms')}">Terms &amp; Conditions</a>. Next, our Telegram bot checks your broker account and MT5 number, then you pay by KHQR. Your plan does not renew by itself.</p>
      <span class="plan-btn-glow plan-confirm-go"><button class="plan-btn" type="button" data-confirm-yes><span data-plan-label>${words[2]}</span></button></span>
    </div>`;
    confirmBox.showModal();
  }

  /* ---------------------------------------------------------------- wiring */
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-plans]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (signedIn()) openPlans();
    else toSignUp();
  });

  // Any other link to the bot on any page: for a signed-in client the click carries their account as well, so the bot
  // knows who came and for which plan. Someone with no account just follows the link, which already names the plan.
  document.addEventListener('click', async (event) => {
    const link = event.target.closest('a[href*="t.me/rzgsprobot"]');
    if (!link || !signedIn() || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const start = new URL(link.href).searchParams.get('start') || '';
    if (start.startsWith('l_')) return; // the dashboard's own buttons carry it already
    event.preventDefault();
    link.setAttribute('aria-busy', 'true');
    location.href = await telegramLink(/^(free|elite|diamond)$/.test(start) ? start : '');
  });

  // Back from Telegram: this page may come back as it was left, so nothing stays on "Processing..."
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.querySelectorAll('.plan-btn.is-busy').forEach((button) => setBusy(button, false));
    renderCurrent();
  });

  loadProfile();
  showBar();

  // Sent here to see the plans: after signing in, or by a link from before the plans became a pop-up.
  if (/^#(plans|pricing)$/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
    if (signedIn()) openPlans();
    else {
      const partners = document.getElementById('partners');
      if (partners) partners.scrollIntoView();
    }
  }
})();
