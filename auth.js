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
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Email links come back with details in the address. Read them before supabase-js tidies the URL.
  const urlQuery = new URLSearchParams(location.search);
  const urlHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromUrl = (key) => urlHash.get(key) || urlQuery.get(key);
  const arrivedFrom = fromUrl('type'); // "signup" after confirming an email, "recovery" for a password reset
  const urlError = fromUrl('error_description') || fromUrl('error');

  // Full address of another page in this same folder, e.g. https://site.com/dashboard.html
  const pageUrl = (name) => new URL(name, location.href).href.split(/[?#]/)[0];

  /* ---------------------------------------------------------------- messages */
  const msgBox = $('[data-auth-msg]');
  function showMessage(text, tone = 'error') {
    if (!msgBox) return;
    $('[data-auth-msg-text]', msgBox).textContent = text;
    msgBox.dataset.tone = tone;
    $('use', msgBox).setAttribute('href', tone === 'success' ? '#i-check' : '#i-alert');
    msgBox.hidden = false;
  }
  function clearMessage() {
    if (msgBox) msgBox.hidden = true;
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
  const rules = {
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
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }
  function validateField(input) {
    const rule = rules[input.name];
    const message = rule ? rule(input.value, input.form, input) : '';
    setFieldError(input, message);
    return !message;
  }
  // Checks every field inside "root" and moves the cursor to the first problem.
  function validateAll(root) {
    const invalid = $$('input, select', root).filter((input) => !validateField(input));
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

  wirePasswordToggles();

  /* ---------------------------------------------------------------- login page */
  async function initLogin() {
    const form = $('[data-login-form]');
    const submit = $('[data-submit]', form);
    const resendButton = $('[data-resend]');

    if (urlQuery.get('signedout')) showMessage("You've signed out.", 'success');
    else if (urlError) showMessage('That link is no longer valid. Please log in, or request a new link.');

    const { data: { session } } = await db.auth.getSession();
    if (session) {
      location.replace('dashboard.html');
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
        if (error.code === 'email_not_confirmed') resendButton.hidden = false;
        return;
      }
      location.replace('dashboard.html');
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
      location.replace('dashboard.html');
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
        location.replace('dashboard.html');
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
      setTimeout(() => location.replace('dashboard.html'), 1200);
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
    line.hidden = false;
    if (tone === 'success') line.hideTimer = setTimeout(() => { line.hidden = true; }, 4000);
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

  // The plan and its end date are written to the web_users table by the Telegram sales bot when it
  // delivers a licence (the site owner can also type them there).
  // This turns them into everything the dashboard shows about the plan.
  function planState(profile) {
    const plan = PLAN_NAMES[profile.plan] ? profile.plan : null;
    if (!plan) {
      return {
        plan: null, name: 'Not started', status: 'No plan', tone: 'off', until: '-', big: '--', sub: 'NO PLAN', arc: 0,
        note: 'Request your free 7-day Pro trial, or choose a plan. The button opens our Telegram bot, and your plan shows here when your bot is delivered.',
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
      note: soon ? `Your ${what} ends on ${longDate(ends)}. ${todo} now to avoid a break.` : `Your ${what} is valid until ${longDate(ends)}.`,
    };
  }

  async function initDashboard() {
    const root = $('[data-dash]');
    // When someone arrives from the confirmation email, supabase-js signs them in here.
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      location.replace('login.html' + (urlError ? '?error=link' : ''));
      return;
    }
    if (arrivedFrom === 'signup') showMessage('Your email is confirmed. Welcome to RZGS-PRO!', 'success');

    let user = session.user;
    // Our own copy of the profile (plus the plan), kept in the web_users table.
    // The bot_* columns are written by the Telegram sales bot once the account is connected to it.
    const PROFILE_COLUMNS = 'full_name, username, avatar_url, email, country, phone, telegram_username, mt5_account, broker, plan, plan_expires_at, created_at, email_confirmed_at, last_sign_in_at, accepted_terms_at, bot_tg_id, bot_tg_username, bot_mt5_account, bot_broker, bot_stage, bot_plan';
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
      if (!settled) return;
      history.replaceState(null, '', `#${tab.dataset.tab}`);
      window.scrollTo({ top: 0, behavior: 'instant' }); // every view starts at its top, like a new screen
    });
    selectTab(tabFor(location.hash.slice(1)) || tabs[0]);
    settled = true;
    // links inside the page, like "See plans", switch tab through the address
    window.addEventListener('hashchange', () => {
      const tab = tabFor(location.hash.slice(1));
      if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab);
    });
    setupTabs($$('.dash-seg [role="tab"]', root))($('.dash-seg [role="tab"]', root));

    /* ----- Telegram sales bot ----- */
    // Plans are bought in the Telegram bot. The dashboard's Telegram buttons carry a one-time code, so the bot
    // knows which website account the person owns without any typing ("l_<code>" or "l_<code>_<plan>").
    // The code is renewed while the page stays open. Without one, the buttons still open the bot at the plan.
    const BOT_URL = root.dataset.bot;
    const BOT_PLAN = { trial: 'free', elite: 'elite', diamond: 'diamond' };
    let linkCode = '';
    const botLink = (plan) => {
      const payload = [linkCode && `l_${linkCode}`, plan && BOT_PLAN[plan]].filter(Boolean).join('_');
      return payload ? `${BOT_URL}?start=${payload}` : BOT_URL;
    };
    async function refreshLinkCode() {
      try {
        const { data } = await db.rpc('web_link_code');
        linkCode = data && data.ok ? data.code : '';
      } catch (e) {
        linkCode = '';
      }
      renderPlan(); // puts the fresh links on the buttons
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

    // the photo, or the first letter of the name: at the top of the dashboard and on the Profile tab
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
      const email = profile.email || user.email || '';
      $('[data-dash-name]').textContent = name.trim().split(/\s+/)[0];
      renderAvatar(name);
      setAll('[data-dash-email]', email);
    }

    function renderInfo() {
      const joined = profile.created_at || user.created_at;
      const confirmed = profile.email_confirmed_at || user.email_confirmed_at;
      setAll('[data-info="joined"]', joined ? longDate(joined) : '-');
      setAll('[data-info="email-status"]', confirmed ? 'Confirmed' : 'Not confirmed');
      // the account the licence was made for (written by the Telegram bot) comes before the one typed in the profile
      setAll('[data-info="mt5"]', profile.bot_mt5_account || stored('mt5_account') || 'Not set');
      setAll('[data-info="broker"]', profile.bot_broker || stored('broker') || 'Not set');
      const linked = Boolean(profile.bot_tg_id);
      setAll('[data-info="bot"]', linked ? (profile.bot_tg_username ? `@${profile.bot_tg_username}` : 'Connected') : 'Not connected');
      $$('[data-bot-connect]', root).forEach((box) => { box.hidden = linked; });
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
      if (!state.plan) {
        action.textContent = 'Request your free trial';
        action.href = botLink('trial');
      } else if (state.plan === 'trial') {
        action.textContent = 'Choose a plan';
        action.href = '#plan';
      } else {
        action.textContent = 'Renew plan';
        action.href = botLink(state.plan);
      }
      $$('[data-bot-link]', root).forEach((button) => { button.href = botLink(); });
      // on the Plan view, the current plan's button is shown "on"
      $$('[data-plan-link]', root).forEach((button) => {
        button.href = botLink(button.dataset.planLink);
        const on = button.dataset.planLink === state.plan;
        button.classList.toggle('is-on', on);
        if (on) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
    }

    /* ----- order: the buying steps, as the Telegram bot reports them ----- */
    // Which steps a plan has, which step each bot stage belongs to, and what the person has to do there.
    const ORDER_NEEDS = { trial: { broker: true, pay: false }, elite: { broker: true, pay: true }, diamond: { broker: false, pay: true } };
    const ORDER_STEP = {
      plan: 'plan', ask_broker: 'broker', ask_broker_email: 'broker', review_referral: 'broker', pay: 'pay', review_payment: 'pay',
      ask_mt5: 'mt5', review_mt5: 'mt5', build: 'bot', active: 'done',
    };
    const ORDER_NOTE = {
      plan: 'Choose your plan in the Telegram bot.',
      ask_broker: 'Open your MT5 account with one of our partner brokers, then tell the bot.',
      ask_broker_email: 'Send the bot the email you used at the broker.',
      review_referral: 'Our team is checking your broker registration.',
      pay: 'Pay with the KHQR code in the Telegram bot, then tap "I\'ve paid" there.',
      review_payment: 'Our team is confirming your payment.',
      ask_mt5: 'Send your MT5 account number to the Telegram bot.',
      review_mt5: 'Our team is checking your MT5 account.',
      build: 'Your bot file is being prepared. It arrives in the Telegram chat.',
      active: 'Your bot was delivered in the Telegram chat.',
    };
    function renderOrder() {
      const box = $('[data-order]', root);
      const at = ORDER_STEP[profile.bot_stage];
      if (!profile.bot_tg_id || !at) {
        box.hidden = true;
        return;
      }
      const plan = PLAN_NAMES[profile.bot_plan] ? profile.bot_plan : null;
      const needs = ORDER_NEEDS[plan] || { broker: true, pay: true };
      const steps = [
        ['plan', plan && at !== 'plan' ? `Plan: ${PLAN_NAMES[plan]}` : 'Choose a plan'],
        needs.broker && ['broker', 'Broker account'],
        needs.pay && ['pay', 'Payment'],
        ['mt5', 'MT5 account'],
        ['bot', 'Bot delivered'],
      ].filter(Boolean);
      const now = at === 'done' ? steps.length : steps.findIndex(([key]) => key === at);
      const waiting = /^review_/.test(profile.bot_stage); // our team is checking: nothing for the person to do
      $('[data-order-steps]', box).replaceChildren(...steps.map(([, label], index) => {
        const item = document.createElement('li');
        const state = index < now ? 'done' : index === now ? 'now' : 'todo';
        item.dataset.state = state;
        item.textContent = label;
        if (state !== 'todo') {
          const tag = document.createElement('small');
          tag.textContent = state === 'done' ? 'Done' : waiting ? 'Checking' : 'Now';
          item.append(tag);
          if (state === 'now') item.setAttribute('aria-current', 'step');
        }
        return item;
      }));
      $('[data-order-note]', box).textContent = ORDER_NOTE[profile.bot_stage];
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
    const tradingForm = $('[data-trading-form]');
    const passwordForm = $('[data-password-form]');

    // fill the forms with what is on file
    const country = profileForm.elements.country;
    fillCountries(country);
    const savedCountry = stored('country');
    if (savedCountry && ![...country.options].some((option) => option.value === savedCountry)) {
      country.add(new Option(savedCountry, savedCountry));
    }
    country.value = savedCountry;
    profileForm.elements.full_name.value = stored('full_name');
    profileForm.elements.username.value = stored('username');
    profileForm.elements.phone.value = stored('phone');
    profileForm.elements.telegram_username.value = stored('telegram_username');
    tradingForm.elements.mt5_account.value = stored('mt5_account');
    tradingForm.elements.broker.value = stored('broker');

    renderHeader();
    renderInfo();
    renderPlan();
    renderOrder();
    renderLog();
    root.setAttribute('aria-busy', 'false');

    // Right after sign-up (the email was just confirmed) the next step is the Telegram bot: offer it once.
    // The button carries the one-time code, so the bot connects this account by itself.
    const welcome = $('[data-welcome-dialog]', root);
    $('[data-welcome-later]', welcome).addEventListener('click', () => welcome.close());
    $('[data-welcome-go]', welcome).addEventListener('click', () => welcome.close());
    refreshLinkCode().then(() => {
      if (arrivedFrom === 'signup' && !profile.bot_tg_id) welcome.showModal();
    });
    setInterval(refreshLinkCode, 45 * 60 * 1000); // a code is good for 2 hours

    // The Telegram bot writes each step here as it happens (account connected, broker confirmed, payment
    // received, bot delivered). The dashboard looks again every 20 seconds while it is on screen, and at once
    // when the person comes back to this tab, and redraws only when something changed.
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
    setInterval(refreshProfile, 20000);
    document.addEventListener('visibilitychange', refreshProfile);

    wireSaveForm(profileForm, () => ({
      full_name: profileForm.elements.full_name.value.trim(),
      username: profileForm.elements.username.value.trim(),
      country: country.value,
      phone: profileForm.elements.phone.value.trim(),
      telegram_username: profileForm.elements.telegram_username.value.trim().replace(/^@/, ''),
    }), 'Profile saved.');

    wireSaveForm(tradingForm, () => ({
      mt5_account: tradingForm.elements.mt5_account.value.replace(/\D/g, ''),
      broker: tradingForm.elements.broker.value.trim(),
    }), 'Trading account saved.');

    wireSaveForm(passwordForm, () => ({ password: passwordForm.elements.new_password.value }), 'Password updated.');

    /* ----- session ----- */
    // Signing out asks first, like the power button of the control app: "Do you want to sign out?"  No / Yes
    const confirmBox = $('[data-sign-out-dialog]');
    const confirmMsg = $('[data-sign-out-msg]', confirmBox);
    $$('[data-sign-out]').forEach((button) => button.addEventListener('click', () => {
      confirmMsg.hidden = true;
      confirmBox.showModal(); // the browser puts the cursor on "No" and gives it back when the box closes
    }));
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
      location.replace('index.html'); // signed out: back to the home page
    });

    const others = $('[data-sign-out-others]');
    others.addEventListener('click', async () => {
      setBusy(others, true);
      const { error } = await db.auth.signOut({ scope: 'others' });
      setBusy(others, false);
      const line = $('[data-session-msg]');
      line.textContent = error ? friendlyError(error) : 'Your other devices are signed out.';
      line.dataset.tone = error ? 'error' : 'success';
      line.hidden = false;
    });

    // signed out in another tab
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('index.html');
    });
  }

  ({ login: initLogin, signup: initSignup, reset: initReset, dashboard: initDashboard }[page] || (() => {}))();
})();
