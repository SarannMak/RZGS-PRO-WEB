// Live partner figures from the three brokers for one statement period (from / to are dates, both included).
// Each returns { clients, active, inactive, trades, commission }; a figure the broker doesn't report is null,
// and the whole result is null when the broker can't be reached, so the statement still goes out.

// Brokers' servers sometimes drop a connection; try a request once more before giving up.
async function fetch(url, options) {
  try {
    return await globalThis.fetch(url, options);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return globalThis.fetch(url, options);
  }
}

const withInactive = (f) => ({ ...f, inactive: f.active == null ? null : Math.max(0, f.clients - f.active) });

// Exness: the official partner API (my.exness.partners), signed in with the partner login kept in the vault
// (exness_login / exness_password).
const EXNESS = 'https://my.exness.partners/api';

export async function exnessFigures(login, password, from, to) {
  if (!login || !password) return null;
  try {
    const auth = await fetch(`${EXNESS}/v2/auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    if (!auth.ok) throw new Error(`auth ${auth.status}`);
    const { token } = await auth.json();
    const get = async (path) => {
      const res = await fetch(EXNESS + path, { headers: { Authorization: `JWT ${token}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    };

    const [accounts, rewards] = await Promise.all([
      get('/reports/clients/accounts/?limit=1000'),
      get(`/reports/rewards/?reward_date_from=${from}&reward_date_to=${to}`),
    ]);
    const rows = accounts.data || [];
    const traded = new Set(rows.filter((a) => (a.client_account_last_trade || '').slice(0, 10) >= from).map((a) => a.client_uid));
    return withInactive({
      clients: Number(accounts.totals?.clients_count ?? new Set(rows.map((a) => a.client_uid)).size),
      active: traded.size,
      trades: Number(rewards.totals?.orders_count ?? 0),
      commission: Number(rewards.totals?.reward_usd ?? 0),
    });
  } catch (error) {
    console.error('exness', error);
    return null;
  }
}

// Lirunex partner portal (client.lirunex.com). The portal runs on the RocksAcademy fxCRM,
// so this signs in the way the portal does (vault: lirunex_login / lirunex_password).
const LIRUNEX = 'https://crmapi3.rocksacademy.com/';
const LIRUNEX_HEADERS = { Accept: 'application/json', Origin: 'https://client.lirunex.com', Referer: 'https://client.lirunex.com/' };

export async function lirunexFigures(login, password, from, to) {
  if (!login || !password) return null;
  try {
    const auth = await fetch(LIRUNEX + 'api/Token', {
      method: 'POST',
      headers: { ...LIRUNEX_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: login.trim(), password, clientPortalUrl: 'https://client.lirunex.com', emailOTP: null }),
    });
    if (!auth.ok) throw new Error(`auth ${auth.status}`);
    const token = (await auth.json()).token?.access_token;
    if (!token) throw new Error('no token');
    const get = async (path) => {
      const res = await fetch(LIRUNEX + path, { headers: { ...LIRUNEX_HEADERS, Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(`${path} ${res.status}`);
      return body.data;
    };

    const ib = (await get('api/referrer/GetIntroducingBrokerList'))?.[0]?.id;
    if (!ib) throw new Error('no IB account');
    const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString();
    const monthStart = `${to.slice(0, 8)}01T00:00:00.000Z`;
    const [turnover, rebates] = await Promise.all([
      get(`api/contact/GetClientsMonthlyTurnoverReport?start=0&length=100&startDate=${monthStart}&endDate=${end}&introducingBrokerId=${ib}`),
      get(`api/referrer/GetRebateEarningReport?start=0&length=1000&startDate=${from}T00:00:00.000Z&endDate=${end}&introducingBrokerId=${ib}`),
    ]);
    // Rebate lines for the period; the amount field is the first numeric one named like rebate/earning/amount.
    const lines = rebates?.data || [];
    const amountKey = lines.length ? Object.keys(lines[0]).find((k) => /rebate|earning|amount|commission/i.test(k) && typeof lines[0][k] === 'number') : null;
    const commission = lines.length ? (amountKey ? lines.reduce((sum, l) => sum + Number(l[amountKey] || 0), 0) : null) : 0;
    return withInactive({
      clients: Number(turnover?.data?.[0]?.totalClient ?? 0),
      active: null,
      trades: null,
      commission,
    });
  } catch (error) {
    console.error('lirunex', error);
    return null;
  }
}

// Investizo partner area (investizo-ib.com), signed in the way the site does
// (vault: investizo_login / investizo_password); the site sends its token in an x-api-key header.
const INVESTIZO = 'https://invest-api.com/v3';
const INVESTIZO_HEADERS = { Accept: 'application/json', Origin: 'https://investizo-ib.com', Referer: 'https://investizo-ib.com/' };

export async function investizoFigures(login, password, from, to) {
  if (!login || !password) return null;
  try {
    const auth = await fetch(`${INVESTIZO}/login`, {
      method: 'POST',
      headers: { ...INVESTIZO_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    const token = (await auth.json().catch(() => null))?.data?.auth?.token;
    if (!auth.ok || !token) throw new Error(`auth ${auth.status}`);
    const get = async (path) => {
      const res = await fetch(`${INVESTIZO}${path}${path.includes('?') ? '&' : '?'}_lang=en`, { headers: { ...INVESTIZO_HEADERS, 'x-api-key': token } });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status === 'error') throw new Error(`${path} ${res.status}`);
      return body.data;
    };

    const range = `dateFrom=${from}&dateTo=${to}`;
    const [allTime, period, levels] = await Promise.all([
      get('/affiliate-dashboard/get-total?chart=1'),
      get(`/affiliate-dashboard/get-total?chart=1&${range}`),
      get(`/affiliate-commission/get-levels?${range}`),
    ]);
    const lv = Array.isArray(levels) ? levels : [];
    return withInactive({
      clients: Number(allTime?.registrations?.current ?? 0),
      active: Number(period?.active?.current ?? 0),
      trades: lv.reduce((sum, l) => sum + Number(l.trades || 0), 0),
      commission: lv.reduce((sum, l) => sum + Number(l.commission || 0), 0),
    });
  } catch (error) {
    console.error('investizo', error);
    return null;
  }
}
