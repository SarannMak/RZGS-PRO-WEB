/* ==========================================================================
   RZGS-PRO: the owner's page (rzgspro.com/admin). Shows the orders a person has
   to decide, with Approve and Refuse, and the latest orders. Only the website
   account named in rz_config (checkout_admins) gets an answer from the server.
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
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const $ = (selector) => document.querySelector(selector);

  async function call(action, fields = {}) {
    const { data } = await db.auth.getSession();
    if (!data.session) { location.replace('login'); return new Promise(() => {}); }
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ action, ...fields }),
    });
    return response.json();
  }

  function card(order) {
    const email = order.web_users ? order.web_users.email : '';
    return `<article class="adm-card" data-order="${order.id}">
      <h3>${STEP_NAMES[order.review_from] || 'Order'}: ${PLAN_NAMES[order.plan]}${Number(order.amount) > 0 ? ` $${Number(order.amount)}` : ''}</h3>
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

  async function load() {
    const data = await call('admin_list');
    if (!data.ok) {
      $('[data-adm-status]').textContent = data.code === 'not_admin'
        ? 'This page is for the owner of the site.'
        : 'The list could not be loaded. Is the "checkout" function deployed?';
      return;
    }
    const { status } = data;
    const files = (data.files || []).length;
    $('[data-adm-status]').textContent = [
      status.bakong_on ? `Bakong on: ${status.bakong_used} of ${status.bakong_day} checks used today` : 'Bakong is OFF on the website server',
      `${files} of 7 bot files`,
      status.secret ? 'Bot Passwords can be made' : 'The licence secret is MISSING',
    ].join(' · ');
    document.querySelectorAll('[data-adm-area]').forEach((area) => { area.hidden = false; });
    $('[data-adm-waiting]').innerHTML = data.waiting.length ? data.waiting.map(card).join('') : '<p class="adm-empty">Nothing is waiting for you.</p>';
    $('[data-adm-recent]').innerHTML = data.recent.map((order) => `<tr>
      <td>${when(order.created_at)}</td>
      <td>${esc(order.web_users ? order.web_users.email : '')}</td>
      <td>${PLAN_NAMES[order.plan]}</td>
      <td>${esc(BROKER_NAMES[order.broker] || order.broker || '-')}</td>
      <td>${esc(order.mt5 || '-')}</td>
      <td>${order.tx ? `$${Number(order.amount)}` : '-'}</td>
      <td>${STAGE_NAMES[order.stage] || esc(order.stage)}</td>
    </tr>`).join('');
  }

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
    setTimeout(load, result.ok ? 0 : 1800);
  });

  load();
  setInterval(() => { if (!document.hidden && !document.querySelector('.adm-note:focus')) load(); }, 30000);
})();
