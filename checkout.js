/* ==========================================================================
   RZGS-PRO: buying and cancelling a plan on this website. plans.js loads this
   file the first time it is needed (window.rzgsPlans.checkout()).

   One box walks the client through the steps of their plan:
     Free     broker account, MT5 number, bot
     Elite    broker account, MT5 number, KHQR payment, bot
     Diamond  MT5 number, KHQR payment, bot
   Every check and every decision is made by the server function "checkout"
   (1 Website/checkout-function/index.ts). This file only asks and shows.
   ========================================================================== */
(() => {
  'use strict';

  const API = 'https://zaziizzsbytkdlatoutv.supabase.co/functions/v1/checkout';
  const KEY = 'sb_publishable_ojfdWkyt22zlG0Uz_CUd4w_IufedKpK';
  const BOT_SERVER = 'https://zaziizzsbytkdlatoutv.supabase.co'; // the address MT5 has to allow, as in the install steps

  const SITE = new URL('./', document.currentScript.src);
  const pageUrl = (name) => new URL(name, SITE).href;

  const PLANS = {
    trial: { name: 'Free', amount: '$0', days: 7, steps: ['broker', 'mt5', 'bot'] },
    elite: { name: 'Elite', amount: '$5', days: 30, steps: ['broker', 'mt5', 'pay', 'bot'] },
    diamond: { name: 'Diamond', amount: '$49', days: 30, steps: ['mt5', 'pay', 'bot'] },
  };
  const STEP_WORDS = { broker: 'Broker', mt5: 'MT5', pay: 'Pay', bot: 'Your bot' };
  // in the order and with the links the partner brokers have everywhere else
  const BROKERS = [
    { id: 'lirunex', name: 'Lirunex', link: 'https://client.lirunextrd.com/auth/signup?partnerId=372166&affiliateId=76983' },
    { id: 'exness', name: 'Exness', link: 'https://one.exnessonelink.com/a/wohgwojskx' },
    { id: 'investizo', name: 'Investizo', link: 'https://investizo.net/?pid=962201&cid=19606' },
  ];
  const brokerById = (id) => BROKERS.find((broker) => broker.id === id);

  const SPINNER = '<span class="plan-spin" aria-hidden="true"></span>';
  const X = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  let box = null;
  let inner = null;
  let order = null;
  let last = null;       // the broker, email and MT5 number of their last bot: typed in for them
  let accountEmail = '';
  let countdown = null;
  let lookAgain = null;
  let autoLooks = 0;
  let shownQr = null;
  let qrWatch = null;

  /* ---------------------------------------------------------------- the server */
  async function session() {
    const db = await window.rzgsPlans.db();
    const { data } = await db.auth.getSession();
    return data.session;
  }

  async function send(body) {
    const signedIn = await session();
    if (!signedIn) { location.href = pageUrl('login'); return new Promise(() => {}); }
    accountEmail = signedIn.user.email || accountEmail;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${signedIn.access_token}` },
      body: JSON.stringify(body),
    });
  }

  async function call(action, fields = {}) {
    try {
      const response = await send({ action, ...fields });
      const result = await response.json();
      if (result.code === 'signed_out') location.href = pageUrl('login');
      return result;
    } catch (e) {
      return { ok: false, code: 'net' };
    }
  }

  // Tells the page that something changed: the dashboard looks again, and the header shows the new plan.
  function announce(result) {
    if (result && result.plan && window.rzgsPlans.repaint) window.rzgsPlans.repaint(result.plan);
    document.dispatchEvent(new CustomEvent('rzgs:checkout'));
  }

  /* ---------------------------------------------------------------- the box */
  function build() {
    if (box) return;
    box = document.createElement('dialog');
    box.className = 'plan-confirm co';
    box.setAttribute('aria-labelledby', 'co-title');
    box.innerHTML = '<div class="plan-confirm-in co-in" tabindex="-1"></div>';
    inner = box.firstElementChild;
    document.body.append(box);
    box.addEventListener('click', onClick);
    box.addEventListener('submit', onSubmit);
    box.addEventListener('change', onChange);
    box.addEventListener('close', () => { stopTimers(); announce(); });
  }

  function openBox() {
    build();
    stopTimers();
    if (box.open) return;
    if (window.rzgsMotion) window.rzgsMotion.fromTap(box);
    box.showModal();
  }

  function stopTimers() {
    clearInterval(countdown);
    clearTimeout(lookAgain);
    if (qrWatch) qrWatch.disconnect();
    countdown = null;
    lookAgain = null;
    qrWatch = null;
  }

  function paint(html) {
    stopTimers();
    box.classList.remove('co--pay');
    inner.innerHTML = `<button class="plans-x plans-x--in" type="button" data-co-close aria-label="Close">${X}</button>${html}`;
    inner.scrollTop = 0;
    const first = inner.querySelector('input:not([type="radio"]), [data-co-first]');
    if (first) first.focus({ preventScroll: true });
    else inner.focus({ preventScroll: true });
  }

  const paintLoading = () => paint(`<div class="co-loading" role="status">${SPINNER}<span>One moment...</span></div>`);

  function rail(plan, at) {
    const steps = PLANS[plan].steps;
    const now = steps.indexOf(at);
    return `<ol class="co-rail" aria-label="Steps">${steps.map((step, index) => {
      const state = index < now ? 'done' : index === now ? 'now' : 'todo';
      return `<li data-state="${state}"${state === 'now' ? ' aria-current="step"' : ''}><i aria-hidden="true">${state === 'done' ? '&#10003;' : index + 1}</i>${STEP_WORDS[step]}</li>`;
    }).join('')}</ol>`;
  }

  const planLine = (plan) => `<p class="co-plan"><b>${PLANS[plan].name}</b> ${PLANS[plan].amount} · ${PLANS[plan].days} days · 1 MT5 account</p>`;
  const message = (note) => `<p class="co-msg" data-co-msg role="alert"${note ? ' data-tone="error"' : ' hidden'}>${esc(note || '')}</p>`;
  const mainButton = (label, attributes = '') => `<span class="plan-btn-glow"><button class="plan-btn" ${attributes}><span data-plan-label>${label}</span></button></span>`;
  const agree = `<p class="plan-confirm-note">By continuing you agree to our <a href="${pageUrl('license')}">License Rules</a> and <a href="${pageUrl('terms')}">Terms &amp; Conditions</a>. Your plan does not renew by itself.</p>`;

  function say(text, html) {
    const line = inner.querySelector('[data-co-msg]');
    if (!line) return;
    line.dataset.tone = 'error';
    line.hidden = false;
    if (html) line.innerHTML = text;
    else line.textContent = text;
    if (window.rzgsMotion) window.rzgsMotion.shake(line);
  }

  function setBusy(button, busy, words = 'Checking...') {
    const label = button.querySelector('[data-plan-label]');
    if (busy) {
      button.dataset.was = label.innerHTML;
      button.style.minWidth = `${button.offsetWidth}px`;
      label.innerHTML = `${SPINNER}${words}`;
      button.disabled = true;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
    } else {
      label.innerHTML = button.dataset.was;
      button.disabled = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.style.minWidth = '';
    }
  }

  /* ---------------------------------------------------------------- the steps */
  function paintBroker() {
    const chosen = order.broker || (last && last.broker) || '';
    const email = order.broker_email || (last && last.broker_email) || accountEmail;
    paint(`${rail(order.plan, 'broker')}${planLine(order.plan)}
      <h2 id="co-title">Your broker account</h2>
      <p class="plan-confirm-lead">Your MT5 account has to be opened with our link at one of these brokers.</p>
      <form data-co-form="broker" novalidate>
        <fieldset class="co-brokers">
          <legend>Your broker</legend>
          ${BROKERS.map((broker) => `<label class="co-broker"><input type="radio" name="broker" value="${broker.id}"${broker.id === chosen ? ' checked' : ''}><span>${broker.name}</span></label>`).join('')}
        </fieldset>
        <p class="co-open" data-co-open${chosen ? '' : ' hidden'}></p>
        <div class="co-field">
          <label for="co-email">The email you used at the broker</label>
          <input class="co-input" id="co-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(email)}" required>
        </div>
        ${message(order.note)}
        <button class="btn btn-ghost btn-block co-ask" type="button" data-co-ask hidden>Ask our team to check</button>
        ${mainButton('Check my account', 'type="submit"')}
        ${agree}
      </form>`);
    paintOpenLink();
  }

  function paintOpenLink() {
    const line = inner.querySelector('[data-co-open]');
    const picked = inner.querySelector('input[name="broker"]:checked');
    if (!line || !picked) return;
    const broker = brokerById(picked.value);
    line.hidden = false;
    line.innerHTML = `No account yet? <a href="${esc(broker.link)}" target="_blank" rel="noopener sponsored">Open one at ${broker.name} with our link</a>, then come back here.`;
  }

  function paintMt5() {
    const back = PLANS[order.plan].steps[0] !== 'mt5';
    const typed = order.mt5 || (last && last.mt5) || '';
    const paid = order.amount > 0;
    paint(`${rail(order.plan, 'mt5')}${planLine(order.plan)}
      <h2 id="co-title">Your MT5 number</h2>
      <p class="plan-confirm-lead">The login number of the account the bot will run on. It has to be a hedging account${order.plan === 'diamond' ? ' that can trade gold' : ''}.</p>
      <form data-co-form="mt5" novalidate>
        <div class="co-field">
          <label for="co-mt5">MT5 login number</label>
          <input class="co-input" id="co-mt5" name="account" type="text" inputmode="numeric" autocomplete="off" value="${esc(typed)}" required>
        </div>
        ${message(order.note)}
        <button class="btn btn-ghost btn-block co-ask" type="button" data-co-ask hidden>Ask our team to check</button>
        ${mainButton(paid ? 'Continue to payment' : 'Get my bot', 'type="submit"')}
        ${back ? '<button class="co-back" type="button" data-co-back>Back</button>' : agree}
      </form>`);
  }

  // The owner's Scan to Pay poster, with this order's own QR, name and amount where the bot's poster has them.
  function paintPay(qr) {
    const money = `$${Number(qr.amount).toFixed(2)}`;
    paint(`<div class="co-pay">
        <div class="co-pay-head">
          ${rail(order.plan, 'pay')}${planLine(order.plan)}
          <h2 id="co-title">Pay ${money} by KHQR</h2>
        </div>
        <div class="co-poster">
          <img src="${pageUrl(`assets/pay-${order.plan}.webp`)}" width="1254" height="1254" alt="Scan to pay ${money}" data-co-art>
          <div class="co-poster-card"><p>${esc(qr.name)}</p><b>$ ${Number(qr.amount).toFixed(2)}</b></div>
          <div class="co-poster-qr" data-co-qr><svg viewBox="0 0 ${qr.size} ${qr.size}" role="img" aria-label="KHQR code for ${money}" shape-rendering="crispEdges"><path d="${qr.path}"/></svg></div>
        </div>
        <div class="co-pay-side">
          <p class="co-left" data-co-left></p>
          <ol class="co-how">
            <li>Open your bank app and scan the code. Paying on this phone? Save the poster, then scan it from your photos.</li>
            <li>Pay the amount it shows, then tap the button below.</li>
          </ol>
          ${message(order.note)}
          ${mainButton('I have paid', 'type="button" data-co-paid data-co-first')}
          <button class="btn btn-ghost btn-sm co-save" type="button" data-co-save>Save the poster</button>
          <button class="co-back" type="button" data-co-back>Back</button>
        </div>
      </div>`);
    box.classList.add('co--pay');
    shownQr = qr;
    autoLooks = 0;
    const place = inner.querySelector('[data-co-qr]');
    // Whole device pixels for every square of the code, so a phone reads it easily off any screen.
    qrWatch = new ResizeObserver(() => {
      const device = window.devicePixelRatio || 1;
      const each = Math.max(1, Math.floor((place.clientWidth * device) / qr.size));
      place.firstElementChild.style.width = `${(qr.size * each) / device}px`;
    });
    qrWatch.observe(place);
    const left = inner.querySelector('[data-co-left]');
    const until = new Date(qr.until).getTime();
    const tick = () => {
      const seconds = Math.round((until - Date.now()) / 1000);
      if (seconds <= 0) {
        clearInterval(countdown);
        left.textContent = 'This code has run out.';
        const again = document.createElement('button');
        again.className = 'co-back';
        again.type = 'button';
        again.dataset.coNew = '';
        again.textContent = 'Get a new code';
        left.append(' ', again);
        return;
      }
      left.textContent = `Works for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  function paintReview() {
    const money = order.review_from === 'pay';
    paint(`${rail(order.plan, order.review_from === 'mt5' ? 'mt5' : order.review_from === 'pay' ? 'pay' : 'broker')}${planLine(order.plan)}
      <h2 id="co-title">Our team is checking</h2>
      <p class="plan-confirm-lead">${money
        ? 'We are confirming your payment by hand. There is nothing more to do: your bot appears on your dashboard as soon as it is confirmed.'
        : 'We are checking your broker account by hand. There is nothing more to do: your dashboard shows the next step as soon as it is done.'}</p>
      <div class="co-row">
        <a class="btn btn-primary" href="${pageUrl('dashboard')}" data-co-first>Go to my dashboard</a>
        <a class="btn btn-ghost" href="${pageUrl('contact')}">Contact us</a>
      </div>`);
  }

  function paintReady(licence) {
    paint(`${rail(licence.plan, 'bot')}
      <h2 id="co-title">Your bot is ready</h2>
      <p class="plan-confirm-lead">Keep these two passwords. They stay on your dashboard too.</p>
      ${licenceHtml(licence)}
      <div class="co-row">
        <a class="btn btn-ghost" href="${pageUrl('app')}">Open control app</a>
        <a class="btn btn-ghost" href="${pageUrl('dashboard')}">Go to my dashboard</a>
      </div>`);
  }

  function paintNotice(title, text, buttons = '') {
    paint(`<h2 id="co-title">${title}</h2><p class="plan-confirm-lead">${text}</p>${message('')}<div class="co-row">${buttons}<button class="btn btn-ghost" type="button" data-co-close data-co-first>Close</button></div>`);
  }

  // What the bot needs in MT5: on the last step here, and on the dashboard for as long as the plan runs.
  function licenceHtml(licence) {
    const key = (label, value) => `<div class="co-key"><span>${label}</span><code>${esc(value)}</code><button class="co-copy" type="button" data-co-copy="${esc(value)}">Copy</button></div>`;
    const broker = brokerById(licence.broker && String(licence.broker).toLowerCase());
    return `<div class="co-keys">${key('Bot Password', licence.bot_password)}${key('App Password', licence.app_password)}</div>
      <p class="co-small">Your Bot Password works only on account ${esc(licence.mt5)}${broker ? ` at ${broker.name}` : ''}, until ${dateText(licence.expires_at)}. Already running the bot? Put this file in place of the old one and type the new Bot Password.</p>
      ${mainButton('Download your bot file', 'type="button" data-co-file')}
      <details class="co-steps">
        <summary>Set it up in MetaTrader 5</summary>
        <ol>
          <li>File &rarr; Open Data Folder &rarr; MQL5 &rarr; Experts. Put the file there, then restart MT5.</li>
          <li>Tools &rarr; Options &rarr; Expert Advisors: tick &ldquo;Allow WebRequest for listed URL&rdquo; and add this address: <span class="co-url"><code>${BOT_SERVER}</code><button class="co-copy" type="button" data-co-copy="${BOT_SERVER}">Copy</button></span></li>
          <li>Open an XAUUSD chart on account ${esc(licence.mt5)} and drag the bot onto it.</li>
          <li>In the Inputs tab, type the two passwords above.</li>
          <li>Turn on Algo Trading.</li>
        </ol>
        <p class="co-small">Then open the control app on your phone and log in with your MT5 login number and your App Password.</p>
      </details>`;
  }

  /* ---------------------------------------------------------------- which step to show */
  function show(result) {
    if (result.order !== undefined) order = result.order;
    if (result.plan) announce(result);
    if (result.licence && (!order || order.stage === 'done')) { paintReady(result.licence); announce(); return; }
    if (!order) { box.close(); return; }
    if (order.stage === 'broker') paintBroker();
    else if (order.stage === 'mt5') paintMt5();
    else if (order.stage === 'pay' && result.qr) paintPay(result.qr);
    else if (order.stage === 'pay') { paintLoading(); call('pay').then(afterAction); }
    else if (order.stage === 'review') { paintReview(); announce(); }
  }

  const WORDS = {
    email_bad: 'Please type the email you used at the broker.',
    broker_bad: 'Please choose your broker.',
    mt5_bad: 'That is not an MT5 number. It has 5 to 12 digits and no letters.',
    mt5_taken: 'This MT5 account is already used on another RZGS-PRO account. If it is yours, please contact us.',
    too_many: 'That is a lot of tries for one day. Please try again tomorrow, or contact us.',
    net: "We couldn't reach our server. Check your connection and try again.",
    server: 'Something went wrong on our side. Please try again in a minute.',
  };

  function afterAction(result) {
    if (result.ok) { show(result); return; }
    if (result.order) order = result.order;
    const name = (brokerById(result.broker || (order && order.broker)) || {}).name || 'The broker';
    const ask = inner.querySelector('[data-co-ask]');
    if (result.code === 'not_ours') {
      const broker = brokerById(result.broker);
      say(`This email is not under our link at ${name}. <a href="${esc(broker.link)}" target="_blank" rel="noopener sponsored">Open your account with our link</a> using this email, then try again.`, true);
    } else if (result.code === 'mt5_not_ours') {
      say(`This number is not on that ${name} account. Check the number, and that the account was opened with the email you gave us.`);
    } else if (result.code === 'broker_down') {
      say(`${name} did not answer just now. Please try again.${result.can_ask ? ' Or ask our team to check it for you.' : ''}`);
      if (ask) ask.hidden = !result.can_ask;
    } else if (result.code === 'trial_used') {
      paintNotice('You have used your free days', 'The free trial is once per person. Elite and Diamond are open to you any time.',
        `<a class="btn btn-primary" href="${pageUrl('./#plans')}" data-plans>See plans</a>`);
    } else if (result.code === 'paid_running') {
      paintNotice('Your plan is still running', 'A new plan can start when this one ends. To change now, cancel your plan on your dashboard first.',
        `<a class="btn btn-primary" href="${pageUrl('dashboard#plan')}">Go to my dashboard</a>`);
    } else if (result.code === 'sold_in_person') {
      paintNotice('Diamond is sold by our team', 'Our sales team helps you with Diamond on Telegram.',
        '<a class="btn btn-primary" href="https://t.me/sarannsadboi" target="_blank" rel="noopener">Contact Sales</a>');
    } else if (result.code === 'in_review') {
      show(result);
    } else if (result.code === 'pay_off') {
      paintNotice('Payment is closed just now', 'We can\'t take payments on this page at the moment. Your details are saved. Please try again later, or contact us.',
        `<a class="btn btn-primary" href="${pageUrl('contact')}">Contact us</a>`);
    } else if (result.code === 'wrong_stage') {
      show(result);
    } else if (inner.querySelector('[data-co-msg]')) {
      say(WORDS[result.code] || WORDS.server);
    } else {
      paintNotice('That did not work', esc(WORDS[result.code] || WORDS.server));
    }
  }

  /* ---------------------------------------------------------------- what the client does */
  async function onSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    let fields;
    let action;
    if (form.dataset.coForm === 'broker') {
      const picked = form.querySelector('input[name="broker"]:checked');
      if (!picked) { say(WORDS.broker_bad); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) { say(WORDS.email_bad); return; }
      [action, fields] = ['broker', { broker: picked.value, email: form.elements.email.value.trim() }];
    } else {
      const account = form.elements.account.value.replace(/\s+/g, '');
      if (!/^\d{5,12}$/.test(account)) { say(WORDS.mt5_bad); return; }
      [action, fields] = ['mt5', { account }];
    }
    setBusy(button, true);
    const result = await call(action, fields);
    if (!result.ok && button.isConnected) setBusy(button, false);
    afterAction(result);
  }

  function onChange(event) {
    if (event.target.name === 'broker') paintOpenLink();
  }

  async function lookForPayment(button, byItself) {
    clearTimeout(lookAgain);
    if (button.disabled || !button.isConnected) return;
    autoLooks = byItself ? autoLooks + 1 : 0;
    setBusy(button, true);
    const result = await call('check');
    if (!button.isConnected) return;
    setBusy(button, false);
    if (result.ok) { show(result); return; }
    if (result.code === 'too_soon') {
      lookAgain = setTimeout(() => lookForPayment(button, byItself), 9000);
      return;
    }
    if (result.code === 'unpaid') {
      button.querySelector('[data-plan-label]').textContent = 'Check again';
      // A bank can take a minute, so we look twice more by ourselves. Not more: the bank's service answers 100 questions a day.
      if (autoLooks < 2) {
        say('We can\'t see your payment yet. Banks can take a minute, so we are looking again by ourselves.');
        lookAgain = setTimeout(() => lookForPayment(button, true), autoLooks === 0 ? 20000 : 40000);
      } else {
        say('Still not there. When your bank app shows the payment is done, tap the button again.');
      }
      return;
    }
    afterAction(result);
  }

  // The poster as one picture, drawn the way the bot draws it: 1254 square, the code in whole pixels, nothing on top of it.
  async function savePoster() {
    const qr = shownQr;
    const art = inner.querySelector('[data-co-art]');
    await art.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 1254;
    canvas.height = 1254;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(art, 0, 0, 1254, 1254);
    ctx.fillStyle = '#3a3f44';
    ctx.font = '500 27px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillText(qr.name, 741, 430, 411);
    ctx.fillStyle = '#16191c';
    ctx.font = '700 52px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillText(`$ ${Number(qr.amount).toFixed(2)}`, 741, 493, 411);
    const each = Math.floor(444 / qr.size);
    const side = qr.size * each;
    ctx.translate(718 + Math.floor((444 - side) / 2), 536 + Math.floor((444 - side) / 2));
    ctx.scale(each, each);
    ctx.fillStyle = '#000';
    ctx.fill(new Path2D(qr.path));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `RZGS-PRO-${(PLANS[order.plan] || {}).name || 'Plan'}-KHQR.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  async function onClick(event) {
    if (event.target === box || event.target.closest('[data-co-close]')) { box.close(); return; }
    if (event.target.closest('a[data-plans]')) { box.close(); return; }
    const paid = event.target.closest('[data-co-paid]');
    if (paid) { lookForPayment(paid, false); return; }
    if (event.target.closest('[data-co-save]')) { savePoster(); return; }
    if (event.target.closest('[data-co-new]')) { paintLoading(); afterAction(await call('pay')); return; }
    if (event.target.closest('[data-co-back]')) { paintLoading(); afterAction(await call('back')); return; }
    const ask = event.target.closest('[data-co-ask]');
    if (ask) { ask.disabled = true; afterAction(await call('ask_review')); return; }
    const yes = event.target.closest('[data-co-cancel-yes]');
    if (yes) {
      setBusy(yes, true, 'Cancelling...');
      const result = await call('cancel');
      if (!result.ok) {
        setBusy(yes, false);
        say(result.code === 'no_paid_plan' ? 'There is no paid plan running on this account.' : WORDS[result.code] || WORDS.server);
        return;
      }
      announce(result);
      paintNotice('Your plan is cancelled', 'You can choose a new plan now. A bot that is running in MT5 does not stop by itself: pause it in the control app or take it off the chart.',
        `<a class="btn btn-primary" href="${pageUrl('./#plans')}" data-plans>See plans</a>`);
    }
  }

  // Copy and download also work on the dashboard, outside the box.
  document.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-co-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.coCopy);
        copy.textContent = 'Copied';
      } catch (e) {
        copy.textContent = 'Select it';
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
      return;
    }
    const file = event.target.closest('[data-co-file]');
    if (!file) return;
    setBusy(file, true, 'Downloading...');
    try {
      const response = await send({ action: 'file' });
      if (!response.ok) throw new Error('no file');
      const name = ((response.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'RZGS-PRO.ex5';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await response.blob());
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } catch (e) {
      const line = file.closest('.plan-btn-glow').parentElement.querySelector('[data-co-file-msg]') || document.createElement('p');
      line.className = 'co-msg';
      line.dataset.coFileMsg = '';
      line.dataset.tone = 'error';
      line.setAttribute('role', 'alert');
      line.textContent = 'The download did not work. Please try again, or contact us.';
      file.closest('.plan-btn-glow').after(line);
    }
    setBusy(file, false);
  });

  /* ---------------------------------------------------------------- what other files use */
  // The broker, email and MT5 number of their last bot, so a renewal needs almost no typing.
  async function loadLast() {
    try {
      const db = await window.rzgsPlans.db();
      const { data } = await db.rpc('web_my_checkout');
      if (data && data.ok) last = data.last;
    } catch (e) { /* they type it */ }
  }

  window.rzgsCheckout = {
    // A plan button: starts the order, or takes it up again where it was.
    async open(plan) {
      openBox();
      paintLoading();
      const [result] = await Promise.all([call('start', { plan }), loadLast()]);
      afterAction(result);
    },
    // "Continue" on the dashboard.
    async resume() {
      openBox();
      paintLoading();
      const [result] = await Promise.all([call('state'), loadLast()]);
      afterAction(result);
    },
    // Asked before anything changes. The days left are gone (the owner, 2026-10-31).
    askCancel(plan, expiresAt) {
      openBox();
      const name = (PLANS[plan] || {}).name || 'paid';
      const ends = expiresAt ? new Date(expiresAt) : null;
      const left = ends ? Math.max(0, Math.ceil((ends - Date.now()) / 86400000)) : 0;
      paint(`<h2 id="co-title">Cancel your ${esc(name)} plan?</h2>
        <p class="plan-confirm-lead">${ends ? `It runs until ${dateText(ends)}, ${left} ${left === 1 ? 'day' : 'days'} left. ` : ''}If you cancel, those days are gone: they are not refunded and they do not move to a new plan.</p>
        <p class="plan-confirm-lead">Cancelling does not stop a bot that is running in MT5. To stop it, pause it in the control app or take it off the chart.</p>
        ${message('')}
        <div class="co-row">
          <button class="btn btn-ghost" type="button" data-co-close data-co-first>No, keep my plan</button>
          <span class="plan-btn-glow co-danger"><button class="plan-btn" type="button" data-co-cancel-yes><span data-plan-label>Yes, cancel my plan</span></button></span>
        </div>`);
    },
    async drop() {
      await call('close');
      announce();
    },
    renderLicence(element, licence) {
      element.innerHTML = licenceHtml(licence);
    },
  };
})();
