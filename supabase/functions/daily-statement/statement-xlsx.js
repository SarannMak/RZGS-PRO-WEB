// Builds the daily, weekly or monthly statement as a plain, printable Excel sheet (A4), from rz_period_data()
// plus the live broker figures. Every figure covers the statement period unless its label says otherwise.
// Page header like a bank statement: RZGS-PRO / rzgspro.com | <Kind> Statement Report | Date / STMT No.
import ExcelJS from 'exceljs';

const FONT = 'Arial';
const TEAL = 'FF0E4C44';
const BAND = 'FFEEF6F4';
const LINE = { style: 'thin', color: { argb: 'FFBFD8D3' } };
const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const MONEY = '$#,##0.00;($#,##0.00);$0.00';
const KIND = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const PERIOD = { daily: 'today', weekly: 'this week', monthly: 'this month' };

const dmy = (iso) => iso.split('-').reverse().join('/');

// Returns the ExcelJS workbook; write it with wb.xlsx.writeBuffer(), print it with statement-pdf.js.
export function buildStatement(d, stmtNo) {
  const kind = KIND[d.kind] || 'Daily';
  const period = d.from === d.to ? dmy(d.from) : `${dmy(d.from)} - ${dmy(d.to)}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RZGS-PRO';
  const ws = wb.addWorksheet('Statement', {
    views: [{ style: 'pageLayout', showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.9, bottom: 0.7, header: 0.35, footer: 0.3 } },
    headerFooter: {
      oddHeader: `&L&"Arial"&10RZGS-PRO\nrzgspro.com&C&"Arial"&10${kind} Statement Report&R&"Arial"&10Date: ${dmy(d.date)}\nSTMT No: ${stmtNo}`,
      oddFooter: '&L&"Arial"&8Generated automatically by RZGS-PRO&R&"Arial"&8Page &P of &N',
    },
  });
  ws.columns = [{ width: 6 }, { width: 34 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];

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
  // vals: [value, from col, to col, { money, pct }]
  function row(vals, { strong = false } = {}) {
    for (const [v, a, b, o = {}] of vals) {
      if (b > a) ws.mergeCells(r, a, r, b);
      const c = cell(r, a);
      c.value = v ?? '-';
      c.font = { name: FONT, size: 10, bold: strong };
      c.alignment = { horizontal: a === 1 ? 'center' : a === 2 ? 'left' : 'right', vertical: 'middle' };
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
  cell(r, 1).value = `${kind.toUpperCase()} STATEMENT REPORT`;
  cell(r, 1).font = { name: FONT, bold: true, size: 15, color: { argb: TEAL } };
  r += 1;
  ws.mergeCells(r, 1, r, 6);
  cell(r, 1).value = `Period: ${period}   ·   All figures are for this period unless marked "total"`;
  cell(r, 1).font = { name: FONT, size: 9, color: { argb: 'FF666666' } };

  const brokers = [['Exness', d.exness], ['Lirunex', d.lirunex], ['Investizo', d.investizo]];
  const brokerCommission = brokers.reduce((sum, [, b]) => sum + (Number(b?.commission) || 0), 0);
  const netIncome = Number(d.plan_income || 0) + brokerCommission;
  const growth = d.signup_prev ? (d.signup - d.signup_prev) / d.signup_prev : 0;

  // 1. summary
  title('SUMMARY');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Value', 3, 6, 'right']]);
  const summaryNet = row([[1, 1, 1], [`Net income (${PERIOD[d.kind]})`, 2, 2], [netIncome, 3, 6, { money: true }]]);
  row([[2, 1, 1], ['New users', 2, 2], [d.signup, 3, 6]]);
  row([[3, 1, 1], ['Total users (total)', 2, 2], [d.users_total, 3, 6]]);
  row([[4, 1, 1], ['Active bots (running / total)', 2, 2], [`${d.bots_running} / ${d.bots_total}`, 3, 6]]);
  row([[5, 1, 1], [`New users vs previous ${d.kind === 'daily' ? 'day' : d.kind === 'weekly' ? 'week' : 'month'}`, 2, 2], [growth, 3, 6, { pct: true }]]);

  // 2. income statement: counts, and one amount, the net income
  const p = d.plans || {};
  title('INCOME STATEMENT');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Count', 3, 4, 'right'], ['Amount (USD)', 5, 6, 'right']]);
  row([[1, 1, 1], ['Sales (plan orders)', 2, 2], [d.orders, 3, 4], ['', 5, 6]]);
  row([[2, 1, 1], ['Completed (bot delivered)', 2, 2], [d.done, 3, 4], ['', 5, 6]]);
  row([[3, 1, 1], ['Incomplete (not finished)', 2, 2], [d.open, 3, 4], ['', 5, 6]]);
  row([[4, 1, 1], ['Free (Trial plan)', 2, 2], [p.trial ?? 0, 3, 4], ['', 5, 6]]);
  row([[5, 1, 1], ['Elite ($5 plan)', 2, 2], [p.elite ?? 0, 3, 4], ['', 5, 6]]);
  row([[6, 1, 1], ['Diamond ($49 plan)', 2, 2], [p.diamond ?? 0, 3, 4], ['', 5, 6]]);
  const net = row([[7, 1, 1], ['Net Income', 2, 2], ['', 3, 4], [netIncome, 5, 6, { money: true }]], { strong: true });

  // 3. registration
  const b = d.brokers || {};
  title('USER REGISTRATION & STATUS');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['This period', 3, 4, 'right'], ['Total', 5, 6, 'right']]);
  row([[1, 1, 1], ['Sign Up', 2, 2], [d.signup, 3, 4], [d.users_total, 5, 6]]);
  row([[2, 1, 1], ['Register (Broker)', 2, 2], [d.broker_regs, 3, 4], [d.broker_regs_total, 5, 6]]);
  ['Exness', 'Lirunex', 'Investizo'].forEach((n, i) => row([[3 + i, 1, 1], [n, 2, 2], [b[n]?.period ?? 0, 3, 4], [b[n]?.total ?? 0, 5, 6]]));

  // 4. bot & user activity
  title('BOT & USER ACTIVITY');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Count', 3, 6, 'right']]);
  [['Login (this period)', d.login], ['Active users (signed in within 30 days)', d.active_users],
    ['Inactive users (no sign-in for 30 days)', d.inactive_users], ['Complete bots (total)', d.done_total],
    ['Incomplete bots (total)', d.open_total]].forEach(([t, v], i) => row([[i + 1, 1, 1], [t, 2, 2], [v, 3, 6]]));

  // 5. website traffic
  const t = d.traffic || {};
  title('WEBSITE TRAFFIC');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Count', 3, 6, 'right']]);
  [['Visitors', t.visitors], ['Page views', t.views], ['Interested (bot & plan clicks)', t.interested],
    ['Referral clicks (broker links)', t.referral], ['Other (Telegram group)', t.other]]
    .forEach(([label, v], i) => row([[i + 1, 1, 1], [label, 2, 2], [v ?? 0, 3, 6]]));

  // 6. income from broker: one table, a column per broker, read live from each partner area
  title('INCOME FROM BROKER');
  head([['No.', 1, 1, 'center'], ['Description', 2, 2], ['Exness', 3, 3, 'right'], ['Lirunex', 4, 4, 'right'],
    ['Investizo', 5, 5, 'right'], ['Total', 6, 6, 'right']]);
  const brokerRows = [['Clients (total)', 'clients'], ['Active clients', 'active'], ['Inactive clients', 'inactive'],
    ['Trades', 'trades'], ['Commission (USD)', 'commission', true]];
  let commissionRow = 0;
  brokerRows.forEach(([label, key, money], i) => {
    const vals = brokers.map(([, fig]) => (fig ? fig[key] : null));
    const total = vals.reduce((sum, v) => sum + (Number(v) || 0), 0);
    const at = row([[i + 1, 1, 1], [label, 2, 2], ...vals.map((v, j) => [v, 3 + j, 3 + j, { money }]),
      [f(`SUM(C${r}:E${r})`, total), 6, 6, { money }]], { strong: !!money });
    if (money) commissionRow = at;
  });
  // net income = plan sales completed in the period + total broker commission
  const plan = Number(d.plan_income || 0);
  cell(net, 5).value = f(`${plan}+F${commissionRow}`, netIncome);
  cell(summaryNet, 3).value = f(`E${net}`, netIncome);

  // notes
  r += 1;
  const down = brokers.filter(([, fig]) => !fig).map(([n]) => n);
  for (const note of [
    'Notes:',
    'Net Income = plan sales completed in the period (Elite $5, Diamond $49, Trial $0) + broker commission for the period.',
    'Broker figures are read live from the Exness, Lirunex and Investizo partner areas. "-" = the broker does not report it.',
    ...(down.length ? [`Could not be reached when this statement was made: ${down.join(', ')}.`] : []),
  ]) {
    ws.mergeCells(r, 1, r, 6);
    cell(r, 1).value = note;
    cell(r, 1).font = { name: FONT, size: 8, italic: note !== 'Notes:', bold: note === 'Notes:', color: { argb: 'FF666666' } };
    r += 1;
  }

  ws.pageSetup.printArea = `A1:F${r - 1}`;
  return wb;
}
