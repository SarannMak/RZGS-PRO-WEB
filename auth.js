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
      email_not_confirmed: 'Please confirm your email first. We sent you a link when you signed up.',
      user_already_exists: 'This email already has an account. Log in instead.',
      email_exists: 'This email already has an account. Log in instead.',
      weak_password: `Please choose a stronger password with at least ${MIN_PASSWORD} characters.`,
      same_password: 'Your new password must be different from your old one.',
      email_address_invalid: "That email address doesn't look right. Please check it.",
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
      const { error } = await send();
      setBusy(button, false);
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

    wireValidation(form);
    wireResend(resendButton, () => db.auth.resend({
      type: 'signup',
      email: form.elements.email.value.trim(),
      options: { emailRedirectTo: pageUrl('dashboard.html') },
    }));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      resendButton.hidden = true;
      if (!validateAll(form)) return;

      setBusy(submit, true);
      const { error } = await db.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      });
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

  async function initSignup() {
    const form = $('[data-signup-form]');
    const steps = $$('[data-step]', form);
    const bar = $$('[data-steps-bar] li');
    const formWrap = $('[data-signup-wrap]');
    const done = $('[data-signup-done]');
    const DRAFT_KEY = 'rz_signup_draft';
    const DRAFT_FIELDS = ['full_name', 'email', 'username', 'country', 'phone', 'telegram_username'];
    let current = 0;

    const { data: { session } } = await db.auth.getSession();
    if (session) {
      location.replace(afterSignIn());
      return;
    }

    fillCountries(form.elements.country);

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

    function showStep(index, moveFocus = true) {
      current = index;
      steps.forEach((step, i) => { step.hidden = i !== index; });
      bar.forEach((item, i) => {
        item.classList.toggle('is-done', i < index);
        item.classList.toggle('is-current', i === index);
        if (i === index) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      clearMessage();
      if (moveFocus) $('legend', steps[index]).focus();
    }

    $$('[data-back]', form).forEach((button) => button.addEventListener('click', () => showStep(current - 1)));

    const resend = wireResend($('[data-resend]', done), () => db.auth.resend({
      type: 'signup',
      email: form.elements.email.value.trim(),
      options: { emailRedirectTo: pageUrl('dashboard.html') },
    }));

    $('[data-restart]', done).addEventListener('click', () => {
      done.hidden = true;
      formWrap.hidden = false;
      showStep(0, false);
      form.elements.email.focus();
    });

    // One form, three steps: "Continue" and the Enter key both arrive here.
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateAll(steps[current])) return;
      if (current < steps.length - 1) {
        showStep(current + 1);
        return;
      }

      const submit = $('[data-submit]', form);
      const email = form.elements.email.value.trim();
      setBusy(submit, true);
      clearMessage();

      const { data, error } = await db.auth.signUp({
        email,
        password: form.elements.new_password.value,
        options: {
          emailRedirectTo: pageUrl('dashboard.html'),
          // These details are copied into the web_users table by the database.
          data: {
            full_name: form.elements.full_name.value.trim(),
            username: form.elements.username.value.trim(),
            country: form.elements.country.value,
            phone: form.elements.phone.value.trim(),
            telegram_username: form.elements.telegram_username.value.trim().replace(/^@/, ''),
            accepted_terms: true,
          },
        },
      });
      setBusy(submit, false);

      // Supabase answers "ok" with an empty identities list when the email is already registered.
      const alreadyRegistered = !error && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
      if (alreadyRegistered || (error && (error.code === 'user_already_exists' || error.code === 'email_exists'))) {
        showStep(0, false);
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
      form.elements.new_password.value = '';
      form.elements.confirm_password.value = '';

      if (data.session) {
        // email confirmation is switched off in Supabase: the person is already signed in
        location.replace(afterSignIn());
        return;
      }

      $('[data-done-email]', done).textContent = email;
      formWrap.hidden = true;
      done.hidden = false;
      $('h2', done).focus();
      resend.cooldown();
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

    requestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      if (!validateAll(requestForm)) return;

      const submit = $('[data-submit]', requestForm);
      const email = requestForm.elements.email.value.trim();
      setBusy(submit, true);
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset-password.html') });
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
    // When someone arrives from the confirmation email, supabase-js signs them in here.
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      location.replace('login' + (urlError ? '?error=link' : firstOfTwo ? '?confirm=other' : ''));
      return;
    }
    const wanted = afterSignIn();
    if (wanted !== 'dashboard') {
      if (arrivedFrom === 'signup') markJustIn();
      location.replace(wanted);
      return;
    }
    if (arrivedFrom === 'signup') showMessage('Your email is confirmed. Welcome to RZGS-PRO!', 'success');
    else if (arrivedFrom === 'email_change') showMessage('Your email address is changed. Log in with the new one from now on.', 'success');
    else if (firstOfTwo) showMessage(FIRST_OF_TWO, 'success');
    else if (urlError) showMessage('That link has expired or was already used. If you were changing your email, send the request again in Settings, under Security.');

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

    /* ----- menu: one view at a time, remembered in the address (#plan, #tools ...) ----- */
    const tabs = $$('.dash-dock [role="tab"]', root);
    const tabFor = (name) => tabs.find((tab) => tab.dataset.tab === name);
    let settled = false;
    const selectTab = setupTabs(tabs, (tab) => {
      root.dataset.view = tab.dataset.tab;
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
    // the profile button on this page goes to the first view, with no reload
    $$('.header-actions [data-profile]').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      selectTab(tabs[0]);
    }));
    // links inside the page, like "See plans", switch tab through the address
    window.addEventListener('hashchange', () => {
      const tab = tabFor(location.hash.slice(1));
      if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab);
    });
    setupTabs($$('.dash-seg [role="tab"]', root))($('.dash-seg [role="tab"]', root));

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
      $('[data-plan-cancel-row]', root).hidden = !paidRunning;
      $('[data-plan-cancel-note]', root).hidden = !paidRunning;
      setAll('[data-plan-choice-note]', paidRunning
        ? `Your ${state.name} plan runs until ${state.until}. You can renew it or start another plan when it ends, or cancel it above first.`
        : 'Each button starts that plan right here. We only ask for what we need.');
      $$('[data-plan-link]', root).forEach((button) => {
        const on = button.dataset.planLink === state.plan;
        const freeUsed = button.dataset.planLink === 'trial' && checkout.trial_used;
        const locked = paidRunning || freeUsed || (on && (state.plan === 'trial' || state.status !== 'Expired')); // the free days only once
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

    /* ----- forms ----- */
    // Each form saves a few fields of the person's own profile, then says so next to its button.
    function wireSaveForm(form, readFields, successText) {
      wireValidation(form);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!validateAll(form)) return;
        const submit = $('[data-submit]', form);
        const fields = readFields();
        setBusy(submit, true);
        const { data, error } = await db.auth.updateUser(fields.password ? fields : { data: fields });
        setBusy(submit, false);
        if (error) {
          formMessage(form, friendlyError(error), 'error');
          return;
        }
        if (fields.password) {
          form.reset();
        } else {
          if (data && data.user) user = data.user;
          Object.assign(profile, fields);
          renderHeader();
          renderInfo();
        }
        formMessage(form, successText, 'success');
      });
    }

    const profileForm = $('[data-profile-form]');
    const passwordForm = $('[data-password-form]');
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
      if (event.target.closest('[data-plan-cancel]')) withCheckout((checkoutBox) => checkoutBox.askCancel(profile.plan, profile.plan_expires_at));
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

    wireSaveForm(passwordForm, () => ({ password: passwordForm.elements.new_password.value }), 'Password updated.');

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
      const check = await db.auth.signInWithPassword({ email: user.email, password: password.value });
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
      renderHeader();
      renderEmailChange();
      formMessage(emailForm, changed ? 'Email address changed.' : 'Link sent. Check the inbox of your new address.', 'success');
    });

    /* ----- session ----- */
    // Logging out asks first, like the power button of the control app: "Do you want to log out?"  No / Yes.
    // Every Log out button on this page comes here: in Settings, in the Edit profile box and in the box under the profile button.
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

    const others = $('[data-sign-out-others]');
    others.addEventListener('click', async () => {
      setBusy(others, true);
      const { error } = await db.auth.signOut({ scope: 'others' });
      setBusy(others, false);
      const line = $('[data-session-msg]');
      line.textContent = error ? friendlyError(error) : 'Your other devices are logged out.';
      line.dataset.tone = error ? 'error' : 'success';
      line.hidden = false;
    });

    // signed out in another tab
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('./');
    });
  }

  ({ login: initLogin, signup: initSignup, reset: initReset, dashboard: initDashboard }[page] || (() => {}))();
})();
