// Live partner figures from the three brokers. Each function returns null when its broker can't be reached,
// so the statement still goes out.

// Exness: the official partner API (my.exness.partners), signed in with the partner login kept in the vault
// (exness_login / exness_password).
const API = 'https://my.exness.partners/api';

const iso = (d) => d.toISOString().slice(0, 10);

// Brokers' servers sometimes drop a connection; try a request once more before giving up.
async function fetch(url, options) {
  try {
    return await globalThis.fetch(url, options);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return globalThis.fetch(url, options);
  }
}

export async function exnessFigures(login, password, today) {
  if (!login || !password) return null;
  try {
    const auth = await fetch(`${API}/v2/auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    if (!auth.ok) throw new Error(`auth ${auth.status}`);
    const { token } = await auth.json();
    const get = async (path) => {
      const res = await fetch(API + path, { headers: { Authorization: `JWT ${token}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    };

    const end = new Date(`${today}T00:00:00Z`);
    const dayAgo = iso(new Date(end.getTime() - 86400000));
    const monthAgo = iso(new Date(end.getTime() - 30 * 86400000));
    const [accounts, rewardDay, rewardMonth] = await Promise.all([
      get('/reports/clients/accounts/?limit=1000'),
      get(`/reports/rewards/?reward_date_from=${dayAgo}&reward_date_to=${today}`),
      get(`/reports/rewards/?reward_date_from=${monthAgo}&reward_date_to=${today}`),
    ]);
    const rows = accounts.data || [];
    return {
      clients: Number(accounts.totals?.clients_count ?? new Set(rows.map((a) => a.client_uid)).size),
      accounts: Number(accounts.totals?.count ?? rows.length),
      new_accounts: rows.filter((a) => (a.client_account_created || '') >= dayAgo).length,
      traded_accounts: rows.filter((a) => a.client_account_last_trade).length,
      volume_lots_30d: Number(rewardMonth.totals?.volume_lots ?? 0),
      reward_day: Number(rewardDay.totals?.reward_usd ?? 0),
      reward_30d: Number(rewardMonth.totals?.reward_usd ?? 0),
    };
  } catch (error) {
    console.error('exness', error);
    return null;
  }
}

// Live figures from the Lirunex partner portal (client.lirunex.com). The portal runs on the RocksAcademy fxCRM,
// so this signs in the way the portal does (vault: lirunex_login / lirunex_password).
const LIRUNEX = 'https://crmapi3.rocksacademy.com/';
const LIRUNEX_HEADERS = { Accept: 'application/json', Origin: 'https://client.lirunex.com', Referer: 'https://client.lirunex.com/' };

export async function lirunexFigures(login, password, today) {
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
    const monthStart = `${today.slice(0, 8)}01T00:00:00.000Z`;
    const end = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString();
    const range = `start=0&length=100&startDate=${monthStart}&endDate=${end}&introducingBrokerId=${ib}`;
    const [turnover, rebate] = await Promise.all([
      get(`api/contact/GetClientsMonthlyTurnoverReport?${range}`),
      get(`api/referrer/GetMonthlyRebateEarningReport?${range}`),
    ]);
    const month = turnover?.data?.[0] || {};
    return {
      clients: Number(month.totalClient ?? rebate?.data?.[0]?.totalClient ?? 0),
      sub_partners: Number(rebate?.data?.[0]?.totalSubPartner ?? 0),
      deposit_month: Number(month.deposit ?? 0),
      net_deposit_month: Number(month.nettDeposit ?? 0),
      earnings_month: Number(month.totalEarnings ?? rebate?.data?.[0]?.totalEarning ?? 0),
    };
  } catch (error) {
    console.error('lirunex', error);
    return null;
  }
}

// Live figures from the Investizo partner area (investizo-ib.com), signed in the way the site does
// (vault: investizo_login / investizo_password); the site sends its token in an x-api-key header.
const INVESTIZO = 'https://invest-api.com/v3';
const INVESTIZO_HEADERS = { Accept: 'application/json', Origin: 'https://investizo-ib.com', Referer: 'https://investizo-ib.com/' };

export async function investizoFigures(login, password) {
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

    const [analytics, totals, init] = await Promise.all([
      get('/affiliate-commission/get-analytics'),
      get('/affiliate-dashboard/get-total?chart=1'),
      get('/affiliate/get-init'),
    ]);
    const dyn = analytics?.dynamic || {};
    return {
      registrations: Number(totals?.registrations?.current ?? 0),
      active_clients: Number(totals?.active?.current ?? 0),
      trades: Number(totals?.trading?.trades ?? 0),
      volume_lots: Number(totals?.trading?.current ?? 0),
      commission_today: Number(dyn.today ?? 0),
      commission_yesterday: Number(dyn.yesterday ?? 0),
      commission_7d: Number(dyn.day_7 ?? 0),
      commission_30d: Number(dyn.day_30 ?? 0),
      commission_total: (analytics?.levels || []).reduce((sum, l) => sum + Number(l.commission || 0), 0),
      balance: Number(init?.balance ?? 0),
    };
  } catch (error) {
    console.error('investizo', error);
    return null;
  }
}
