// Builds the daily statement as a plain, printable Excel sheet (A4), from rz_statement_data().
// Page header like a bank statement: RZGS-PRO / rzgspro.com | Daily Statement Report | Date / STMT No.
import ExcelJS from 'exceljs';

const FONT = 'Arial';
const TEAL = 'FF0E4C44';
const BAND = 'FFEEF6F4';
const LINE = { style: 'thin', color: { argb: 'FFBFD8D3' } };
const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const MONEY = '$#,##0.00;($#,##0.00);"-"';

// Returns the ExcelJS workbook; write it with wb.xlsx.writeBuffer(), print it with statement-pdf.js.
export function buildStatement(d, stmtNo) {
  const [y, m, day] = d.date.split('-');
  const date = `${day}/${m}/${y}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RZGS-PRO';
  const ws = wb.addWorksheet('Statement', {
    views: [{ style: 'pageLayout', showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.9, bottom: 0.7, header: 0.35, footer: 0.3 } },
    headerFooter: {
      oddHeader: `&L&"Arial"&10RZGS-PRO\nrzgspro.com&C&"Arial"&10Daily Statement Report&R&"Arial"&10Date: ${date}\nSTMT No: ${stmtNo}`,
      oddFooter: '&L&"Arial"&8Generated automatically by RZGS-PRO&R&"Arial"&8Page &P of &N',
    },
  });
  ws.columns = [{ width: 7 }, { width: 38 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 16 }];

  const cell = (r, c) => ws.getCell(r, c);
  let r = 1;

  function title(text) {
    r += 1;
    ws.mergeCells(r, 1, r, 6);
    const c = cell(r, 1);
    c.value = text;
    c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    c.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(r).height = 20;
    r += 1;
  }
  // heads: [text, from col, to col, align]
  function head(heads) {
    for (const [text, a, b, align] of heads) {
      if (b > a) ws.mergeCells(r, a, r, b);
      const c = cell(r, a);
      c.value = text;
      c.font = { name: FONT, bold: true, size: 9, color: { argb: 'FF44615C' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      c.alignment = { horizontal: align || 'left', vertical: 'middle' };
    }
    for (let k = 1; k <= 6; k++) cell(r, k).border = BOX;
    r += 1;
  }
  // vals: [value, from col, to col, { money, bold, align, pct }]
  function row(vals, { strong = false } = {}) {
    for (const [v, a, b, o = {}] of vals) {
      if (b > a) ws.mergeCells(r, a, r, b);
      const c = cell(r, a);
      c.value = v ?? '-';
      c.font = { name: FONT, size: 10, bold: strong || o.bold };
      c.alignment = { horizontal: o.align || (a === 1 ? 'center' : a === 2 ? 'left' : 'right'), vertical: 'middle' };
      if (o.money) c.numFmt = MONEY;
      if (o.pct) c.numFmt = '0.0%';
      if (strong) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8EFEA' } };
    }
    for (let k = 1; k <= 6; k++) cell(r, k).border = BOX;
    ws.getRow(r).height = 17;
    return r++;
  }
  const f = (formula, result) => ({ formula, result });

  // heading block
  ws.mergeCells(r, 1, r, 6);
  cell(r, 1).value = 'DAILY STATEMENT REPORT';
  cell(r, 1).font = { name: FONT, bold: true, size: 15, color: { argb: TEAL } };
  r += 1;
  ws.mergeCells(r, 1, r, 6);
  cell(r, 1).value = `Statement date ${date}   ·   Day = last 24 hours   ·   Income = last 30 days`;
  cell(r, 1).font = { name: FONT, size: 9, color: { argb: 'FF666666' } };

  // 1. summary
  const growth = d.users_yesterday ? d.signup_today / d.users_yesterday : 0;
  title('SUMMARY');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Value', 3, 6, 'right']]);
  const sumIncome = row([[1, 1, 1], ['Total income (net, last 30 days)', 2, 2], [null, 3, 6, { money: true }]]);
  row([[2, 1, 1], ['Active bots (running / total)', 2, 2], [`${d.bots_running} / ${d.bots_total}`, 3, 6]]);
  row([[3, 1, 1], ['Total users', 2, 2], [d.users_total, 3, 6]]);
  row([[4, 1, 1], ["Today's growth (new users vs yesterday)", 2, 2], [growth, 3, 6, { pct: true }]]);

  // 2. income statement
  const p = d.plans || {};
  title('INCOME STATEMENT');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Users', 3, 4, 'right'], ['Amount (USD)', 5, 6, 'right']]);
  const r2 = r + 1, r3 = r + 2, r5 = r + 4, r7 = r + 6;
  row([[1, 1, 1], ['Sales (all plan orders)', 2, 2], [f(`C${r2}+C${r3}`, d.orders), 3, 4], [f(`E${r2}+E${r3}`, d.orders_value), 5, 6, { money: true }]]);
  row([[2, 1, 1], ['Completed (bot delivered)', 2, 2], [f(`SUM(C${r5}:C${r7})`, d.done), 3, 4], [f(`SUM(E${r5}:E${r7})`, d.done_value), 5, 6, { money: true }]]);
  row([[3, 1, 1], ['Incomplete (not finished)', 2, 2], [d.open, 3, 4], [d.open_value, 5, 6, { money: true }]]);
  const net = row([[4, 1, 1], ['Net Income (completed sales)', 2, 2], [f(`C${r2}`, d.done), 3, 4], [f(`E${r2}`, d.done_value), 5, 6, { money: true }]], { strong: true });
  row([[5, 1, 1], ['Free (Trial plan, $0)', 2, 2], [p.trial?.users ?? 0, 3, 4], [p.trial?.usd ?? 0, 5, 6, { money: true }]]);
  row([[6, 1, 1], ['Elite ($5 plan)', 2, 2], [p.elite?.users ?? 0, 3, 4], [p.elite?.usd ?? 0, 5, 6, { money: true }]]);
  row([[7, 1, 1], ['Diamond ($49 plan)', 2, 2], [p.diamond?.users ?? 0, 3, 4], [p.diamond?.usd ?? 0, 5, 6, { money: true }]]);
  cell(sumIncome, 3).value = f(`E${net}`, d.done_value);

  // 3. registration
  const b = d.brokers || {};
  title('USER REGISTRATION & STATUS');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Today', 3, 4, 'right'], ['Total', 5, 6, 'right']]);
  row([[1, 1, 1], ['Sign Up', 2, 2], [d.signup_today, 3, 4], [d.users_total, 5, 6]]);
  row([[2, 1, 1], ['Register (Broker)', 2, 2], [d.broker_today, 3, 4], [d.broker_users, 5, 6]]);
  ['Lirunex', 'Exness', 'Investizo'].forEach((n, i) => row([[3 + i, 1, 1], [n, 2, 2], [b[n]?.today ?? 0, 3, 4], [b[n]?.users ?? 0, 5, 6]]));

  // 4. bot & user activity
  title('BOT & USER ACTIVITY');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Count', 3, 6, 'right']]);
  [['Login Back (last 24 h)', d.login_today], ['Active User (signed in within 30 days)', d.active_users],
    ['Inactive User (no sign-in for 30 days)', d.inactive_users], ['Complete Bot (bot delivered)', d.done],
    ['Incomplete Bot (not finished)', d.open]].forEach(([t, v], i) => row([[i + 1, 1, 1], [t, 2, 2], [v, 3, 6]]));

  // 5. website traffic
  const t = d.traffic || {};
  title('WEBSITE TRAFFIC');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Day', 3, 3, 'right'], ['Week', 4, 4, 'right'], ['Month', 5, 6, 'right']]);
  [['Visitors', 'visitors'], ['Page views', 'views'], ['Interested (bot & plan clicks)', 'interested'],
    ['Referral clicks (broker links)', 'referral'], ['Other (Telegram group)', 'other']].forEach(([label, k], i) => {
    const v = t[k] || [0, 0, 0];
    row([[i + 1, 1, 1], [label, 2, 2], [v[0], 3, 3], [v[1], 4, 4], [v[2], 5, 6]]);
  });

  // 6. broker partner accounts, read live from each broker's partner area every morning
  const ex = d.exness, li = d.lirunex, iz = d.investizo;
  const live = (heading, figures, rows) => {
    title(heading);
    head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Value', 3, 6, 'right']]);
    if (!figures) return row([[1, 1, 1], ['Could not be reached this morning', 2, 2], ['-', 3, 6]]);
    rows.forEach(([label, v, money], i) => row([[i + 1, 1, 1], [label, 2, 2], [v, 3, 6, { money }]]));
  };
  live('EXNESS PARTNER (live from my.exness.partners)', ex, ex && [
    ['Clients', ex.clients], ['Trading accounts', ex.accounts], ['New accounts (last 24 h)', ex.new_accounts],
    ['Accounts that have traded', ex.traded_accounts], ['Volume, last 30 days (lots)', ex.volume_lots_30d],
    ['Reward, last 24 h', ex.reward_day, true], ['Reward, last 30 days', ex.reward_30d, true]]);
  live('LIRUNEX PARTNER (live from client.lirunex.com)', li, li && [
    ['Clients', li.clients], ['Sub-partners', li.sub_partners], ['Client deposits, this month', li.deposit_month, true],
    ['Net deposits, this month', li.net_deposit_month, true], ['Earnings, this month', li.earnings_month, true]]);
  live('INVESTIZO PARTNER (live from investizo-ib.com)', iz, iz && [
    ['Registrations', iz.registrations], ['Active clients', iz.active_clients], ['Trades', iz.trades],
    ['Volume (lots)', iz.volume_lots], ['Commission, today', iz.commission_today, true],
    ['Commission, last 30 days', iz.commission_30d, true], ['Commission, all time', iz.commission_total, true],
    ['Balance not yet paid out', iz.balance, true]]);

  // 7. income from broker
  title('INCOME FROM BROKER');
  head([['No.', 1, 1, 'center'], ['Broker (period)', 2, 2], ['Clients', 3, 4, 'right'], ['Net Commission', 5, 6, 'right']]);
  const firstBroker = r;
  row([[1, 1, 1], ['Exness (last 30 days)', 2, 2], [ex ? ex.clients : '-', 3, 4], [ex ? ex.reward_30d : '-', 5, 6, { money: true }]]);
  row([[2, 1, 1], ['Lirunex (this month)', 2, 2], [li ? li.clients : '-', 3, 4], [li ? li.earnings_month : '-', 5, 6, { money: true }]]);
  row([[3, 1, 1], ['Investizo (last 30 days)', 2, 2], [iz ? iz.registrations : '-', 3, 4], [iz ? iz.commission_30d : '-', 5, 6, { money: true }]]);
  const totalBroker = [ex?.reward_30d, li?.earnings_month, iz?.commission_30d].reduce((sum, v) => sum + (Number(v) || 0), 0);
  row([[4, 1, 1], ['Total broker commission', 2, 2], ['', 3, 4], [f(`SUM(E${firstBroker}:E${r - 1})`, totalBroker), 5, 6, { money: true }]], { strong: true });

  // notes
  r += 1;
  for (const note of [
    'Notes:',
    'Income statement amounts are worked out from plan prices: Trial $0, Elite $5, Diamond $49 per month.',
    'Broker figures are read live each morning from the Exness, Lirunex and Investizo partner areas.',
    'User Registration (brokers) counts RZGS-PRO customers by the broker they chose in the Telegram bot.',
  ]) {
    ws.mergeCells(r, 1, r, 6);
    cell(r, 1).value = note;
    cell(r, 1).font = { name: FONT, size: 8, italic: note !== 'Notes:', bold: note === 'Notes:', color: { argb: 'FF666666' } };
    r += 1;
  }

  ws.pageSetup.printArea = `A1:F${r - 1}`;
  return wb;
}
