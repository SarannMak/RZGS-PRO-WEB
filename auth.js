/* ==========================================================================
   RZGS-PRO website accounts: email + password, through Supabase Auth.
   Used by login.html, signup.html, reset-password.html and dashboard.html.
   Needs supabase-js loaded before it.
   ========================================================================== */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://zaziizzsbytkdlatoutv.supabase.co';
  // Publishable key: made to be used in the browser. Row-level security protects the data.
  const SUPABASE_KEY = 'sb_publishable_ojfdWkyt22zlG0Uz_CUd4w_IufedKpK';

  const MIN_PASSWORD = 8;
  const RESEND_WAIT = 60; // seconds between "resend email" clicks

  const page = document.body.dataset.authPage; // login | signup | reset | dashboard
  // The moves of motion.js. Without that file everything still works, it just doesn't move.
  const motion = window.rzgsMotion || {
    shake() {},
    fromTap() {},
    reveal(element) { element.hidden = false; },
    conceal(element, done) { element.hidden = true; if (done) done(); },
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Email links come back with details in the address. Read them before supabase-js tidies the URL.
  const urlQuery = new URLSearchParams(location.search);
  const urlHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromUrl = (key) => urlHash.get(key) || urlQuery.get(key);
  const arrivedFrom = fromUrl('type'); // "signup" after confirming an email, "recovery" for a password reset, "email_change"
  const urlError = fromUrl('error_description') || fromUrl('error');
  // A change of email may have to be confirmed from both inboxes, the old and the new. The first link opened
  // then comes back with a note instead of a sign-in ("... proceed to confirm link sent to the other email").
  const firstOfTwo = /other email/i.test(fromUrl('message') || '');
  const FIRST_OF_TWO = 'Step 1 of 2 is done. Now open the link we sent to your other email address to finish the change.';

  // Full address of another page in this same folder, e.g. https://site.com/dashboard.html
  // It is only used for the links in our emails. Those keep ".html": that address is the one known to work
  // with the login provider, and the page tidies its own address when it opens (see script.js).
  const pageUrl = (name) => new URL(name, location.href).href.split(/[?#]/)[0];

  // Someone who tapped a "claim" or "see the plans" button before they were signed in goes back to that page
  // (plans.js wrote down which page). Everyone else goes to their dashboard. Whether the plans then come up by
  // themselves is for plans.js to say: only for someone with no plan running.
  function afterSignIn() {
    try {
      const wish = JSON.parse(localStorage.getItem('rzgs_after_login') || 'null');
      localStorage.removeItem('rzgs_after_login');
      if (wish && Date.now() - wish.at < 86400000 && /^\/(?!\/)/.test(wish.to)) return wish.to;
    } catch (e) { /* no storage: the dashboard */ }
    return 'dashboard';
  }
  // Just logged in or just signed up: plans.js looks at this on the next page.
  function markJustIn() {
    try { sessionStorage.setItem('rzgs_just_in', '1'); } catch (e) { /* private window: no offer, nothing lost */ }
  }

  /* ---------------------------------------------------------------- messages */
  const msgBox = $('[data-auth-msg]');
  function showMessage(text, tone = 'error') {
    if (!msgBox) return;
    $('[data-auth-msg-text]', msgBox).textContent = text;
    msgBox.dataset.tone = tone;
    $('use', msgBox).setAttribute('href', tone === 'success' ? '#i-check' : '#i-alert');
    motion.reveal(msgBox);
  }
  function clearMessage() {
    if (msgBox) motion.conceal(msgBox);
  }

  // Turn a Supabase error into a sentence a customer can act on.
  function friendlyError(error) {
    const code = (error && error.code) || '';
    const status = (error && error.status) || 0;
    const text = (error && error.message) || '';
    if (!navigator.onLine) return "You're offline. Check your connection and try again.";
    // supabase-js reports every server-side failure (HTTP 500 and up) as a "retryable fetch error".
    // Only a missing status means the request never arrived.
    if (status >= 500) {
      return /sending .*mail/i.test(text)
        ? "We couldn't send the email right now. Please try again in a few minutes, or contact us."
        : 'Our server had a problem. Please try again in a few minutes.';
    }
    if (error && error.name === 'AuthRetryableFetchError') {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    const known = {
      invalid_credentials: 'Wrong email or password.',
      email_not_confirmed: 'Your email is not confirmed yet. Type the code we emailed you when you signed up.',
      user_already_exists: 'This email already has an account. Log in instead.',
      email_exists: 'This email already has an account. Log in instead.',
      weak_password: `Please choose a stronger password with at least ${MIN_PASSWORD} characters.`,
      same_password: 'Your new password must be different from your old one.',
      email_address_invalid: "That email address doesn't look right. Please check it.",
      captcha_failed: "The safety check didn't pass. Please try again.",
      over_email_send_rate_limit: 'Too many emails were sent. Please wait a few minutes and try again.',
      over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
      email_provider_disabled: 'Sign-up is not available right now. Please contact us.',
      signup_disabled: 'Sign-up is not available right now. Please contact us.',
      email_address_not_authorized: "We couldn't send the email right now. Please contact us.",
      otp_expired: 'This link has expired. Please request a new one.',
      session_not_found: 'Your session has ended. Please log in again.',
      reauthentication_needed: 'For your safety, please sign out, log in again, and then change your password.',
    };
    if (known[code]) return known[code];
    if (status === 429) return known.over_request_rate_limit;
    return 'Something went wrong. Please try again.';
  }

  /* ------------------------------------------------------------- form helpers */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // The password a new account gets (the owner, 2026-11-02). The list under the box lights up rule by rule.
  const PASSWORD_RULES = {
    length: (v) => v.length >= 8 && v.length <= 15,
    cases: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
    number: (v) => /\d/.test(v),
    special: (v) => /[^A-Za-z0-9\s]/.test(v),
  };
  // Signed up, code not typed yet: the sign-up page opens on the code step for this email.
  const VERIFY_KEY = 'rzgs_verify_email';

  // One rule per field name. Each returns an error sentence, or '' when the value is fine.
  // A social link: the person's name there, or a link to their page at that site. Only that site's address is kept.
  // '' when empty, null when it is neither.
  const SOCIALS = {
    facebook: { name: 'Facebook', base: 'https://www.facebook.com/', host: /(^|\.)(facebook\.com|fb\.com)$/i },
    tiktok: { name: 'TikTok', base: 'https://www.tiktok.com/@', host: /(^|\.)tiktok\.com$/i },
    youtube: { name: 'YouTube', base: 'https://www.youtube.com/@', host: /(^|\.)(youtube\.com|youtu\.be)$/i },
    instagram: { name: 'Instagram', base: 'https://www.instagram.com/', host: /(^|\.)instagram\.com$/i },
  };
  function socialUrl(kind, raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const name = text.replace(/^@/, '');
    if (/^[\w.-]{1,64}$/.test(name) && !SOCIALS[kind].host.test(name)) return SOCIALS[kind].base + name;
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (SOCIALS[kind].host.test(url.hostname)) { url.protocol = 'https:'; return url.href; }
    } catch (e) { /* not an address */ }
    return null;
  }
  const socialRule = (kind) => (v) => (socialUrl(kind, v) === null ? `Type your ${SOCIALS[kind].name} name, or paste the link to your page.` : '');

  const rules = {
    social_facebook: socialRule('facebook'),
    social_tiktok: socialRule('tiktok'),
    social_youtube: socialRule('youtube'),
    social_instagram: socialRule('instagram'),
    full_name: (v) => (v.trim().length < 2 ? 'Enter your full name.' : v.trim().length > 100 ? 'Use 100 characters or fewer.' : ''),
    email: (v) => (!v.trim() ? 'Enter your email address.' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email, like name@gmail.com.' : ''),
    password: (v) => (!v ? 'Enter your password.' : ''),
    new_password: (v) => (v.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : ''),
    create_password: (v) => (!v ? 'Create your password.' : Object.values(PASSWORD_RULES).every((ok) => ok(v)) ? '' : 'Your password needs everything in the list above.'),
    code: (v) => (/^\d{6,10}$/.test(v.replace(/\s/g, '')) ? '' : 'Type the code from the email.'),
    confirm_password: (v, form) => {
      const first = form.elements.new_password.value;
      return !v ? 'Type your password again.' : v !== first ? "The two passwords don't match." : '';
    },
    username: (v) => {
      const name = v.trim();
      if (name.length < 3) return 'Use at least 3 characters.';
      if (name.length > 24) return 'Use 24 characters or fewer.';
      return /^[A-Za-z0-9_]+$/.test(name) ? '' : 'Use only letters, numbers and underscores (_).';
    },
    country: (v) => (!v ? 'Choose your country.' : ''),
    phone: (v) => {
      const digits = v.replace(/\D/g, '');
      if (!v.trim()) return '';
      return /^[+\d][\d\s().-]*$/.test(v.trim()) && digits.length >= 6 && digits.length <= 15 ? '' : 'Enter a valid phone number with country code, like +855 12 345 678.';
    },
    telegram_username: (v) => {
      const name = v.trim().replace(/^@/, '');
      if (!name) return '';
      return /^[A-Za-z0-9_]{5,32}$/.test(name) ? '' : 'A Telegram username has 5 to 32 letters, numbers or underscores.';
    },
    accepted_terms: (v, form, input) => (input.checked ? '' : 'Please accept the terms to continue.'),
    mt5_account: (v) => {
      const digits = v.replace(/\D/g, '');
      if (!v.trim()) return '';
      return /^[\d\s-]+$/.test(v.trim()) && digits.length >= 4 && digits.length <= 15 ? '' : 'Enter your MT5 account number, using digits only.';
    },
    broker: (v) => (v.trim() && v.trim().length < 2 ? 'Enter the name of your broker.' : v.trim().length > 60 ? 'Use 60 characters or fewer.' : ''),
  };

  function setFieldError(input, message) {
    const error = document.getElementById(`${input.id}-error`);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (!error) return;
    if (message) {
      error.textContent = message;
      motion.reveal(error);
    } else {
      motion.conceal(error, () => { error.textContent = ''; });
    }
  }
  // The field shakes "no" before a word is read.
  const shakeField = (input) => motion.shake(input.closest('.input-wrap, .check-field') || input);
  function validateField(input) {
    const rule = rules[input.name];
    const message = rule ? rule(input.value, input.form, input) : '';
    setFieldError(input, message);
    return !message;
  }
  // Checks every field inside "root" and moves the cursor to the first problem.
  function validateAll(root) {
    const invalid = $$('input, select', root).filter((input) => !validateField(input));
    invalid.forEach(shakeField);
    if (invalid.length) invalid[0].focus();
    return invalid.length === 0;
  }
  // Check a field when the person leaves it; once it shows an error, re-check while they fix it.
  function wireValidation(form) {
    $$('input, select', form).forEach((input) => {
      input.addEventListener('blur', () => { if (input.value && input.type !== 'checkbox') validateField(input); });
      input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => {
        if (input.getAttribute('aria-invalid') === 'true') validateField(input);
      });
    });
  }

  function wirePasswordToggles() {
    $$('[data-toggle-password]').forEach((button) => {
      const input = document.getElementById(button.getAttribute('aria-controls'));
      button.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(show));
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
  }

  // "Resend email" button with a countdown, so nobody can spam the mail server.
  function wireResend(button, send) {
    const label = button.textContent;
    let timer = null;
    const cooldown = () => {
      let left = RESEND_WAIT;
      button.disabled = true;
      button.textContent = `Resend in ${left}s`;
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          button.disabled = false;
          button.textContent = label;
        } else {
          button.textContent = `Resend in ${left}s`;
        }
      }, 1000);
    };
    button.addEventListener('click', async () => {
      setBusy(button, true);
      const answer = await send();
      setBusy(button, false);
      if (!answer) return; // nothing was sent: the safety check is not done, and says so itself
      const { error } = answer;
      if (error) {
        showMessage(friendlyError(error));
        return;
      }
      showMessage('Email sent. Check your inbox and your spam folder.', 'success');
      cooldown();
    });
    return { cooldown };
  }

  /* ---------------------------------------------------------------- start up */
  if (!window.supabase) {
    showMessage("The page didn't load fully. Check your connection and refresh.");
    return;
  }

  // "implicit" flow: an email link opened on another phone or browser still signs the person in.
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  window.rzgsDb = db; // plans.js uses this same connection

  wirePasswordToggles();

  /* ---------------------------------------------------------------- Cloudflare's safety check */
  // Cloudflare Turnstile, the "I'm not a robot" box. Once CAPTCHA is switched on in Supabase (Authentication, Bot and
  // Abuse Protection), sign-up, log-in, a new code and a reset email are refused without its answer.
  // Empty key: no box, and every form works as before.
  const TURNSTILE_SITE_KEY = '0x4AAAAAAFwg386OwHI2rRsi';
  const CAPTCHA_WAIT = 8000; // ms a click waits for a box that is still checking
  const CAPTCHA_NOT_DONE = 'Please finish the safety check, then try again.';
  const CAPTCHA_NO_LOAD = "The safety check didn't load. Check your connection, refresh the page and try again.";
  let turnstileLoad = null;
  function loadTurnstile() {
    if (!turnstileLoad) {
      turnstileLoad = new Promise((resolve, reject) => {
        window.rzgsTurnstileReady = () => resolve(window.turnstile);
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=rzgsTurnstileReady';
        script.onerror = () => reject(new Error('turnstile did not load'));
        document.head.append(script);
      });
    }
    return turnstileLoad;
  }
  // One box per form. take() gives its answer: undefined when the check is off, null when it is on and not done
  // (the box says so), else the answer. An answer works once, so after every try the box starts again.
  function wireCaptcha(root, action) {
    const holder = root && $('[data-captcha]', root);
    if (!TURNSTILE_SITE_KEY || !holder) return { start() {}, take: async () => undefined, reset() {} };
    const slot = $('[data-captcha-box]', holder);
    const note = $('[data-captcha-error]', holder);
    let widget = null; // null: not started, '': loading, else the widget id
    let token = '';
    let broken = false;
    let waiting = [];
    const settle = () => { waiting.forEach((done) => done()); waiting = []; };
    const say = (text) => {
      if (text) {
        note.textContent = text;
        motion.reveal(note);
      } else if (!note.hidden) {
        motion.conceal(note);
      }
    };
    // Cloudflare's box is never narrower than 300 px. On a narrow phone it is drawn a little smaller to fit the form,
    // instead of its tall square (the owner, 2026-11-02).
    const fit = () => {
      const room = holder.clientWidth;
      slot.style.zoom = room && room < 300 ? (room / 300).toFixed(3) : '';
    };
    const start = () => {
      if (widget !== null) return;
      widget = '';
      holder.hidden = false;
      fit();
      window.addEventListener('resize', fit);
      loadTurnstile().then((turnstile) => {
        widget = turnstile.render(slot, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'dark',
          size: 'flexible',
          appearance: holder.hasAttribute('data-captcha-quiet') ? 'interaction-only' : 'always',
          callback: (answer) => { token = answer; broken = false; say(''); settle(); },
          'expired-callback': () => { token = ''; },
          'error-callback': () => { token = ''; broken = true; settle(); },
          // a quiet box takes room only while Cloudflare asks for a tick
          'before-interactive-callback': () => holder.classList.add('is-asking'),
          'after-interactive-callback': () => holder.classList.remove('is-asking'),
        });
      }).catch(() => { broken = true; settle(); say(CAPTCHA_NO_LOAD); });
    };
    return {
      start,
      async take() {
        start();
        if (!token && !broken) await new Promise((done) => { waiting.push(done); setTimeout(done, CAPTCHA_WAIT); });
        if (token) return token;
        say(broken && !window.turnstile ? CAPTCHA_NO_LOAD : CAPTCHA_NOT_DONE);
        motion.shake(holder);
        return null;
      },
      reset() {
        token = '';
        if (widget && window.turnstile) window.turnstile.reset(widget);
      },
    };
  }

  /* ---------------------------------------------------------------- Gmail and Telegram */
  // A button shows only if its login is switched on at Supabase, so a client never meets one that fails. Supabase answers
  // a switched-on login by sending the browser on to Google or Telegram, and a switched-off one with an error.
  async function loginIsOn(provider) {
    try {
      const probe = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
      probe.searchParams.set('provider', provider);
      probe.searchParams.set('redirect_to', pageUrl('dashboard.html'));
      const answer = await fetch(probe, { redirect: 'manual' });
      return answer.type === 'opaqueredirect' || (answer.status >= 300 && answer.status < 400);
    } catch (e) {
      return false;
    }
  }
  async function wireSocial() {
    const box = $('[data-social]');
    if (!box) return;
    const buttons = $$('[data-social-go]', box);
    const on = await Promise.all(buttons.map((button) => loginIsOn(button.dataset.socialGo)));
    buttons.forEach((button, i) => { button.hidden = !on[i]; });
    box.hidden = !on.some(Boolean);
    box.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-social-go]');
      if (!button) return;
      clearMessage();
      button.disabled = true;
      button.classList.add('is-busy');
      markJustIn();
      const { error } = await db.auth.signInWithOAuth({ provider: button.dataset.socialGo, options: { redirectTo: pageUrl('dashboard.html') } });
      if (error) {
        button.disabled = false;
        button.classList.remove('is-busy');
        showMessage("We couldn't open that login just now. Please try again, or use your email and password.");
      }
    });
  }

  /* ---------------------------------------------------------------- login page */
  async function initLogin() {
    const form = $('[data-login-form]');
    const submit = $('[data-submit]', form);
    const resendButton = $('[data-resend]');

    if (urlQuery.get('signedout')) showMessage("You've logged out.", 'success');
    else if (urlQuery.get('confirm') === 'other') showMessage(FIRST_OF_TWO, 'success');
    else if (urlError) showMessage('That link is no longer valid. Please log in, or request a new link.');

    const { data: { session } } = await db.auth.getSession();
    if (session) {
      location.replace(afterSignIn());
      return;
    }

    wireSocial();
    wireValidation(form);
    const captcha = wireCaptcha(form, 'login');
    captcha.start();
    // Signed up but never typed the code: the code step of the sign-up page takes over, for this email.
    resendButton.addEventListener('click', () => {
      try { sessionStorage.setItem(VERIFY_KEY, form.elements.email.value.trim()); } catch (e) { /* they sign up again */ }
      location.href = 'signup';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      resendButton.hidden = true;
      if (!validateAll(form)) return;

      setBusy(submit, true);
      const captchaToken = await captcha.take();
      if (captchaToken === null) {
        setBusy(submit, false);
        return;
      }
      const { error } = await db.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        options: { captchaToken },
      });
      captcha.reset();
      if (error) {
        setBusy(submit, false);
        showMessage(friendlyError(error));
        if (error.code === 'invalid_credentials') {
          const password = form.elements.password;
          password.setAttribute('aria-invalid', 'true');
          shakeField(password);
          password.focus();
        }
        if (error.code === 'email_not_confirmed') resendButton.hidden = false;
        return;
      }
      markJustIn();
      location.replace(afterSignIn());
    });
  }

  /* -------------------------------------------------------------- sign-up page */
  const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

  // Replace the short built-in list with every country, named by the browser itself.
  function fillCountries(select) {
    if (!(window.Intl && Intl.DisplayNames)) return;
    try {
      const names = new Intl.DisplayNames(['en'], { type: 'region' });
      const countries = COUNTRY_CODES.split(' ')
        .map((code) => ({ code, name: names.of(code) }))
        .filter((c) => c.name && c.name !== c.code)
        .sort((a, b) => a.name.localeCompare(b.name));
      const region = (navigator.language || '').split('-')[1];
      const mine = countries.find((c) => c.code === (region || '').toUpperCase());

      select.replaceChildren(new Option('Choose your country', ''));
      countries.forEach((c) => select.add(new Option(c.name, c.name)));
      if (mine) select.value = mine.name;
    } catch (e) { /* keep the short list */ }
  }

  // Name and username start as the part of the email before the @; the dashboard changes them, and adds Telegram or a phone.
  function nameFromEmail(email) {
    const local = email.split('@')[0];
    let username = local.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    if (username.length < 3) username = `${username || 'member'}_rzgs`.slice(0, 24);
    return { full_name: local.slice(0, 100), username };
  }

  async function initSignup() {
    const form = $('[data-signup-form]');
    const wrap = $('[data-signup-wrap]');
    const verify = $('[data-signup-verify]');
    const codeForm = $('[data-verify-form]', verify);
    const password = form.elements.create_password;
    const DRAFT_KEY = 'rz_signup_draft';
    const DRAFT_FIELDS = ['email', 'country'];
    let email = '';

    const { data: { session } } = await db.auth.getSession();
    if (session) {
      location.replace(afterSignIn());
      return;
    }

    fillCountries(form.elements.country);
    wireSocial();

    // Keep what was typed (never the password) if the page is refreshed by accident.
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
      DRAFT_FIELDS.forEach((name) => { if (draft[name]) form.elements[name].value = draft[name]; });
    } catch (e) { /* no draft */ }
    form.addEventListener('input', () => {
      try {
        const draft = {};
        DRAFT_FIELDS.forEach((name) => { draft[name] = form.elements[name].value; });
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (e) { /* storage unavailable */ }
    });

    wireValidation(form);
    wireValidation(codeForm);
    const captcha = wireCaptcha(form, 'signup');
    const codeCaptcha = wireCaptcha(verify, 'resend');

    // The rules under the password light up one by one while it is typed.
    const paintRules = () => $$('[data-rule]', form).forEach((rule) => rule.classList.toggle('is-met', PASSWORD_RULES[rule.dataset.rule](password.value)));
    password.addEventListener('input', paintRules);

    const resend = wireResend($('[data-resend]', verify), async () => {
      const captchaToken = await codeCaptcha.take();
      if (captchaToken === null) return null;
      const answer = await db.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: pageUrl('dashboard.html'), captchaToken },
      });
      codeCaptcha.reset();
      return answer;
    });

    function showCode(address, justSent) {
      email = address;
      try { sessionStorage.setItem(VERIFY_KEY, address); } catch (e) { /* a refresh starts again */ }
      $('[data-verify-email]', verify).textContent = address;
      wrap.hidden = true;
      verify.hidden = false;
      codeCaptcha.start();
      $('h2', verify).focus();
      if (justSent) resend.cooldown();
    }

    $('[data-restart]', verify).addEventListener('click', () => {
      try { sessionStorage.removeItem(VERIFY_KEY); } catch (e) { /* ignore */ }
      clearMessage();
      verify.hidden = true;
      wrap.hidden = false;
      captcha.start();
      form.elements.email.focus();
    });

    // Back on this page before the code was typed, or sent here by the login page.
    let waiting = null;
    try { waiting = sessionStorage.getItem(VERIFY_KEY); } catch (e) { /* none */ }
    if (waiting && EMAIL_RE.test(waiting)) showCode(waiting, false);
    else captcha.start();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      if (!validateAll(form)) return;

      const submit = $('[data-submit]', form);
      const address = form.elements.email.value.trim();
      setBusy(submit, true);
      const captchaToken = await captcha.take();
      if (captchaToken === null) {
        setBusy(submit, false);
        return;
      }
      const { data, error } = await db.auth.signUp({
        email: address,
        password: password.value,
        options: {
          emailRedirectTo: pageUrl('dashboard.html'),
          // copied into the web_users table by the database
          data: { ...nameFromEmail(address), country: form.elements.country.value, accepted_terms: true },
          captchaToken,
        },
      });
      captcha.reset();
      setBusy(submit, false);

      // Supabase answers "ok" with an empty identities list when the email is already registered.
      const alreadyRegistered = !error && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
      if (alreadyRegistered || (error && (error.code === 'user_already_exists' || error.code === 'email_exists'))) {
        setFieldError(form.elements.email, 'This email already has an account. Log in instead.');
        shakeField(form.elements.email);
        form.elements.email.focus();
        return;
      }
      if (error) {
        showMessage(friendlyError(error));
        return;
      }

      try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      password.value = '';
      paintRules();

      if (data.session) {
        // email confirmation is switched off in Supabase: the person is already signed in
        markJustIn();
        location.replace(afterSignIn());
        return;
      }
      showCode(address, true);
    });

    codeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const input = codeForm.elements.code;
      if (!validateField(input)) {
        shakeField(input);
        input.focus();
        return;
      }
      const button = $('[data-verify]', codeForm);
      setBusy(button, true);
      const { data, error } = await db.auth.verifyOtp({ email, token: input.value.replace(/\s/g, ''), type: 'signup' });
      if (error || !data.session) {
        setBusy(button, false);
        const wrong = !error || error.code === 'otp_expired' || /expired|invalid/i.test(error.message || '');
        setFieldError(input, wrong ? 'That code is wrong or has run out. Check the newest email, or send a new code.' : friendlyError(error));
        shakeField(input);
        input.focus();
        input.select();
        return;
      }
      try { sessionStorage.removeItem(VERIFY_KEY); } catch (e) { /* ignore */ }
      showMessage('Your email is confirmed. Welcome to RZGS-PRO!', 'success');
      markJustIn();
      setTimeout(() => location.replace(afterSignIn()), 700);
    });
  }

  /* ------------------------------------------------------- password reset page */
  async function initReset() {
    const request = $('[data-reset-request]');
    const update = $('[data-reset-update]');
    const requestForm = $('form', request);
    const updateForm = $('form', update);

    const showUpdate = () => {
      request.hidden = true;
      update.hidden = false;
    };
    // supabase-js announces this when someone arrives from a reset email
    db.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') showUpdate(); });

    const { data: { session } } = await db.auth.getSession();
    if (arrivedFrom === 'recovery' && session) showUpdate();
    else if (urlError) showMessage('This reset link has expired or was already used. Enter your email to get a new one.');

    wireValidation(requestForm);
    wireValidation(updateForm);
    const captcha = wireCaptcha(requestForm, 'reset');
    if (!request.hidden) captcha.start();

    requestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      if (!validateAll(requestForm)) return;

      const submit = $('[data-submit]', requestForm);
      const email = requestForm.elements.email.value.trim();
      setBusy(submit, true);
      const captchaToken = await captcha.take();
      if (captchaToken === null) {
        setBusy(submit, false);
        return;
      }
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset-password.html'), captchaToken });
      captcha.reset();
      setBusy(submit, false);
      if (error) {
        showMessage(friendlyError(error));
        return;
      }
      // Same answer whether or not the account exists, so nobody can test which emails are registered.
      showMessage(`If ${email} has an account, a reset link is on its way. Check your inbox and your spam folder.`, 'success');
      requestForm.reset();
    });

    updateForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      if (!validateAll(updateForm)) return;

      const submit = $('[data-submit]', updateForm);
      setBusy(submit, true);
      const { error } = await db.auth.updateUser({ password: updateForm.elements.new_password.value });
      if (error) {
        setBusy(submit, false);
        showMessage(friendlyError(error));
        return;
      }
      showMessage('Your password is updated. Taking you to your account.', 'success');
      setTimeout(() => location.replace('dashboard'), 1200);
    });
  }

  /* ------------------------------------------------------------ dashboard page */
  const PLAN_NAMES = { trial: 'Free trial', elite: 'Elite', diamond: 'Diamond' };
  const PLAN_DAYS = { trial: 7, elite: 30, diamond: 30 }; // length of one period, used to fill the ring
  const longDate = (value) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const shortDateTime = (value) => new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Small "Saved." / error line next to a form's own button.
  function formMessage(form, text, tone) {
    const line = $('[data-form-msg]', form);
    clearTimeout(line.hideTimer);
    line.textContent = text;
    line.dataset.tone = tone;
    motion.reveal(line);
    if (tone === 'success') line.hideTimer = setTimeout(() => motion.conceal(line), 4000);
  }

  // A row of tabs showing one panel at a time. Arrow keys move between tabs, Home/End jump.
  function setupTabs(tabs, onSelect) {
    const select = (tab, moveFocus = false) => {
      tabs.forEach((other) => {
        const on = other === tab;
        other.setAttribute('aria-selected', String(on));
        other.tabIndex = on ? 0 : -1;
        document.getElementById(other.getAttribute('aria-controls')).hidden = !on;
      });
      if (moveFocus) tab.focus();
      if (onSelect) onSelect(tab);
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        let next = null;
        if (step) next = tabs[(index + step + tabs.length) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs[tabs.length - 1];
        if (!next) return;
        event.preventDefault();
        select(next, true);
      });
    });
    return select;
  }

  // The plan and its end date are written to the web_users table when a bot is delivered
  // (the site owner can also type them there).
  // This turns them into everything the dashboard shows about the plan.
  function planState(profile) {
    const plan = PLAN_NAMES[profile.plan] ? profile.plan : null;
    if (!plan) {
      return {
        plan: null, name: 'Not started', status: 'No plan', tone: 'off', until: '-', big: '--', sub: 'NO PLAN', arc: 0,
        note: 'Claim your free 7-day trial, or choose a plan. It takes a few minutes, right on this page, and your bot file is here at the end.',
      };
    }
    const ends = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
    const base = { plan, name: PLAN_NAMES[plan], until: ends ? longDate(ends) : 'No end date' };
    if (!ends) return { ...base, status: 'Active', tone: 'good', big: 'ON', sub: 'ACTIVE', arc: 100, note: 'Your plan is active.' };

    const daysLeft = Math.ceil((ends - Date.now()) / 86400000);
    const what = plan === 'trial' ? 'free trial' : 'plan';
    const todo = plan === 'trial' ? 'Choose a plan' : 'Renew';
    if (daysLeft <= 0) {
      return { ...base, status: 'Expired', tone: 'bad', big: '0', sub: 'DAYS LEFT', arc: 0, note: `Your ${what} ended on ${longDate(ends)}. ${todo} to keep the bot running.` };
    }
    const soon = daysLeft <= 3;
    return {
      ...base,
      status: soon ? 'Ends soon' : 'Active',
      tone: soon ? 'warn' : 'good',
      big: String(daysLeft),
      sub: daysLeft === 1 ? 'DAY LEFT' : 'DAYS LEFT',
      arc: Math.max(4, Math.min(100, (daysLeft / PLAN_DAYS[plan]) * 100)),
      note: soon
        ? `Your ${what} ends on ${longDate(ends)}. ${plan === 'trial' ? 'Choose a plan now to avoid a break.' : 'You can renew it once it has ended.'}`
        : `Your ${what} is valid until ${longDate(ends)}.`,
    };
  }

  async function initDashboard() {
    const root = $('[data-dash]');
    // an older link to Settings opens Manage account, when the page opens or later in the address
    const toManage = () => {
      const part = { '#tools': '', '#settings': '', '#security': '', '#support': '#help', '#legal': '#help' }[location.hash];
      if (part !== undefined) location.replace(`manage-account${part}`);
      return part !== undefined;
    };
    if (toManage()) return;
    // When someone arrives from the confirmation email, supabase-js signs them in here.
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      location.replace('login' + (urlError ? '?error=link' : firstOfTwo ? '?confirm=other' : ''));
      return;
    }
    // Gmail or Telegram has no box to tick: the words beside the button said that continuing accepts the terms.
    if (session.user.app_metadata.provider !== 'email' && !session.user.user_metadata.accepted_terms) db.auth.updateUser({ data: { accepted_terms: true } });
    const wanted = afterSignIn();
    if (wanted !== 'dashboard') {
      if (arrivedFrom === 'signup') markJustIn();
      location.replace(wanted);
      return;
    }
    if (arrivedFrom === 'signup') showMessage('Your email is confirmed. Welcome to RZGS-PRO!', 'success');
    else if (arrivedFrom === 'email_change') showMessage('Your email address is changed. Log in with the new one from now on.', 'success');
    else if (firstOfTwo) showMessage(FIRST_OF_TWO, 'success');
    else if (urlError) showMessage('That link has expired or was already used. If you were changing your email, send the request again in Manage account.');

    let user = session.user;
    // A change of email that was waiting may have been finished on another device since this one last looked.
    if (user.new_email) {
      const { data } = await db.auth.getUser();
      if (data && data.user) user = data.user;
    }
    // Our own copy of the profile (plus the plan), kept in the web_users table.
    // The bot_* columns are written when a bot is delivered.
    const PROFILE_COLUMNS = 'full_name, username, avatar_url, email, country, phone, telegram_username, mt5_account, broker, plan, plan_expires_at, created_at, email_confirmed_at, last_sign_in_at, accepted_terms_at, bot_mt5_account, bot_broker';
    async function fetchProfile() {
      try {
        const { data } = await db.from('web_users').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
        return data || null;
      } catch (e) {
        return null;
      }
    }
    const profile = (await fetchProfile()) || {}; // without it: what the sign-up itself stored

    const stored = (key) => profile[key] || (user.user_metadata || {})[key] || '';
    const setAll = (selector, text) => $$(selector, root).forEach((el) => { el.textContent = text; });

    /* ----- menu: one view at a time, remembered in the address (#plan, #awards ...) ----- */
    // In the menu on the left since 2 Nov 2026 (a drawer on a phone); Settings became the Manage account page.
    const closeMenu = wireAccountMenu(root);
    const tabs = $$('[data-dash-tabs] [role="tab"]', root);
    const tabFor = (name) => tabs.find((tab) => tab.dataset.tab === name);
    let settled = false;
    const selectTab = setupTabs(tabs, (tab) => {
      root.dataset.view = tab.dataset.tab;
      closeMenu();
      if (!settled) return;
      history.replaceState(null, '', `#${tab.dataset.tab}`);
      window.scrollTo({ top: 0, behavior: 'instant' }); // every view starts at its top, like a new screen
    });
    selectTab(tabFor(location.hash.slice(1)) || tabs[0]);
    settled = true;
    // the X: back to the page they came from on this site, or else the home page. They stay logged in.
    try {
      const from = new URL(document.referrer);
      if (from.origin === location.origin && !/(login|signup|reset-password|dashboard|account)(\.html)?$/.test(from.pathname)) {
        $('[data-dash-close]').href = from.href;
      }
    } catch (e) { /* came from elsewhere: the home page */ }
    // the profile button and the links in its box, on this page: the right view with no reload, from its top, even when
    // that view is already on screen
    document.addEventListener('click', (event) => {
      const link = event.target.closest('.header-actions [data-profile], .pm-links a[href*="dashboard#"]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      selectTab(tabFor(new URL(link.href).hash.slice(1)) || tabs[0]);
    });
    // links inside the page, like "See plans", switch tab through the address
    window.addEventListener('hashchange', () => {
      if (toManage()) return;
      const tab = tabFor(location.hash.slice(1));
      if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab);
    });

    /* ----- the checkout: what was bought on this website (checkout.js and the "checkout" server function) ----- */
    let checkout = { order: null, licence: null, trial_used: false };
    let seenCheckout = '';
    const withCheckout = async (use) => {
      if (window.rzgsPlans) use(await window.rzgsPlans.checkout());
    };
    async function refreshCheckout() {
      if (document.hidden) return;
      try {
        const { data } = await db.rpc('web_my_checkout');
        if (!data || !data.ok || JSON.stringify(data) === seenCheckout) return;
        seenCheckout = JSON.stringify(data);
        checkout = data;
        renderOrder();
        renderPlan();
        renderBot();
        const place = $('[data-licence]', root);
        place.hidden = !checkout.licence;
        if (checkout.licence) withCheckout((checkoutBox) => checkoutBox.renderLicence(place, checkout.licence));
      } catch (e) { /* the last state stays */ }
    }

    /* ----- profile picture ----- */
    // The picture is a small file in the "avatars" storage bucket, in a folder named after the person's own id.
    // Its address is kept in the profile (avatar_url). Only a picture from that folder is ever shown.
    const AVATAR_BUCKET = 'avatars';
    const avatarFolder = `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${user.id}/`;
    const avatarEdit = $('[data-avatar-edit]', root);
    const avatarFile = $('[data-avatar-file]', avatarEdit);
    const avatarPick = $('[data-avatar-pick]', avatarEdit);
    const avatarRemove = $('[data-avatar-remove]', avatarEdit);
    const avatarAddress = () => {
      const url = stored('avatar_url');
      return url.startsWith(avatarFolder) ? url : '';
    };

    // the photo, or the first letter of the name: on the profile card and in the Edit profile box
    function renderAvatar(name) {
      const letter = name.trim().charAt(0).toUpperCase() || 'R';
      const url = avatarAddress();
      $$('[data-dash-avatar], [data-avatar-preview]', root).forEach((box) => {
        if (!url) { box.textContent = letter; return; }
        const img = new Image();
        img.alt = '';
        img.onerror = () => { box.textContent = letter; }; // the file is gone: back to the letter
        img.src = url;
        box.replaceChildren(img);
      });
      avatarRemove.hidden = !url;
    }

    // Cut the photo to a centred square of 320 px, so only a light JPEG is sent (a phone photo is several MB).
    async function squarePhoto(file) {
      let source;
      try {
        source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        source = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
      }
      const width = source.naturalWidth || source.width;
      const height = source.naturalHeight || source.height;
      const side = Math.min(width, height);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      canvas.getContext('2d').drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 320, 320);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    }

    function avatarBusy(busy) {
      setBusy(avatarPick, busy);
      avatarRemove.disabled = busy;
    }

    // keep one file in the person's folder (or none): older pictures are deleted
    async function tidyAvatars(keep) {
      try {
        const { data } = await db.storage.from(AVATAR_BUCKET).list(user.id);
        const old = (data || []).map((file) => `${user.id}/${file.name}`).filter((path) => path !== keep);
        if (old.length) await db.storage.from(AVATAR_BUCKET).remove(old);
      } catch (e) { /* a leftover file does no harm */ }
    }

    async function saveAvatar(url) {
      const { data, error } = await db.auth.updateUser({ data: { avatar_url: url } });
      if (error) return error;
      if (data && data.user) user = data.user;
      profile.avatar_url = url;
      renderHeader();
      if (window.rzgsPlans) window.rzgsPlans.repaint({ avatar_url: url });
      return null;
    }

    avatarPick.addEventListener('click', () => avatarFile.click());
    avatarFile.addEventListener('change', async () => {
      const file = avatarFile.files[0];
      avatarFile.value = ''; // the same photo can be picked again later
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        formMessage(avatarEdit, 'Choose a JPG, PNG or WebP picture.', 'error');
        return;
      }
      avatarBusy(true);
      let photo = null;
      try { photo = await squarePhoto(file); } catch (e) { /* not a picture the browser can read */ }
      if (!photo) {
        avatarBusy(false);
        formMessage(avatarEdit, "We couldn't read this picture. Try another one.", 'error');
        return;
      }
      // a new file name every time, so no browser keeps showing the old picture
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await db.storage.from(AVATAR_BUCKET)
        .upload(path, photo, { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (uploadError) {
        avatarBusy(false);
        formMessage(avatarEdit, navigator.onLine ? "We couldn't save the picture. Please try again." : "You're offline. Check your connection and try again.", 'error');
        return;
      }
      const error = await saveAvatar(avatarFolder + path.split('/')[1]);
      avatarBusy(false);
      if (error) {
        formMessage(avatarEdit, friendlyError(error), 'error');
        return;
      }
      formMessage(avatarEdit, 'Profile picture saved.', 'success');
      tidyAvatars(path);
    });
    avatarRemove.addEventListener('click', async () => {
      avatarBusy(true);
      const error = await saveAvatar('');
      avatarBusy(false);
      if (error) {
        formMessage(avatarEdit, friendlyError(error), 'error');
        return;
      }
      formMessage(avatarEdit, 'Profile picture removed.', 'success');
      tidyAvatars('');
    });

    /* ----- header + core ----- */
    function renderHeader() {
      const name = stored('full_name') || stored('username') || 'RZGS-PRO member';
      $('[data-dash-name]').textContent = name.trim();
      renderAvatar(name);
      const handle = stored('username');
      const email = profile.email || user.email || '';
      setAll('[data-dash-email]', email); // Tools and the sign-out box
      setAll('[data-dash-handle]', handle ? `@${handle}` : email);

      const about = stored('about');
      const aboutBox = $('[data-dp-about]', root);
      aboutBox.textContent = about || 'Tell about yourself';
      aboutBox.classList.toggle('is-empty', !about);
      setAll('[data-dp-location]', stored('country') || 'Add your location');
      const joined = profile.created_at || user.created_at;
      setAll('[data-dp-since]', joined ? `Member since ${new Date(joined).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}` : 'Member');

      const socials = stored('socials') || {};
      const links = Object.keys(SOCIALS).filter((kind) => socials[kind]).map((kind) => [SOCIALS[kind].name, socialUrl(kind, socials[kind])]);
      const telegram = stored('telegram_username');
      if (/^\w{1,32}$/.test(telegram)) links.unshift(['Telegram', `https://t.me/${telegram}`]);
      $('[data-dp-socials]', root).replaceChildren(...links.filter(([, url]) => url).map(([label, url]) => {
        const link = document.createElement('a');
        link.className = 'dp-social';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener nofollow';
        link.textContent = label;
        return link;
      }));
      renderBot();
    }

    /* ----- my bot: today's numbers from the client's own bot, and what to do next ----- */
    let bot = { bot: false };
    function renderBot() {
      const plan = PLAN_NAMES[profile.plan] ? profile.plan : null;
      const ends = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
      const ended = Boolean(ends) && ends < new Date();
      const badge = $('[data-dp-plan]', root);
      badge.textContent = plan ? `${PLAN_NAMES[plan]}${ended ? ' ended' : ''}` : 'No plan';
      badge.dataset.tone = !plan || ended ? 'off' : plan;
      setAll('[data-dp-plans]', plan ? 'See plans' : 'Get your bot');
      setAll('[data-stat="days"]', ends && !ended ? Math.ceil((ends - new Date()) / 86400000) : 0);
      // until the server has answered, nothing is said about the bot: a "0" or "not reporting" could be untrue
      const known = bot.ok === true;
      setAll('[data-stat="tp"]', known ? bot.tp_today || 0 : '-');
      setAll('[data-stat="baskets"]', known ? bot.baskets_today || 0 : '-');
      setAll('[data-stat="cycles"]', known ? bot.cycles_today || 0 : '-');

      const words = bot.bot
        ? bot.online
          ? ['good', 'Online', `Your bot is reporting${profile.bot_mt5_account ? ` from MT5 account ${profile.bot_mt5_account}` : ''}. Open the control app to watch it.`]
          : ['bad', 'Offline', `Last report: ${bot.seen_at ? shortDateTime(bot.seen_at) : 'not known'}. The bot only runs while MT5 is open and online.`]
        : !plan
          ? ['off', 'No bot yet', 'Ready to run your bot? Choose a plan and get your bot file right here.']
          : known
            ? ['warn', 'Waiting for your bot', 'Your bot has not reported yet. Add the file to MT5, type your passwords and turn on Algo Trading.']
            : ['off', 'Your bot', 'Open the control app to see your bot.'];
      $('[data-bot-pill]', root).dataset.tone = words[0];
      setAll('[data-bot-status]', words[1]);
      setAll('[data-bot-note]', words[2]);
      $('[data-bot-see]', root).hidden = Boolean(plan);
      // the setup steps are with the passwords when those are here
      $('[data-bot-howto]', root).hidden = !plan || !known || bot.bot || Boolean(checkout.licence);
      $('[data-bot-row]', root).hidden = bot.bot || (Boolean(plan) && (!known || Boolean(checkout.licence)));
      renderAwards();
    }

    /* ----- achievements: only what really happened, never anything about profit ----- */
    function renderAwards() {
      const plan = PLAN_NAMES[profile.plan] ? profile.plan : null;
      const list = [
        { title: 'Account created', did: 'You joined RZGS-PRO.', done: true },
        { title: 'Email confirmed', text: 'Open the link we sent to your email.', did: 'Your email address is confirmed.', done: Boolean(profile.email_confirmed_at || user.email_confirmed_at) },
        { title: 'Profile complete', text: 'Add a photo, a few words about you and your location.', did: 'Your photo, your words and your location are in.', done: Boolean(avatarAddress() && stored('about') && stored('country')), edit: 'about', action: 'Edit profile' },
        { title: 'First bot delivered', text: 'Choose a plan and get your bot file.', did: 'You have your bot file.', done: Boolean(plan), plans: true, action: 'See plans' },
        { title: 'Bot connected', text: 'Add the file to MT5, and your bot reports to your control app.', did: 'Your bot reports to your control app.', done: Boolean(bot.bot) },
        { title: 'First closed trade', text: 'Reached when your bot closes a trade.', did: 'Your bot has closed a trade.', done: Boolean(bot.traded) },
        { title: 'Elite or Diamond', text: 'Move up to a paid plan.', did: 'You are on a paid plan.', done: plan === 'elite' || plan === 'diamond', plans: true, action: 'See plans' },
      ];
      const count = `${list.filter((award) => award.done).length} of ${list.length}`;
      setAll('[data-dp-awards]', count);
      setAll('[data-awards-count]', count);
      $('[data-awards]', root).replaceChildren(...list.map((award) => {
        const row = document.createElement('li');
        row.className = award.done ? 'is-done' : '';
        const mark = document.createElement('span');
        mark.className = 'dp-award-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = award.done ? '\u2713' : '';
        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = award.title;
        const line = document.createElement('span');
        line.textContent = award.done ? award.did : award.text;
        text.append(title, line);
        row.append(mark, text);
        if (!award.done && award.action) {
          const go = document.createElement(award.edit ? 'button' : 'a');
          go.className = 'btn btn-chip btn-sm';
          go.textContent = award.action;
          if (award.edit) { go.type = 'button'; go.dataset.edit = award.edit; }
          if (award.plans) { go.href = './#plans'; go.dataset.plans = ''; }
          row.append(go);
        }
        return row;
      }));
    }

    async function refreshBot() {
      if (document.hidden) return;
      try {
        const { data } = await db.rpc('web_my_bot');
        if (data && data.ok) { bot = data; renderBot(); }
      } catch (e) { /* the last numbers stay */ }
    }

    function renderInfo() {
      const joined = profile.created_at || user.created_at;
      const confirmed = profile.email_confirmed_at || user.email_confirmed_at;
      setAll('[data-info="joined"]', joined ? longDate(joined) : '-');
      setAll('[data-info="email-status"]', confirmed ? 'Confirmed' : 'Not confirmed');
      // the account the bot was made for comes before the one typed in the profile
      setAll('[data-info="mt5"]', profile.bot_mt5_account || stored('mt5_account') || 'Not set');
      setAll('[data-info="broker"]', profile.bot_broker || stored('broker') || 'Not set');
    }

    function renderPlan() {
      const state = planState(profile);
      setAll('[data-plan-name]', state.name);
      setAll('[data-plan-status]', state.status);
      setAll('[data-plan-until]', state.until);
      setAll('[data-plan-note]', state.note);
      $('[data-plan-pill]', root).dataset.tone = state.tone;

      const ring = $('[data-ring]', root);
      ring.dataset.tone = state.tone;
      ring.setAttribute('aria-label', state.plan ? `${state.name}: ${state.big} ${state.sub.toLowerCase()}` : 'No plan yet');
      $('[data-ring-arc]', ring).setAttribute('stroke-dasharray', `${state.arc} 100`);
      $('[data-ring-big]', ring).textContent = state.big;
      $('[data-ring-sub]', ring).textContent = state.sub;

      // One solid button per screen: the control app while the plan is healthy, otherwise the plan step.
      const action = $('[data-plan-action]', root);
      const healthy = state.tone === 'good';
      [[action, !healthy], [$('[data-open-app]', root), healthy]].forEach(([button, main]) => {
        button.classList.toggle('btn-primary', main);
        button.classList.toggle('btn-ghost', !main);
      });
      action.href = '#plan';
      delete action.dataset.checkout;
      if (!state.plan) {
        action.textContent = 'Claim your free trial';
        action.dataset.checkout = 'trial';
      } else if (state.plan === 'trial') {
        action.textContent = 'Choose a plan';
      } else if (state.status === 'Expired') {
        action.textContent = 'Renew plan';
        action.dataset.checkout = state.plan;
      } else {
        action.textContent = 'See plans'; // a plan that is running can't be renewed yet
      }
      $('[data-plan-also]', root).hidden = Boolean(state.plan) && state.plan !== 'trial' && state.status !== 'Expired';
      // on the Plan view, the current plan's button is shown "on"
      // a paid plan that is running: nothing else starts until it ends or is cancelled
      const paidRunning = Boolean(state.plan) && state.plan !== 'trial' && state.status !== 'Expired';
      // moving up from Elite to Diamond is the one change that can start now: it asks to cancel first (plans.js)
      const canMoveUp = paidRunning && state.plan === 'elite';
      setAll('[data-plan-choice-note]', paidRunning
        ? `Your ${state.name} plan runs until ${state.until}. You can renew it or start another plan when it ends.${canMoveUp ? ' To move up now, choose Diamond.' : ''}`
        : 'Trial and Elite start right here. Diamond opens a chat with our sales team on Telegram.');
      $$('[data-plan-link]', root).forEach((button) => {
        const on = button.dataset.planLink === state.plan;
        const freeUsed = button.dataset.planLink === 'trial' && checkout.trial_used;
        const moveUp = canMoveUp && button.dataset.planLink === 'diamond';
        const locked = !moveUp && (paidRunning || freeUsed || (on && (state.plan === 'trial' || state.status !== 'Expired'))); // the free days only once
        button.disabled = locked;
        button.classList.toggle('is-locked', locked && !on);
        button.classList.toggle('is-on', on);
        if (on) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
    }

    /* ----- order: the buying steps of an order that is under way ----- */
    const ORDER_STEPS = { trial: ['broker', 'mt5', 'bot'], elite: ['broker', 'mt5', 'pay', 'bot'], diamond: ['mt5', 'pay', 'bot'] };
    const ORDER_LABEL = { broker: 'Broker account', mt5: 'MT5 account', pay: 'Payment', bot: 'Bot delivered' };
    const ORDER_NOTE = {
      broker: 'Tell us your broker and the email you used there.',
      mt5: 'Tell us your MT5 account number.',
      pay: 'Pay with your KHQR code.',
    };
    function renderOrder() {
      const box = $('[data-order]', root);
      const { order } = checkout;
      if (!order || !ORDER_STEPS[order.plan]) {
        box.hidden = true;
        return;
      }
      const waiting = order.stage === 'review'; // our team is checking: nothing for the person to do
      const at = waiting ? order.review_from : order.stage;
      const steps = ORDER_STEPS[order.plan];
      const now = steps.indexOf(at);
      $('[data-order-steps]', box).replaceChildren(...steps.map((key, index) => {
        const item = document.createElement('li');
        const state = index < now ? 'done' : index === now ? 'now' : 'todo';
        item.dataset.state = state;
        item.textContent = ORDER_LABEL[key];
        if (state !== 'todo') {
          const tag = document.createElement('small');
          tag.textContent = state === 'done' ? 'Done' : waiting ? 'Checking' : 'Now';
          item.append(tag);
          if (state === 'now') item.setAttribute('aria-current', 'step');
        }
        return item;
      }));
      $('[data-order-plan]', box).textContent = PLAN_NAMES[order.plan];
      $('[data-order-note]', box).textContent = waiting
        ? (at === 'pay' ? 'Our team is confirming your payment. Your bot appears here as soon as it is done.' : 'Our team is checking your broker account. The next step appears here as soon as it is done.')
        : order.note || ORDER_NOTE[at];
      $('[data-order-row]', box).hidden = waiting;
      box.hidden = false;
    }

    /* ----- log: real moments from this account, newest first ----- */
    function renderLog() {
      const state = planState(profile);
      const events = [
        [profile.created_at || user.created_at, 'account', 'Account created'],
        [profile.accepted_terms_at, 'account', 'Terms and conditions accepted'],
        [profile.email_confirmed_at || user.email_confirmed_at, 'account', 'Email address confirmed'],
        [profile.last_sign_in_at || user.last_sign_in_at, 'security', 'Signed in'],
        [state.plan && profile.plan_expires_at, 'plan', state.plan && `${state.name} plan ${new Date(profile.plan_expires_at) > new Date() ? 'ends' : 'ended'}`],
      ].filter(([when]) => when).sort((a, b) => new Date(b[0]) - new Date(a[0]));

      const list = $('[data-log]', root);
      list.replaceChildren(...events.map(([when, kind, text]) => {
        const row = document.createElement('div');
        row.className = 'dash-ev';
        const time = document.createElement('time');
        time.dateTime = new Date(when).toISOString();
        time.textContent = shortDateTime(when);
        const label = document.createElement('p');
        label.textContent = text;
        const tag = document.createElement('span');
        tag.className = 'k';
        tag.dataset.kind = kind;
        tag.textContent = kind;
        row.append(time, label, tag);
        return row;
      }));
      $('[data-log-empty]', root).hidden = events.length > 0;
    }

    const profileForm = $('[data-profile-form]');
    const editBox = $('[data-edit-dialog]', root);
    const country = profileForm.elements.country;
    fillCountries(country);

    // The Edit profile box: it always opens with what is on file, so Cancel simply leaves everything as it was.
    function fillEdit() {
      const savedCountry = stored('country');
      if (savedCountry && ![...country.options].some((option) => option.value === savedCountry)) {
        country.add(new Option(savedCountry, savedCountry));
      }
      country.value = savedCountry;
      ['full_name', 'username', 'phone', 'telegram_username', 'about', 'mt5_account', 'broker'].forEach((name) => {
        profileForm.elements[name].value = stored(name);
      });
      Object.keys(SOCIALS).forEach((kind) => { profileForm.elements[`social_${kind}`].value = (stored('socials') || {})[kind] || ''; });
      $$('input, select', profileForm).forEach((input) => setFieldError(input, ''));
      countAbout();
    }
    const aboutCount = $('[data-about-count]', editBox);
    const countAbout = () => { aboutCount.textContent = `${profileForm.elements.about.value.length} / 160`; };
    profileForm.elements.about.addEventListener('input', countAbout);

    // "Edit profile", "Add your location" and the like: the box, with the cursor in that field
    function openEdit(fieldName) {
      fillEdit();
      motion.fromTap(editBox);
      editBox.showModal();
      const wanted = fieldName && profileForm.elements[fieldName];
      if (wanted) wanted.focus();
    }

    renderHeader();
    renderInfo();
    renderPlan();
    renderOrder();
    renderLog();
    root.setAttribute('aria-busy', 'false');

    refreshCheckout();
    // Right after sign-up (the email was just confirmed) the next step is choosing a plan.
    if (arrivedFrom === 'signup' && window.rzgsPlans) window.rzgsPlans.offer(profile);

    // The checkout writes each step as it happens (broker confirmed, payment received, bot delivered, and what
    // the owner decides). The dashboard looks again every 20 seconds while it is on screen, and at once when the
    // person comes back to this tab, and redraws only when something changed.
    let seen = JSON.stringify(profile);
    let looking = false;
    async function refreshProfile() {
      if (document.hidden || looking) return;
      looking = true;
      const fresh = await fetchProfile();
      looking = false;
      if (!fresh || JSON.stringify(fresh) === seen) return;
      Object.assign(profile, fresh);
      seen = JSON.stringify(fresh);
      if (window.rzgsPlans) window.rzgsPlans.repaint({ plan: fresh.plan, plan_expires_at: fresh.plan_expires_at });
      renderHeader();
      renderInfo();
      renderPlan();
      renderOrder();
      renderLog();
    }
    const refreshAll = () => { refreshProfile(); refreshCheckout(); };
    setInterval(refreshAll, 20000);
    document.addEventListener('visibilitychange', refreshAll);
    document.addEventListener('rzgs:checkout', refreshAll);

    wireValidation(profileForm);
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateAll(profileForm)) return;
      const save = $('[data-edit-save]', editBox);
      const fields = {
        full_name: profileForm.elements.full_name.value.trim(),
        username: profileForm.elements.username.value.trim(),
        country: country.value,
        phone: profileForm.elements.phone.value.trim(),
        telegram_username: profileForm.elements.telegram_username.value.trim().replace(/^@/, ''),
        about: profileForm.elements.about.value.trim().slice(0, 160),
        socials: Object.fromEntries(Object.keys(SOCIALS).map((kind) => [kind, socialUrl(kind, profileForm.elements[`social_${kind}`].value) || ''])),
        mt5_account: profileForm.elements.mt5_account.value.replace(/\D/g, ''),
        broker: profileForm.elements.broker.value.trim(),
      };
      setBusy(save, true);
      const { data, error } = await db.auth.updateUser({ data: fields });
      setBusy(save, false);
      if (error) {
        formMessage($('.de-foot', editBox), friendlyError(error), 'error');
        return;
      }
      if (data && data.user) user = data.user;
      Object.assign(profile, fields);
      renderHeader();
      renderInfo();
      if (window.rzgsPlans) window.rzgsPlans.repaint({ full_name: fields.full_name, username: fields.username });
      editBox.close();
      showMessage('Profile saved.', 'success');
      setTimeout(clearMessage, 4000);
    });
    // Cancel, the X, or a tap on the dark area around the box
    editBox.addEventListener('click', (event) => {
      if (event.target === editBox || event.target.closest('[data-edit-close]')) editBox.close();
    });
    root.addEventListener('click', (event) => {
      const asked = event.target.closest('[data-edit]');
      if (asked) openEdit(asked.dataset.edit);
      if (event.target.closest('[data-order-go]')) withCheckout((checkoutBox) => checkoutBox.resume());
      if (event.target.closest('[data-order-drop]')) withCheckout((checkoutBox) => checkoutBox.drop());
    });
    // an older link to the Profile tab
    const editFromAddress = () => {
      if (location.hash !== '#profile') return;
      history.replaceState(null, '', location.pathname + location.search);
      openEdit();
    };
    editFromAddress();
    window.addEventListener('hashchange', editFromAddress);
    refreshBot();
    setInterval(refreshBot, 60000);
    document.addEventListener('visibilitychange', refreshBot);

    wireSignOut();

    // signed out in another tab
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('./');
    });
  }

  /* ----------------------------------------------------- the menu of the account pages */
  // The owner's sketch (2 Nov 2026): a column on the left of a computer screen that folds to its icons (remembered), a
  // drawer on a phone opened by the button left of the logo. The profile button at its bottom opens the account card
  // (plans.js). Gives back a function that closes the drawer.
  function wireAccountMenu(root) {
    const side = $('[data-acc-side]', root);
    const shade = $('[data-acc-shade]', root);
    const opener = $('[data-acc-open]');
    const accountCard = $('[data-acc-card]', root);
    const phone = window.matchMedia('(max-width: 1023.98px)');
    function setDrawer(open) {
      const yes = open && phone.matches;
      side.classList.toggle('is-open', yes);
      shade.hidden = !yes;
      if (opener) opener.setAttribute('aria-expanded', String(yes));
      document.documentElement.classList.toggle('acc-locked', yes);
    }
    if (opener) {
      opener.addEventListener('click', () => {
        setDrawer(true);
        ($('[aria-current="page"], [aria-selected="true"]', side) || $('a', side)).focus();
      });
    }
    shade.addEventListener('click', () => setDrawer(false));
    phone.addEventListener('change', () => setDrawer(false));
    // Escape closes the account card first (plans.js), then the drawer
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && side.classList.contains('is-open') && accountCard.hidden) {
        setDrawer(false);
        if (opener) opener.focus();
      }
    });
    const FOLD_KEY = 'rzgs_acc_folded';
    const fold = $('[data-acc-fold]', side);
    const setFold = (yes) => {
      root.classList.toggle('is-folded', yes);
      const words = yes ? 'Open the menu' : 'Fold the menu';
      fold.setAttribute('aria-label', words);
      fold.title = words;
    };
    try { setFold(localStorage.getItem(FOLD_KEY) === '1'); } catch (e) { /* open */ }
    fold.addEventListener('click', () => {
      if (phone.matches) { setDrawer(false); return; }
      const yes = !root.classList.contains('is-folded');
      setFold(yes);
      try { localStorage.setItem(FOLD_KEY, yes ? '1' : '0'); } catch (e) { /* only for this visit */ }
    });
    if (window.rzgsPlans && window.rzgsPlans.mountCard) window.rzgsPlans.mountCard(accountCard, $('[data-acc-me]', root));
    return () => setDrawer(false);
  }

  // Logging out asks first, like the power button of the control app: "Do you want to log out?"  No / Yes.
  // Every Log out button of the account pages comes here: in Manage account, in the Edit profile box and in the account card.
  function wireSignOut() {
    const confirmBox = $('[data-sign-out-dialog]');
    const confirmMsg = $('[data-sign-out-msg]', confirmBox);
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-sign-out]')) return;
      confirmMsg.hidden = true;
      motion.fromTap(confirmBox);
      confirmBox.showModal(); // the browser puts the cursor on "No" and gives it back when the box closes
    });
    $('[data-sign-out-no]', confirmBox).addEventListener('click', () => confirmBox.close());
    // a tap on the dark area around the card also means "No"
    confirmBox.addEventListener('click', (event) => { if (event.target === confirmBox) confirmBox.close(); });
    $('[data-sign-out-yes]', confirmBox).addEventListener('click', async (event) => {
      const yes = event.currentTarget;
      setBusy(yes, true);
      const { error } = await db.auth.signOut();
      // When the server can't be reached, this device may or may not have been signed out. Look, don't guess.
      const { data } = await db.auth.getSession();
      if (error && data.session) {
        // still signed in: say so instead of pretending
        setBusy(yes, false);
        confirmMsg.textContent = friendlyError(error);
        confirmMsg.hidden = false;
        return;
      }
      location.replace('./'); // signed out: back to the home page
    });
  }

  /* ------------------------------------------------------- Manage account page */
  // A page of its own since 2 Nov 2026 (the owner: "Manage account and Profile are separate"): Personal profile,
  // Subscription, Usage, Sessions and Help. The profile (the dashboard) keeps the plan, the bot, the awards and the log.
  async function initManage() {
    const root = $('[data-manage]');
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      location.replace('login');
      return;
    }
    let user = session.user;
    // a change of email may have been finished on another device since this one last looked
    if (user.new_email) {
      const { data } = await db.auth.getUser();
      if (data && data.user) user = data.user;
    }
    const COLUMNS = 'full_name, username, avatar_url, email, plan, plan_expires_at, created_at, email_confirmed_at, mt5_account, broker, bot_mt5_account, bot_broker';
    async function fetchProfile() {
      try {
        const { data } = await db.from('web_users').select(COLUMNS).eq('id', user.id).maybeSingle();
        return data || null;
      } catch (e) {
        return null;
      }
    }
    const profile = (await fetchProfile()) || {};
    const stored = (key) => profile[key] || (user.user_metadata || {})[key] || '';
    const setAll = (selector, text) => $$(selector, root).forEach((el) => { el.textContent = text; });
    wireAccountMenu(root);
    wireSignOut();

    /* ----- Personal profile: the picture, the name, the email, the account ----- */
    // only a picture from the person's own folder is ever shown (as on the dashboard)
    const avatarFolder = `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/`;
    function paintIdentity() {
      const name = (stored('full_name') || stored('username') || 'RZGS-PRO member').trim();
      const letter = name.charAt(0).toUpperCase() || 'R';
      const url = stored('avatar_url');
      setAll('[data-acc-name]', name);
      setAll('[data-dash-email]', profile.email || user.email || '');
      $$('[data-dash-avatar]', root).forEach((box) => {
        if (!url.startsWith(avatarFolder)) { box.textContent = letter; return; }
        const img = new Image();
        img.alt = '';
        img.onerror = () => { box.textContent = letter; };
        img.src = url;
        box.replaceChildren(img);
      });
      const joined = profile.created_at || user.created_at;
      const confirmed = profile.email_confirmed_at || user.email_confirmed_at;
      setAll('[data-info="joined"]', joined ? longDate(joined) : '-');
      setAll('[data-info="email-status"]', confirmed ? 'Confirmed' : 'Not confirmed');
      setAll('[data-info="mt5"]', profile.bot_mt5_account || stored('mt5_account') || 'Not set');
      setAll('[data-info="broker"]', profile.bot_broker || stored('broker') || 'Not set');
    }

    /* ----- change email ----- */
    // The new address counts only after the person opens the link we email to it (Supabase can also send one to
    // the old address: then both have to be opened). Until then the old address stays the login. The password is
    // asked for again, so a phone left unlocked is not enough to take an account away.
    const emailForm = $('[data-email-form]');
    function renderEmailChange() {
      const waiting = user.new_email || '';
      $('[data-email-new]', root).textContent = waiting;
      $$('[data-email-pending]', root).forEach((el) => { el.hidden = !waiting; });
    }
    renderEmailChange();
    wireValidation(emailForm);
    const captcha = wireCaptcha(emailForm, 'change_email');
    emailForm.addEventListener('focusin', captcha.start, { once: true });
    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateAll(emailForm)) return;
      const address = emailForm.elements.email;
      const password = emailForm.elements.password;
      const next = address.value.trim().toLowerCase();
      if (next === (user.email || '').toLowerCase()) {
        setFieldError(address, 'This is already your email address.');
        shakeField(address);
        address.focus();
        return;
      }
      const submit = $('[data-submit]', emailForm);
      setBusy(submit, true);
      const captchaToken = await captcha.take();
      if (captchaToken === null) {
        setBusy(submit, false);
        return;
      }
      const check = await db.auth.signInWithPassword({ email: user.email, password: password.value, options: { captchaToken } });
      captcha.reset();
      if (check.error) {
        setBusy(submit, false);
        if (check.error.code === 'invalid_credentials') {
          setFieldError(password, 'Wrong password.');
          shakeField(password);
          password.focus();
        } else {
          formMessage(emailForm, friendlyError(check.error), 'error');
        }
        return;
      }
      const { data, error } = await db.auth.updateUser({ email: next }, { emailRedirectTo: pageUrl('dashboard.html') });
      setBusy(submit, false);
      if (error) {
        if (error.code === 'email_exists' || error.code === 'user_already_exists') {
          setFieldError(address, 'This email is already used by another account.');
          shakeField(address);
          address.focus();
        } else {
          formMessage(emailForm, friendlyError(error), 'error');
        }
        return;
      }
      if (data && data.user) user = data.user;
      emailForm.reset();
      const changed = (user.email || '').toLowerCase() === next; // no confirmation asked for: it is changed already
      if (changed) profile.email = user.email;
      paintIdentity();
      renderEmailChange();
      formMessage(emailForm, changed ? 'Email address changed.' : 'Link sent. Check the inbox of your new address.', 'success');
    });

    const passwordForm = $('[data-password-form]', root);
    wireValidation(passwordForm);
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateAll(passwordForm)) return;
      const submit = $('[data-submit]', passwordForm);
      setBusy(submit, true);
      const { error } = await db.auth.updateUser({ password: passwordForm.elements.new_password.value });
      setBusy(submit, false);
      if (error) {
        formMessage(passwordForm, friendlyError(error), 'error');
        return;
      }
      passwordForm.reset();
      formMessage(passwordForm, 'Password updated.', 'success');
    });

    /* ----- what was bought on this website: whether the free days are used ----- */
    let checkout = { trial_used: false };
    async function refreshCheckout() {
      try {
        const { data } = await db.rpc('web_my_checkout');
        if (data && data.ok) checkout = data;
      } catch (e) { /* the free days stay as they were */ }
    }
    const onOpen = {}; // Usage and Sessions ask the server when they are shown

    /* ----- Subscription: the plan now, what it gives, its next step, then the other plans (the owner's sketch) ----- */
    const sub = $('[data-sub]', root);
    const check = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    function renderSubscription(state, paidRunning, canMoveUp) {
      const plans = (window.rzgsPlans && window.rzgsPlans.plans) || [];
      const mine = plans.find((plan) => plan.id === state.plan);
      const ended = state.status === 'Expired';
      $('[data-sub-tone]', sub).dataset.subTone = state.plan && !ended ? state.plan : 'off';
      $('[data-sub-name]', sub).textContent = state.plan ? `${mine ? mine.name : state.name} plan${ended ? ' (ended)' : ''}` : 'No plan yet';
      $('[data-sub-until]', sub).textContent = !state.plan ? 'Start with 7 free days. No payment needed.'
        : !profile.plan_expires_at ? 'No end date.'
          : `${ended ? 'It ended on' : 'Your plan runs until'} ${state.until}.`;
      $('[data-sub-price]', sub).textContent = mine && !ended ? `${mine.amount} ${mine.per}` : '';
      // its one next step: the free days, renewing, moving up, or the plans to look at
      const [label, checkoutId, main] = !state.plan ? (checkout.trial_used ? ['Choose a plan', '', true] : ['Claim your free trial', 'trial', true])
        : ended ? [`Renew ${mine ? mine.name : state.name}`, state.plan, true]
          : state.plan === 'trial' ? ['Upgrade your plan', '', true]
            : canMoveUp ? ['Move up to Diamond', 'diamond', true]
              : ['See plans', '', false];
      const action = $('[data-sub-action]', sub);
      action.textContent = label;
      action.classList.toggle('btn-primary', main);
      action.classList.toggle('btn-ghost', !main);
      if (checkoutId) {
        action.dataset.checkout = checkoutId;
        delete action.dataset.plans;
        action.href = '#plan';
      } else {
        action.dataset.plans = '';
        delete action.dataset.checkout;
        action.href = './#plans';
      }
      const gets = (mine || plans.find((plan) => plan.id === 'trial') || { get: [] }).get;
      $('[data-sub-get]', sub).innerHTML = gets.map((line) => `<li>${check}<span></span></li>`).join('');
      $$('[data-sub-get] span', sub).forEach((span, index) => { span.textContent = gets[index]; });
      $('[data-sub-cancel]', sub).hidden = !paidRunning;
      // the other plans: everything but the one running now
      const others = plans.filter((plan) => plan.id !== state.plan || ended);
      $('[data-sub-others]', root).replaceChildren(...others.map((plan) => {
        const card = document.createElement('article');
        card.className = 'acc-plan-card';
        card.dataset.tone = plan.id;
        card.innerHTML = `<div class="acc-plan-card-top"><b></b><span></span></div>
          <p class="acc-plan-card-price"><b></b><span></span></p>
          <p class="acc-plan-card-lead"></p>
          <button class="btn btn-ghost btn-sm" type="button"></button>`;
        $('.acc-plan-card-top b', card).textContent = plan.name;
        $('.acc-plan-card-top span', card).textContent = plan.chip;
        $('.acc-plan-card-price b', card).textContent = plan.amount;
        $('.acc-plan-card-price span', card).textContent = plan.per;
        $('.acc-plan-card-lead', card).textContent = plan.lead;
        const button = $('button', card);
        button.textContent = plan.id === 'diamond' && canMoveUp ? 'Move up' : plan.button;
        button.dataset.planLink = plan.id;
        button.dataset.checkout = plan.id;
        return card;
      }));
    }
    $('[data-sub-cancel]', sub).addEventListener('click', () => { if (window.rzgsPlans && window.rzgsPlans.cancel) window.rzgsPlans.cancel(); });

    function renderPlan() {
      const state = planState(profile);
      // a paid plan that is running: nothing else starts until it ends or is cancelled; from Elite, Diamond can (plans.js)
      const paidRunning = Boolean(state.plan) && state.plan !== 'trial' && state.status !== 'Expired';
      const canMoveUp = paidRunning && state.plan === 'elite';
      setAll('[data-plan-choice-note]', paidRunning
        ? `Your ${state.name} plan runs until ${state.until}. You can renew it or start another plan when it ends.${canMoveUp ? ' To move up now, choose Diamond.' : ''}`
        : 'Trial and Elite start right here. Diamond opens a chat with our sales team on Telegram.');
      renderSubscription(state, paidRunning, canMoveUp);
      $$('[data-plan-link]', root).forEach((button) => {
        const on = button.dataset.planLink === state.plan;
        const freeUsed = button.dataset.planLink === 'trial' && checkout.trial_used;
        const moveUp = canMoveUp && button.dataset.planLink === 'diamond';
        const locked = !moveUp && (paidRunning || freeUsed || (on && (state.plan === 'trial' || state.status !== 'Expired'))); // the free days only once
        button.disabled = locked;
        button.classList.toggle('is-locked', locked && !on);
        button.classList.toggle('is-on', on);
        if (on) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
    }

    /* ----- Usage: the client's own bot, in money (web_my_usage; the owner chose to show it, 2 Nov 2026) ----- */
    const usageBox = $('#m-usage', root);
    const rangeBox = $('[data-usage-range]', usageBox);
    const RANGE_KEY = 'rzgs_usage_range';
    try {
      const saved = localStorage.getItem(RANGE_KEY);
      if ([...rangeBox.options].some((option) => option.value === saved)) rangeBox.value = saved;
    } catch (e) { /* this week */ }
    let usage = null;
    const dollars = (value) => `${value < 0 ? '-' : ''}$${Math.abs(Number(value) || 0).toFixed(2)}`;
    const plusMinus = (value) => (value > 0.004 ? '+' : '') + dollars(value);
    async function loadUsage(again) {
      if (usage && usage.ok && !again) { renderUsage(); return; }
      const button = $('[data-usage-refresh]', usageBox);
      setBusy(button, true);
      try {
        const { data, error } = await db.rpc('web_my_usage');
        if (error) throw error;
        usage = data || { ok: false };
      } catch (e) {
        usage = { ok: false, offline: !navigator.onLine };
      }
      setBusy(button, false);
      renderUsage();
    }
    onOpen.usage = () => loadUsage(false);
    $('[data-usage-refresh]', usageBox).addEventListener('click', () => loadUsage(true));
    rangeBox.addEventListener('change', () => {
      try { localStorage.setItem(RANGE_KEY, rangeBox.value); } catch (e) { /* only for this visit */ }
      renderUsage();
    });

    // Closed profit by range, as the control app's Report draws it: This week and Last week a bar a day, Monday to Sunday;
    // Last 5 weeks a bar a week; All time a bar a week, or a bar a month after half a year. From the bot's "rep".
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const WEEK = 7 * 86400;
    const dayMonth = (sec) => { const d = new Date(sec * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
    function usageSeries(u, range) {
      const r = u.rep || {};
      if (!Array.isArray(r.d14) || !Array.isArray(r.wk) || !r.wk.length) {
        const days = Array.isArray(u.days) ? u.days.slice(0, 7).map(Number) : [];
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date().getDay();
        return { title: 'Closed profit, last 7 days ($)', label: 'Closed profit, last 7 days', vals: days,
          labels: days.map((v, i) => (i === 6 ? 'Today' : names[(today + i + 1) % 7])), now: days.length - 1 };
      }
      const wd = (new Date(r.day0 * 1000).getUTCDay() + 6) % 7; // today, 0 = Monday
      if (range === 'week' || range === 'last') {
        const from = 13 - wd - (range === 'last' ? 7 : 0);
        const vals = [];
        const labels = [];
        for (let i = 0; i < 7; i += 1) {
          const k = from + i;
          vals.push(k <= 13 ? Number(r.d14[k]) : null); // null: a day still to come
          labels.push(range === 'week' && k === 13 ? 'Today' : WEEKDAYS[i]);
        }
        return range === 'week'
          ? { title: 'Closed profit this week ($)', label: 'Closed profit this week', vals, labels, now: wd }
          : { title: 'Closed profit last week ($)', label: 'Closed profit last week', vals, labels, now: -1 };
      }
      const n = r.wk.length;
      if (range === 'month') {
        const k0 = Math.max(0, n - 5);
        const vals = r.wk.slice(k0).map(Number);
        return { title: 'Closed profit a week, last 5 weeks ($)', label: 'Closed profit, last 5 weeks', vals,
          labels: vals.map((v, i) => dayMonth(r.wk0 + (k0 + i) * WEEK)), now: vals.length - 1 };
      }
      if (n <= 26) {
        return { title: 'Closed profit a week, since the start ($)', label: 'Closed profit since the start', vals: r.wk.map(Number),
          labels: r.wk.map((v, i) => dayMonth(r.wk0 + i * WEEK)), now: n - 1 };
      }
      const months = []; // a week counts in the month of its Monday
      r.wk.forEach((v, i) => {
        const d = new Date((r.wk0 + i * WEEK) * 1000);
        const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
        const last = months[months.length - 1];
        if (last && last.key === key) last.v += Number(v);
        else months.push({ key, v: Number(v), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
      });
      return { title: 'Closed profit a month, since the start ($)', label: 'Closed profit since the start', vals: months.map((m) => m.v),
        labels: months.map((m) => m.label), now: months.length - 1 };
    }
    // bars over and under the zero line: the bar of today is cyan, a loss red; the amounts over the bars while they fit
    function drawBars(svg, vals, labels, now) {
      const nums = vals.filter((v) => v !== null);
      const n = vals.length;
      if (!n) { svg.innerHTML = '<text x="150" y="76">Nothing closed yet</text>'; return; }
      let hi = Math.max(0, ...nums);
      const lo = Math.min(0, ...nums);
      if (hi - lo < 1) hi = lo + 1;
      const top = 18;
      const bottom = 122;
      const y = (v) => top + ((hi - v) / (hi - lo)) * (bottom - top);
      const cw = 300 / n;
      const bw = Math.min(26, cw * 0.64);
      const every = Math.ceil(n / 7);
      const amounts = n <= 12;
      let h = `<line x1="0" y1="${y(0).toFixed(1)}" x2="300" y2="${y(0).toFixed(1)}" class="zero"/>`;
      vals.forEach((v, i) => {
        const cx = cw * (i + 0.5);
        const here = i === now;
        if (v !== null) {
          const y0 = y(Math.max(v, 0));
          const y1 = y(Math.min(v, 0));
          h += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" class="${v < 0 ? 'loss' : here ? 'now' : 'win'}"/>`;
          if (amounts) h += `<text x="${cx.toFixed(1)}" y="${(v < 0 ? y1 + 11 : y0 - 5).toFixed(1)}" class="amt">${Number(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}</text>`;
        }
        if ((n - 1 - i) % every === 0) h += `<text x="${cx.toFixed(1)}" y="146" class="${here ? 'today' : v === null ? 'later' : ''}">${labels[i]}</text>`;
      });
      svg.innerHTML = h;
    }
    function renderUsage() {
      const state = $('[data-usage-state]', usageBox);
      const u = usage || {};
      const u$ = (key) => $(`[data-u="${key}"]`, usageBox);
      const problem = !u.ok
        ? (u.offline ? "You're offline. Check your connection and try again." : 'Usage is not available yet. Please try again later.')
        : !u.bot
          ? (profile.plan ? 'Your bot has not reported yet. Its numbers show here once it runs in MT5.' : 'No bot yet. Choose a plan to get your bot, and its numbers show here.')
          : '';
      $$('[data-usage-part]', usageBox).forEach((part) => { part.hidden = Boolean(problem); });
      if (problem) {
        state.dataset.tone = 'off';
        state.textContent = problem;
        return;
      }
      state.dataset.tone = u.online ? 'good' : 'bad';
      state.textContent = u.online ? `Live from MT5 account ${u.account}.` : `Offline. Last report ${u.seen_at ? shortDateTime(u.seen_at) : 'not known'}.`;
      const series = usageSeries(u, rangeBox.value);
      const total = series.vals.reduce((sum, v) => sum + (Number(v) || 0), 0);
      u$('profit').textContent = plusMinus(total);
      u$('profit').dataset.tone = total > 0.004 ? 'good' : total < -0.004 ? 'bad' : '';
      u$('profit-label').textContent = series.label;
      u$('balance').textContent = dollars(u.balance);
      u$('balance-label').textContent = `Balance · today ${plusMinus(u.day_profit)}`;
      u$('trades').textContent = String(Number(u.trades) || 0);
      const dd = Number(u.max_dd) || 0;
      u$('dd').textContent = dd > 0.004 ? `-${dd.toFixed(2)}%` : '0.00%';
      u$('dd').dataset.tone = dd > 0.004 ? 'bad' : '';
      u$('chart-title').textContent = series.title;
      u$('bars').setAttribute('aria-label', series.title);
      drawBars(u$('bars'), series.vals, series.labels, series.now);
      // today's closes: by take profit, or a whole side together (a basket)
      const tp = Number(u.tp) || 0;
      const baskets = Number(u.baskets) || 0;
      const all = tp + baskets;
      const share = (count) => Math.round((count / all) * 100);
      u$('split').innerHTML = all
        ? `<div class="acc-split-bar"><i data-k="tp" style="flex:${tp}"></i><i data-k="basket" style="flex:${baskets}"></i></div>
          <ul class="acc-split-legend">
            <li data-k="tp">Take profit <b>${share(tp)}%</b><small>${tp}</small></li>
            <li data-k="basket">Basket <b>${share(baskets)}%</b><small>${baskets}</small></li>
            <li data-k="cycles">Cycles closed <b>${Number(u.cycles) || 0}</b></li>
          </ul>`
        : '<p class="dash-hint">No trades closed yet today.</p>';
    }

    /* ----- Sessions: the devices logged in to this account, and to the control app (web_my_sessions) ----- */
    const sessionsBox = $('#m-sessions', root);
    const note = $('[data-sessions-note]', sessionsBox);
    const NOTE_KEY = 'rzgs_sessions_note';
    try { if (localStorage.getItem(NOTE_KEY)) note.hidden = true; } catch (e) { /* shown */ }
    $('[data-sessions-note-x]', note).addEventListener('click', () => {
      note.hidden = true;
      try { localStorage.setItem(NOTE_KEY, '1'); } catch (e) { /* only for this visit */ }
    });
    let sessions = null;
    async function loadSessions(again) {
      if (sessions && sessions.ok && !again) return;
      const button = $('[data-sessions-refresh]', sessionsBox);
      setBusy(button, true);
      try {
        const { data, error } = await db.rpc('web_my_sessions');
        if (error) throw error;
        sessions = data || { ok: false };
      } catch (e) {
        sessions = { ok: false, offline: !navigator.onLine };
      }
      setBusy(button, false);
      renderSessions();
    }
    onOpen.sessions = () => loadSessions(false);
    $('[data-sessions-refresh]', sessionsBox).addEventListener('click', () => loadSessions(true));

    // what a browser says about itself, in words: the system and the browser with its version
    function deviceOf(agent) {
      const a = agent || '';
      const version = (re) => { const m = a.match(re); return m ? m[1].split('.')[0] : ''; };
      const system = /iPhone/.test(a) ? 'iPhone' : /iPad/.test(a) ? 'iPad' : /Android/.test(a) ? 'Android' : /CrOS/.test(a) ? 'ChromeOS'
        : /Windows/.test(a) ? 'Windows' : /Mac OS X|Macintosh/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : 'Unknown device';
      const browser = /Telegram/.test(a) ? ['Telegram', ''] : /Edg\//.test(a) ? ['Edge', version(/Edg\/([\d.]+)/)]
        : /OPR\//.test(a) ? ['Opera', version(/OPR\/([\d.]+)/)] : /SamsungBrowser\//.test(a) ? ['Samsung Internet', version(/SamsungBrowser\/([\d.]+)/)]
          : /Firefox\/|FxiOS\//.test(a) ? ['Firefox', version(/(?:Firefox|FxiOS)\/([\d.]+)/)] : /CriOS\//.test(a) ? ['Chrome', version(/CriOS\/([\d.]+)/)]
            : /Chrome\//.test(a) ? ['Chrome', version(/Chrome\/([\d.]+)/)] : /Safari\//.test(a) ? ['Safari', version(/Version\/([\d.]+)/)] : ['Browser', ''];
      const phoneLike = /iPhone|Android|Mobile/.test(a) && !/iPad|Tablet/.test(a);
      return { system, browser: browser.filter(Boolean).join(' '), phone: phoneLike };
    }
    const ago = (when) => {
      const minutes = Math.round((Date.now() - new Date(when)) / 60000);
      if (minutes < 5) return 'Active now';
      const words = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
      if (minutes < 60) return `Active ${words.format(-minutes, 'minute')}`;
      if (minutes < 48 * 60) return `Active ${words.format(-Math.round(minutes / 60), 'hour')}`;
      if (minutes < 30 * 24 * 60) return `Active ${words.format(-Math.round(minutes / 1440), 'day')}`;
      return `Active on ${longDate(when)}`;
    };
    // The town of an IP address, from a free lookup service (the owner chose this, 2 Nov 2026); kept a week on this device.
    const PLACES_KEY = 'rzgs_ip_places';
    let places = {};
    try { places = JSON.parse(localStorage.getItem(PLACES_KEY) || '{}') || {}; } catch (e) { /* asked again */ }
    async function placeOf(ip) {
      if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return '';
      const known = places[ip];
      if (known && Date.now() - known.at < 7 * 86400000) return known.place;
      try {
        const answer = await fetch(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`);
        if (!answer.ok) return '';
        const geo = await answer.json();
        const place = [geo.city, geo.country].filter((word) => typeof word === 'string' && word).join(', ');
        places[ip] = { place, at: Date.now() };
        try { localStorage.setItem(PLACES_KEY, JSON.stringify(places)); } catch (e) { /* asked again next time */ }
        return place;
      } catch (e) {
        return '';
      }
    }
    const sessionMsg = (text, tone) => {
      const line = $('[data-session-msg]', sessionsBox);
      line.textContent = text;
      line.dataset.tone = tone;
      line.hidden = false;
    };
    function renderSessions() {
      const state = $('[data-sessions-state]', sessionsBox);
      const s = sessions || {};
      const problem = !s.ok ? (s.offline ? "You're offline. Check your connection and try again." : 'Your devices are not available yet. Please try again later.') : '';
      $$('[data-sessions-part]', sessionsBox).forEach((part) => { part.hidden = Boolean(problem); });
      state.hidden = !problem;
      state.textContent = problem;
      if (problem) return;
      const list = Array.isArray(s.sessions) ? s.sessions : [];
      $('[data-sessions-count]', sessionsBox).textContent = list.length;
      $('[data-sessions-list]', sessionsBox).replaceChildren(...list.map((one) => {
        const device = deviceOf(one.agent);
        const row = document.createElement('li');
        row.className = 'acc-device';
        row.innerHTML = `<span class="acc-device-ico"><svg class="icon" aria-hidden="true"><use href="#i-${device.phone ? 'smartphone' : 'laptop'}"/></svg></span>
          <p class="acc-device-name"><b></b></p>
          <p class="acc-device-meta"><span data-browser></span><span data-place>Finding the place...</span><span data-seen></span></p>`;
        $('.acc-device-name b', row).textContent = device.system;
        if (one.me) $('.acc-device-name', row).insertAdjacentHTML('beforeend', '<span class="acc-here">This device</span>');
        $('[data-browser]', row).textContent = device.browser;
        $('[data-seen]', row).textContent = ago(one.seen);
        const placeBox = $('[data-place]', row);
        placeOf(one.ip).then((place) => { placeBox.textContent = [place || 'Unknown place', one.ip].filter(Boolean).join(' · '); });
        if (!one.me) {
          const out = document.createElement('button');
          out.className = 'btn btn-ghost btn-sm';
          out.type = 'button';
          out.textContent = 'Log out';
          out.addEventListener('click', async () => {
            setBusy(out, true);
            const { data, error } = await db.rpc('web_end_session', { p_id: one.id });
            if (error || !data || !data.ok) {
              setBusy(out, false);
              sessionMsg(error ? friendlyError(error) : "We couldn't log that device out. Please try again.", 'error');
              return;
            }
            row.classList.add('is-gone');
            out.replaceWith(Object.assign(document.createElement('span'), { className: 'acc-gone', textContent: 'Logged out' }));
            sessionMsg('That device is logged out. It may stay open there for up to an hour.', 'success');
          });
          row.append(out);
        }
        return row;
      }));
      // the control app keeps no device names: how many, and one button for all of them
      const devices = Number(s.app_devices) || 0;
      $('[data-app-count]', sessionsBox).textContent = devices;
      const account = profile.bot_mt5_account;
      $('[data-app-note]', sessionsBox).textContent = !s.has_bot
        ? 'Your control app opens once your bot is delivered. Its devices show here then.'
        : devices
          ? `${devices} ${devices === 1 ? 'device is' : 'devices are'} logged in to your control app${account ? ` with MT5 account ${account}` : ''}.`
          : 'No device is logged in to your control app.';
      $('[data-app-row]', sessionsBox).hidden = !s.has_bot || !devices;
    }
    $('[data-app-out]', sessionsBox).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const yes = await ask('Log out of the control app everywhere?', 'Every phone and computer using your control app is logged out. You log in again with your MT5 account number and App Password. Your bot keeps running.');
      if (!yes) return;
      setBusy(button, true);
      let answer = null;
      try { answer = (await db.rpc('web_end_app_sessions')).data; } catch (e) { /* said below */ }
      setBusy(button, false);
      const line = $('[data-app-msg]', sessionsBox);
      line.textContent = answer && answer.ok ? 'Every device is logged out of your control app.' : "We couldn't do that just now. Please try again.";
      line.dataset.tone = answer && answer.ok ? 'success' : 'error';
      line.hidden = false;
      if (answer && answer.ok) loadSessions(true);
    });
    const others = $('[data-sign-out-others]', root);
    others.addEventListener('click', async () => {
      setBusy(others, true);
      const { error } = await db.auth.signOut({ scope: 'others' });
      setBusy(others, false);
      const line = $('[data-session-msg]', root);
      line.textContent = error ? friendlyError(error) : 'Your other devices are logged out.';
      line.dataset.tone = error ? 'error' : 'success';
      line.hidden = false;
      if (!error) loadSessions(true);
    });

    /* ----- a yes-or-no question, like the one before logging out ----- */
    const askBox = $('[data-ask-dialog]', root);
    function ask(title, text) {
      $('[data-ask-title]', askBox).textContent = title;
      $('[data-ask-text]', askBox).textContent = text;
      motion.fromTap(askBox);
      askBox.showModal(); // the browser puts the cursor on "No"
      return new Promise((resolve) => {
        const done = (yes) => {
          askBox.onclose = null;
          if (askBox.open) askBox.close();
          resolve(yes);
        };
        $('[data-ask-yes]', askBox).onclick = () => done(true);
        $('[data-ask-no]', askBox).onclick = () => done(false);
        askBox.onclick = (event) => { if (event.target === askBox) done(false); };
        askBox.onclose = () => resolve(false); // Escape
      });
    }

    /* ----- the tabs: one part at a time, remembered in the address (#subscription, #usage ...) ----- */
    const ROUTES = {
      personal: 'personal', tools: 'personal', account: 'personal', security: 'personal',
      subscription: 'plan', plan: 'plan', usage: 'usage', sessions: 'sessions', help: 'help', support: 'help', legal: 'help',
    };
    const ADDRESS = { personal: 'personal', plan: 'subscription', usage: 'usage', sessions: 'sessions', help: 'help' };
    let settled = false;
    function go(name) {
      const part = ROUTES[name] || 'personal';
      $$('[role="tab"][data-part]', root).forEach((tab) => {
        const on = tab.dataset.part === part;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
        // the chosen chip in sight, in a row that scrolls sideways on a phone
        if (on) tab.parentElement.scrollLeft = tab.offsetLeft - (tab.parentElement.clientWidth - tab.offsetWidth) / 2;
      });
      if (settled) {
        history.replaceState(null, '', `#${ADDRESS[part]}`);
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      if (onOpen[part]) onOpen[part]();
    }
    root.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      const jump = event.target.closest('[data-jump]');
      if (jump) {
        event.preventDefault();
        const place = document.getElementById(jump.dataset.jump);
        place.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const field = $('input', place);
        if (field) field.focus({ preventScroll: true });
        return;
      }
      const link = event.target.closest('[data-go]');
      if (!link) return;
      event.preventDefault();
      go(link.dataset.go);
    });
    window.addEventListener('hashchange', () => {
      const name = location.hash.slice(1);
      if (ROUTES[name]) go(name);
    });
    // the arrow keys move along the tabs, Home and End jump to their ends
    $$('[role="tablist"]', root).forEach((list) => {
      list.addEventListener('keydown', (event) => {
        const tabs = $$('[role="tab"]', list);
        const index = tabs.indexOf(document.activeElement);
        if (index < 0) return;
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        const next = step ? tabs[(index + step + tabs.length) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null;
        if (!next) return;
        event.preventDefault();
        go(next.dataset.go);
        next.focus();
      });
    });

    paintIdentity();
    await refreshCheckout();
    renderPlan();
    go(location.hash.slice(1));
    settled = true;
    root.setAttribute('aria-busy', 'false');
    if (window.rzgsPlans) {
      window.rzgsPlans.repaint({ full_name: stored('full_name'), username: stored('username'), plan: profile.plan || null, plan_expires_at: profile.plan_expires_at || null });
    }
    // a plan bought or cancelled from here (checkout.js) shows at once
    document.addEventListener('rzgs:checkout', async () => {
      const fresh = await fetchProfile();
      if (fresh) Object.assign(profile, fresh);
      await refreshCheckout();
      renderPlan();
    });
    // signed out in another tab
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('./');
    });
  }

  ({ login: initLogin, signup: initSignup, reset: initReset, dashboard: initDashboard, manage: initManage }[page] || (() => {}))();
})();
