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
  const longDate = (value) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  // Small "Saved." / error line next to a form's own button.
  function formMessage(form, text, tone) {
    const line = $('[data-form-msg]', form);
    clearTimeout(line.hideTimer);
    line.textContent = text;
    line.dataset.tone = tone;
    line.hidden = false;
    if (tone === 'success') line.hideTimer = setTimeout(() => { line.hidden = true; }, 4000);
  }

  // The plan and its end date are set by the site owner in the web_users table.
  // With no plan on file, the card keeps the "get started" content written in the page.
  function renderPlan(card, profile) {
    const plan = PLAN_NAMES[profile.plan] ? profile.plan : null;
    if (!plan) return;

    const ends = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
    const daysLeft = ends ? Math.ceil((ends - Date.now()) / 86400000) : null;
    const status = $('[data-plan-status]', card);
    const action = $('[data-plan-action]', card);
    const secondary = $('[data-plan-secondary]', card);
    let note = 'Your plan is active.';

    if (ends && daysLeft <= 0) {
      status.textContent = 'Expired';
      status.dataset.tone = 'bad';
      note = `Ended on ${longDate(ends)}. Renew to keep the bot running.`;
    } else if (ends && daysLeft <= 3) {
      status.textContent = daysLeft === 1 ? 'Ends tomorrow' : `Ends in ${daysLeft} days`;
      status.dataset.tone = 'warn';
      note = `Valid until ${longDate(ends)}. Renew now to avoid a break.`;
    } else {
      status.textContent = 'Active';
      status.dataset.tone = 'good';
      if (ends) note = `Valid until ${longDate(ends)}.`;
    }
    status.hidden = false;
    $('[data-plan-name]', card).textContent = PLAN_NAMES[plan];
    $('[data-plan-note]', card).textContent = note;

    if (plan === 'trial') {
      action.textContent = 'Choose a plan';
      action.href = 'index.html#pricing';
      secondary.hidden = true;
    } else {
      action.textContent = 'Renew plan';
      action.href = card.dataset[`link${plan.charAt(0).toUpperCase()}${plan.slice(1)}`] || 'index.html#pricing';
      secondary.hidden = false;
    }
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
    let profile = {};
    try {
      const { data } = await db
        .from('web_users')
        .select('full_name, username, email, country, phone, telegram_username, mt5_account, broker, plan, plan_expires_at')
        .eq('id', user.id)
        .maybeSingle();
      if (data) profile = data;
    } catch (e) { /* fall back to what the sign-up itself stored */ }

    const stored = (key) => profile[key] || (user.user_metadata || {})[key] || '';

    function renderHeader() {
      const name = stored('full_name') || stored('username') || 'RZGS-PRO member';
      const email = profile.email || user.email || '';
      $('[data-dash-name]').textContent = name.trim().split(/\s+/)[0];
      $('[data-dash-avatar]').textContent = name.trim().charAt(0).toUpperCase() || 'R';
      $('[data-dash-email]').textContent = email;
      $('[data-dash-email-row]').textContent = email;
    }

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
    renderPlan($('[data-plan-card]'), profile);
    root.setAttribute('aria-busy', 'false');

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

    const signOut = $('[data-sign-out]');
    signOut.addEventListener('click', async () => {
      signOut.disabled = true;
      await db.auth.signOut();
      location.replace('login.html?signedout=1');
    });

    // signed out in another tab
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('login.html?signedout=1');
    });
  }

  ({ login: initLogin, signup: initSignup, reset: initReset, dashboard: initDashboard }[page] || (() => {}))();
})();
