// Live figures from the Exness partner API (my.exness.partners), signed in with the partner login kept in the vault
// (exness_login / exness_password). Returns null when Exness can't be reached, so the statement still goes out.
const API = 'https://my.exness.partners/api';

const iso = (d) => d.toISOString().slice(0, 10);

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
