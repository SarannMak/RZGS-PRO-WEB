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
  let movingTo = null;   // asked to cancel in order to move up to this plan
  let pickedBroker = ''; // chosen on the first screen of the broker step, not yet sent to the server
  // The robot beside the steps, on a computer only (the owner's drawing, 2026-11-02). It is loaded the first time it is needed.
  const WIDE = '(min-width: 860px)';
  let robot = null;
  let robotAsked = false;
  let robotPose = 'rest';
  let justDone = ''; // what was just confirmed, for the words of the celebration
  let cancelling = null; // the plan and the days a person is being asked about

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
    box.innerHTML = `<div class="co-shell">
        <aside class="co-side">
          <p class="co-side-head"><img src="${pageUrl('assets/logo-192.webp')}" width="34" height="34" alt="">RZGS<span>-PRO</span></p>
          <div class="co-side-words"><p class="co-side-title" data-co-side-title></p><p class="co-side-text" data-co-side-text></p></div>
          <div class="co-robot" data-co-robot aria-hidden="true"></div>
          <div data-co-side-pay></div>
        </aside>
        <div class="plan-confirm-in co-in" tabindex="-1"></div>
      </div>`;
    inner = box.querySelector('.co-in');
    document.body.append(box);
    box.addEventListener('click', onClick);
    box.addEventListener('submit', onSubmit);
    box.addEventListener('change', onChange);
    box.addEventListener('input', (event) => event.target.classList.remove('is-wrong'));
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

  function wakeRobot(pose) {
    robotPose = pose;
    if (robot) { robot.pose(pose); return; }
    if (robotAsked || !matchMedia(WIDE).matches || (navigator.connection && navigator.connection.saveData)) return;
    robotAsked = true;
    const place = box.querySelector('[data-co-robot]');
    const script = window.rzgsRobot ? Promise.resolve() : new Promise((yes, no) => {
      const tag = document.createElement('script');
      tag.src = pageUrl('robot-3d.js?v=10');
      tag.onload = yes;
      tag.onerror = no;
      document.head.append(tag);
    });
    script.then(() => window.rzgsRobot.guide(place)).then((made) => {
      robot = made;
      if (robot) robot.pose(robotPose);
    }).catch(() => place.classList.add('robot-failed'));
  }

  // beside: what stands left of the steps on a computer: { title, text, pose }. Without it the box is the small one.
  function paint(html, beside = null) {
    stopTimers();
    box.classList.remove('co--pay');
    box.classList.toggle('co--split', Boolean(beside));
    box.querySelector('[data-co-side-pay]').replaceChildren();
    if (beside) {
      box.querySelector('[data-co-side-title]').textContent = beside.title || '';
      box.querySelector('[data-co-side-text]').textContent = beside.text || '';
      if (beside.pose) wakeRobot(beside.pose);
    }
    inner.innerHTML = `<button class="plans-x plans-x--in" type="button" data-co-close aria-label="Close">${X}</button>${html}`;
    inner.scrollTop = 0;
    box.querySelector('.co-shell').scrollTop = 0;
    const first = inner.querySelector('input:not([type="radio"]), [data-co-first]');
    if (first) first.focus({ preventScroll: true });
    else inner.focus({ preventScroll: true });
  }

  const paintLoading = () => paint(`<div class="co-loading" role="status">${SPINNER}<span>One moment...</span></div>`, { title: 'One moment', pose: 'rest' });

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
  // Stuck on any step: the words go to our team on Telegram, with the order number already typed.
  const helpLine = (words = 'Need help?') => {
    const text = `Hello, I need help with my RZGS-PRO order${order && order.id ? ` #${order.id}` : ''}.`;
    return `<p class="co-help">${words} <a href="https://t.me/sarannsadboi?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Contact our team</a></p>`;
  };
  const agree = `<p class="plan-confirm-note">By continuing you agree to our <a href="${pageUrl('license')}">License Rules</a> and <a href="${pageUrl('terms')}">Terms &amp; Conditions</a>. Your plan does not renew by itself.</p>`;

  // A check that did not pass says "no" like a wrong password: the box turns red and shakes, the cursor goes back to it.
  function say(text, html) {
    const line = inner.querySelector('[data-co-msg]');
    if (!line) return;
    line.dataset.tone = 'error';
    line.hidden = false;
    if (html) line.innerHTML = text;
    else line.textContent = text;
    const field = inner.querySelector('.co-input');
    if (field) {
      field.classList.add('is-wrong');
      field.focus({ preventScroll: true });
      field.select();
    }
    if (window.rzgsMotion) {
      window.rzgsMotion.shake(line);
      if (field) window.rzgsMotion.shake(field);
    }
    if (robot) robot.no();
  }

  // A check that passed: a tick draws itself and says what was checked, then the next step comes up (the owner, 2026-11-02).
  async function tick(words) {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const over = document.createElement('div');
    over.className = 'co-tick';
    over.setAttribute('role', 'status');
    over.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M19 33l9 9 17-19"/></svg><p>${words}</p>`;
    // the box on a phone: there the payment scrolls as a whole, and the tick has to be in sight
    (matchMedia(WIDE).matches ? inner : box).append(over);
    if (robot) robot.nod();
    await new Promise((done) => setTimeout(done, calm ? 500 : 950));
    setTimeout(() => over.remove(), 0);
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
  // The broker step is two screens (the owner, 2026-11-02): choose the broker and open an account, then the email is checked.
  function paintBroker() {
    pickedBroker = order.broker || (last && last.broker) || '';
    if (order.broker) paintEmail();
    else paintBrokerChoice();
  }

  function paintBrokerChoice() {
    paint(`${rail(order.plan, 'broker')}${planLine(order.plan)}
      <h2 id="co-title">Connect Your Broker</h2>
      <p class="plan-confirm-lead">Your MT5 account has to be opened with our link at one of these brokers.</p>
      <fieldset class="co-brokers">
        <legend>Your broker</legend>
        ${BROKERS.map((broker) => `<label class="co-broker"><input type="radio" name="broker" value="${broker.id}"${broker.id === pickedBroker ? ' checked' : ''}><span>${broker.name}</span></label>`).join('')}
      </fieldset>
      ${message(order.note)}
      <div data-co-broker-go hidden>
        <p class="co-open" data-co-open></p>
        <div class="co-stack">
          <a class="btn btn-ghost" data-co-open-link target="_blank" rel="noopener sponsored">Open An Account</a>
          ${mainButton('I Have Registered', 'type="button" data-co-registered')}
        </div>
      </div>
      ${helpLine()}`, { title: 'Let\'s set up your bot', text: 'First, choose your broker. Everything happens right here, step by step.', pose: 'point' });
    paintBrokerGo();
  }

  // Choosing a broker brings up its two buttons.
  function paintBrokerGo() {
    const go = inner.querySelector('[data-co-broker-go]');
    const broker = brokerById(pickedBroker);
    if (!go || !broker) return;
    go.hidden = false;
    go.querySelector('[data-co-open]').textContent = `Open your ${broker.name} account with our link, then come back here.`;
    go.querySelector('[data-co-open-link]').href = broker.link;
  }

  function paintEmail() {
    const broker = brokerById(pickedBroker);
    const email = order.broker_email || (last && last.broker_email) || accountEmail;
    paint(`${rail(order.plan, 'broker')}${planLine(order.plan)}
      <h2 id="co-title">Connect Your Email</h2>
      <p class="plan-confirm-lead">Type the email you used to open your ${broker.name} account. We check that it is under our link.</p>
      <form data-co-form="broker" novalidate>
        <div class="co-field">
          <label for="co-email">Your ${broker.name} email</label>
          <input class="co-input" id="co-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(email)}" required>
        </div>
        ${message(order.note)}
        <button class="btn btn-ghost btn-block co-ask" type="button" data-co-ask hidden>Ask our team to check</button>
        ${mainButton('Check My Account', 'type="submit"')}
        <button class="co-back" type="button" data-co-change-broker>Change broker</button>
        ${helpLine()}
        ${agree}
      </form>`, { title: 'Now your email', text: 'It lets me check that your account is under our link.', pose: 'point' });
  }

  function paintMt5() {
    const back = PLANS[order.plan].steps[0] !== 'mt5';
    const typed = order.mt5 || (last && last.mt5) || '';
    const paid = order.amount > 0;
    paint(`${rail(order.plan, 'mt5')}${planLine(order.plan)}
      <h2 id="co-title">Connect Your MT5</h2>
      <p class="plan-confirm-lead">The login number of the account the bot will run on. It has to be a hedging account${order.plan === 'diamond' ? ' that can trade gold' : ''}.</p>
      <form data-co-form="mt5" novalidate>
        <div class="co-field">
          <label for="co-mt5">MT5 login number</label>
          <input class="co-input" id="co-mt5" name="account" type="text" inputmode="numeric" autocomplete="off" value="${esc(typed)}" required>
        </div>
        ${message(order.note)}
        <button class="btn btn-ghost btn-block co-ask" type="button" data-co-ask hidden>Ask our team to check</button>
        ${mainButton(paid ? 'Continue to payment' : 'Get my bot', 'type="submit"')}
        ${back ? '<button class="co-back" type="button" data-co-back>Back</button>' : ''}
        ${helpLine()}
        ${back ? '' : agree}
      </form>`, { title: 'Almost there', text: 'Tell me your MT5 number. That is the account I will run on.', pose: 'point' });
  }

  // The owner's Scan to Pay poster, with this order's own QR, name and amount where the bot's poster has them.
  function paintPay(qr) {
    const money = `$${Number(qr.amount).toFixed(2)}`;
    paint(`${rail(order.plan, 'pay')}${planLine(order.plan)}
      <h2 id="co-title">Complete Your Payment</h2>
      <p class="plan-confirm-lead">Pay ${money} by KHQR.</p>
      ${message(order.note)}
      <button class="btn btn-ghost btn-block co-ask" type="button" data-co-ask hidden>Ask our team to check my payment</button>
      <div class="co-stack">
        <button class="btn btn-ghost" type="button" data-co-save>Save the QR Code</button>
        ${mainButton('I Have Paid', 'type="button" data-co-paid data-co-first')}
      </div>
      <p class="co-left" data-co-left></p>
      <ol class="co-how">
        <li>Open your bank app and scan the code. Paying on this phone? Save the QR code, then scan it from your photos.</li>
        <li>Pay the amount it shows, then tap I Have Paid.</li>
      </ol>
      <button class="co-back" type="button" data-co-back>Back</button>
      ${helpLine('Problem with your payment?')}`, {});
    box.classList.add('co--pay');
    box.querySelector('[data-co-side-pay]').innerHTML = `<div class="co-poster">
        <img src="${pageUrl(`assets/pay-${order.plan}.webp`)}" width="1254" height="1254" alt="Scan to pay ${money}" data-co-art>
        <div class="co-poster-card"><p>${esc(qr.name)}</p><b>$ ${Number(qr.amount).toFixed(2)}</b></div>
        <div class="co-poster-qr" data-co-qr><svg viewBox="0 0 ${qr.size} ${qr.size}" role="img" aria-label="KHQR code for ${money}" shape-rendering="crispEdges"><path d="${qr.path}"/></svg></div>
      </div>`;
    shownQr = qr;
    autoLooks = 0;
    const place = box.querySelector('[data-co-qr]');
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
      </div>
      ${helpLine('Waiting too long?')}`, { title: 'Give us a moment', text: 'Our team is checking by hand. There is nothing more to do.', pose: 'rest' });
  }

  function paintReady(licence) {
    paint(`${rail(licence.plan, 'bot')}
      <h2 id="co-title">Here is Your Bot</h2>
      <p class="plan-confirm-lead"><span class="co-phone-only">Done, congratulations! </span>Keep these two passwords. They stay on your dashboard too.</p>
      ${licenceHtml(licence, true)}
      <div class="co-row">
        <a class="btn btn-ghost" href="${pageUrl('app')}">Open control app</a>
        <a class="btn btn-ghost" href="${pageUrl('dashboard')}">Go to my dashboard</a>
      </div>`, { title: 'Done, congratulations!', text: 'Your bot is ready. Put me on your MT5 and we can start.', pose: 'cheer' });
    celebrate(licence);
  }

  // Paper falling over the whole screen, in the site's colours. It stands above the box, in the top layer, and lets clicks through.
  function confetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'co-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    const open = 'showPopover' in HTMLElement.prototype;
    if (open) canvas.setAttribute('popover', 'manual');
    (open ? document.body : box).append(canvas);
    if (open) canvas.showPopover();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const wide = innerWidth, high = innerHeight;
    canvas.width = wide * ratio;
    canvas.height = high * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const COLORS = ['#19d3ff', '#a6ff1a', '#37efb8', '#ffd23f', '#ffffff', '#5aa9ff'];
    const pieces = [];
    // two bursts from the lower corners, one from the middle; a phone gets fewer
    const count = wide < 600 ? 70 : 110;
    const burst = (x, y, angle, spread, power, wait) => {
      for (let i = 0; i < count; i++) {
        const way = angle + (Math.random() - 0.5) * spread, speed = power * (0.55 + Math.random() * 0.75);
        pieces.push({ x, y, vx: Math.cos(way) * speed, vy: Math.sin(way) * speed, w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, turn: Math.random() * 6.28, spin: (Math.random() - 0.5) * 14, flip: Math.random() * 6.28, color: COLORS[i % COLORS.length], wait });
      }
    };
    const power = Math.max(high * 1.5, 900);
    burst(0, high, -1.05, 0.9, power, 0);
    burst(wide, high, -2.09, 0.9, power, 0);
    burst(wide / 2, high * 0.42, -1.57, 3.2, power * 0.5, 0.18);
    const started = performance.now();
    let last = started;
    const frame = (now) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const age = (now - started) / 1000;
      ctx.clearRect(0, 0, wide, high);
      ctx.globalAlpha = Math.min(1, Math.max(0, (3.1 - age) / 0.7));
      for (const p of pieces) {
        if (age < p.wait) continue;
        p.vy += 1500 * dt;
        p.vx *= 1 - 1.5 * dt;
        p.vy *= 1 - 1.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.turn += p.spin * dt;
        p.flip += 9 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (age < 3.1) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  }

  // The moment the bot is theirs (the owner, 2026-11-02): "Congratulations!" over the page, which is ready underneath.
  // Once for each bot: opening the same bot again later does not start the party again. A tap goes straight to the page.
  function celebrate(licence) {
    const mark = `rzgs_cheered_${licence.mt5}_${licence.expires_at}`;
    let seen = null;
    try {
      seen = localStorage.getItem(mark);
      localStorage.setItem(mark, '1');
    } catch (e) { /* private window */ }
    const words = justDone;
    justDone = '';
    if (seen && !words) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const over = document.createElement('div');
    over.className = 'co-tick co-party';
    over.setAttribute('role', 'status');
    over.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M19 33l9 9 17-19"/></svg>
      <h3 class="text-gradient">Congratulations!</h3>
      <p>${words ? `${esc(words)} ` : ''}Your bot is ready.</p>`;
    (matchMedia(WIDE).matches ? inner : box).append(over);
    if (!calm) confetti();
    let timer = null;
    const leave = () => {
      clearTimeout(timer);
      over.classList.add('is-leaving');
      setTimeout(() => over.remove(), 280);
    };
    timer = setTimeout(leave, calm ? 1500 : 2800);
    over.addEventListener('click', leave);
  }

  // The second question before a plan with days left is cancelled: those days can't be brought back (the owner, 2026-11-02).
  function paintCancelSure() {
    const { name, left } = cancelling;
    paint(`<p class="co-plan">Confirm 2 of 2</p>
      <h2 id="co-title">Are you sure?</h2>
      <p class="plan-confirm-lead">Your ${esc(name)} plan stops now and its ${left} ${left === 1 ? 'day' : 'days'} are gone for good. We can't bring them back.</p>
      ${message('')}
      <div class="co-row">
        <button class="btn btn-ghost" type="button" data-co-close data-co-first>No, keep my plan</button>
        <span class="plan-btn-glow co-danger"><button class="plan-btn" type="button" data-co-cancel-yes disabled><span data-plan-label>Yes, cancel it now</span></button></span>
      </div>`);
    // It can be pressed after a moment, so a double click on the first Yes can't also answer this one.
    const yes = inner.querySelector('[data-co-cancel-yes]');
    setTimeout(() => { yes.disabled = false; }, 1200);
  }

  function paintNotice(title, text, buttons = '') {
    paint(`<h2 id="co-title">${title}</h2><p class="plan-confirm-lead">${text}</p>${message('')}<div class="co-row">${buttons}<button class="btn btn-ghost" type="button" data-co-close data-co-first>Close</button></div>`);
  }

  // What the bot needs in MT5: on the last step here, and on the dashboard for as long as the plan runs.
  // fileLast: the download button under the steps, as the last thing in the box.
  function licenceHtml(licence, fileLast = false) {
    const key = (label, value) => `<div class="co-key"><span>${label}</span><code>${esc(value)}</code><button class="co-copy" type="button" data-co-copy="${esc(value)}">Copy</button></div>`;
    const broker = brokerById(licence.broker && String(licence.broker).toLowerCase());
    const file = mainButton('Download your bot file', 'type="button" data-co-file');
    return `<div class="co-keys">${key('Bot Password', licence.bot_password)}${key('App Password', licence.app_password)}</div>
      <p class="co-small">Your Bot Password works only on account ${esc(licence.mt5)}${broker ? ` at ${broker.name}` : ''}, until ${dateText(licence.expires_at)}. Already running the bot? Put this file in place of the old one and type the new Bot Password.</p>
      ${fileLast ? '' : file}
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
      </details>
      ${fileLast ? file : ''}`;
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
      const broker = brokerById(result.broker || (order && order.broker));
      say(`We can't find this number on your ${esc(name)} account. Check the number, or create a new trading account in your ${broker ? `<a href="${esc(broker.link)}" target="_blank" rel="noopener sponsored">${esc(name)} account</a>` : 'broker account'} and type its number here.`, true);
    } else if (result.code === 'broker_down' && order && order.stage === 'mt5') {
      say(`We could not check this number at ${name}. Please try again. If it still fails, create a new trading account in your ${name} account and type its number here.${result.can_ask ? ' Or ask our team to check it for you.' : ''}`);
      if (ask) ask.hidden = !result.can_ask;
    } else if (result.code === 'broker_down') {
      say(`${name} did not answer just now. Please try again.${result.can_ask ? ' Or ask our team to check it for you.' : ''}`);
      if (ask) ask.hidden = !result.can_ask;
    } else if (result.code === 'trial_used') {
      paintNotice('You have used your free days', 'The free trial is once per person. Elite and Diamond are open to you any time.',
        `<a class="btn btn-primary" href="${pageUrl('./#plans')}" data-plans>See plans</a>`);
    } else if (result.code === 'paid_running') {
      paintNotice('Your plan is still running', 'A new plan can start when this one ends. To change now, cancel your plan first: you find it under See plans.',
        `<a class="btn btn-primary" href="${pageUrl('./#plans')}" data-plans>See plans</a>`);
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) { say(WORDS.email_bad); return; }
      [action, fields] = ['broker', { broker: pickedBroker, email: form.elements.email.value.trim() }];
    } else {
      const account = form.elements.account.value.replace(/\s+/g, '');
      if (!/^\d{5,12}$/.test(account)) { say(WORDS.mt5_bad); return; }
      [action, fields] = ['mt5', { account }];
    }
    setBusy(button, true);
    const result = await call(action, fields);
    if (!result.ok && button.isConnected) setBusy(button, false);
    // the bot straight away (Free): the celebration says it. Sent to a person: nothing to tick yet.
    if (result.ok && result.licence) justDone = 'MT5 account confirmed.';
    else if (result.ok && !(result.order && result.order.stage === 'review')) await tick(action === 'broker' ? 'Account found' : 'MT5 account confirmed');
    afterAction(result);
  }

  function onChange(event) {
    if (event.target.name === 'broker') {
      pickedBroker = event.target.value;
      paintBrokerGo();
    }
  }

  async function lookForPayment(button, byItself) {
    clearTimeout(lookAgain);
    if (button.disabled || !button.isConnected) return;
    autoLooks = byItself ? autoLooks + 1 : 0;
    setBusy(button, true);
    const result = await call('check');
    if (!button.isConnected) return;
    if (result.ok && result.licence) justDone = 'Payment received.';
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
        say('Still not there. If your bank app shows the payment is done, tap the button again, or ask our team to check it.');
        const ask = inner.querySelector('[data-co-ask]');
        if (ask) ask.hidden = false;
      }
      return;
    }
    afterAction(result);
  }

  // The poster as one picture, drawn the way the bot draws it: 1254 square, the code in whole pixels, nothing on top of it.
  async function savePoster() {
    const qr = shownQr;
    const art = box.querySelector('[data-co-art]');
    await art.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 1254;
    canvas.height = 1254;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(art, 0, 0, 1254, 1254);
    ctx.fillStyle = '#3a3f44';
    ctx.font = '500 27px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillText(qr.name, 428, 390, 411);
    ctx.fillStyle = '#16191c';
    ctx.font = '700 52px "IBM Plex Sans", Arial, sans-serif';
    ctx.fillText(`$ ${Number(qr.amount).toFixed(2)}`, 428, 453, 411);
    const each = Math.floor(444 / qr.size);
    const side = qr.size * each;
    ctx.translate(405 + Math.floor((444 - side) / 2), 496 + Math.floor((444 - side) / 2));
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
    if (event.target.closest('[data-co-registered]')) { paintEmail(); return; }
    if (event.target.closest('[data-co-change-broker]')) { paintBrokerChoice(); return; }
    const paid = event.target.closest('[data-co-paid]');
    if (paid) { lookForPayment(paid, false); return; }
    if (event.target.closest('[data-co-save]')) { savePoster(); return; }
    if (event.target.closest('[data-co-new]')) { paintLoading(); afterAction(await call('pay')); return; }
    if (event.target.closest('[data-co-back]')) { paintLoading(); afterAction(await call('back')); return; }
    const ask = event.target.closest('[data-co-ask]');
    if (ask) { ask.disabled = true; afterAction(await call('ask_review')); return; }
    if (event.target.closest('[data-co-cancel-sure]')) { paintCancelSure(); return; }
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
      const stillRuns = 'A bot that is running in MT5 does not stop by itself: pause it in the control app or take it off the chart.';
      if (movingTo === 'diamond') paintNotice('Your plan is cancelled', `Now our sales team helps you with Diamond on Telegram. ${stillRuns}`,
        '<a class="btn btn-primary" href="https://t.me/sarannsadboi" target="_blank" rel="noopener">Contact Sales</a>');
      else paintNotice('Your plan is cancelled', `You can choose a new plan now. ${stillRuns}`,
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
    // Asked before anything changes. The days left are gone (the owner, 2026-10-31). next: the plan they are moving up to.
    // Days left: asked twice. A plan that has ended: asked once, with nothing to lose (the owner, 2026-11-02).
    askCancel(plan, expiresAt, next) {
      openBox();
      movingTo = next || null;
      const name = (PLANS[plan] || {}).name || 'paid';
      const ends = expiresAt ? new Date(expiresAt) : null;
      const left = ends ? Math.max(0, Math.ceil((ends - Date.now()) / 86400000)) : 0;
      cancelling = { name, left };
      if (ends && ends <= Date.now()) {
        paint(`<h2 id="co-title">${next ? `Move from ${esc(name)} to Diamond?` : `Your ${esc(name)} plan has ended`}</h2>
          <p class="plan-confirm-lead">It ended on ${dateText(ends)}, so you lose nothing. ${next ? 'Our sales team helps you with Diamond on Telegram.' : 'You can choose a new plan now.'}</p>
          <div class="co-row">
            <button class="btn btn-ghost" type="button" data-co-close data-co-first>${next ? 'No, not now' : 'Close'}</button>
            ${next
              ? '<a class="btn btn-primary" href="https://t.me/sarannsadboi" target="_blank" rel="noopener" data-co-close>Yes, Contact Sales</a>'
              : `<a class="btn btn-primary" href="${pageUrl('./#plans')}" data-plans>See plans</a>`}
          </div>`);
        return;
      }
      paint(`<p class="co-plan">Confirm 1 of 2</p>
        <h2 id="co-title">${next ? `Move from ${esc(name)} to Diamond?` : `Cancel your ${esc(name)} plan?`}</h2>
        ${next ? `<p class="plan-confirm-lead">To move up, your ${esc(name)} plan is cancelled first. Then our sales team helps you with Diamond on Telegram.</p>` : ''}
        <p class="plan-confirm-lead">${ends ? `It runs until ${dateText(ends)}, ${left} ${left === 1 ? 'day' : 'days'} left. ` : ''}If you cancel, those days are gone: they are not refunded and they do not move to a new plan.</p>
        <p class="plan-confirm-lead">Cancelling does not stop a bot that is running in MT5. To stop it, pause it in the control app or take it off the chart.</p>
        ${message('')}
        <div class="co-row">
          <button class="btn btn-ghost" type="button" data-co-close data-co-first>No, keep my plan</button>
          <span class="plan-btn-glow co-danger"><button class="plan-btn" type="button" data-co-cancel-sure><span data-plan-label>Yes, cancel my plan</span></button></span>
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
