// Builds the payment statement (the report bot's /payments) as a landscape A4 Excel sheet, from rz_payment_list():
// a summary by payment status, then one row per customer. The column header row repeats on every printed page.
import ExcelJS from 'exceljs';

const FONT = 'Arial';
const TEAL = 'FF0E4C44';
const BAND = 'FFEEF6F4';
const LINE = { style: 'thin', color: { argb: 'FFBFD8D3' } };
const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const MONEY = '$#,##0.00;($#,##0.00);$0.00';
const RANGE = { today: 'Today', week: 'This week', month: 'This month', all: 'All time' };
const STATUS = {
  confirm: ['Needs your confirmation', 'FFB54708'],
  waiting: ['Waiting for payment', 'FF475467'],
  paid: ['Paid', 'FF067647'],
  expired: ['Expired', 'FFB42318'],
};
const PLAN = { elite: 'Elite', diamond: 'Diamond' };

const COLUMNS = [
  ['No.', 5, 'center'], ['Name', 22], ['Email', 30], ['Telegram', 18], ['Plan', 10, 'center'], ['Amount', 11, 'right'],
  ['Status', 24], ['Since', 12, 'center'], ['Plan expires', 12, 'center'], ['Days left', 10, 'right'],
];

const dmy = (iso) => iso.split('-').reverse().join('/');

export function buildPaymentList(d) {
  const title = RANGE[d.range] || RANGE.month;
  const period = !d.from ? `up to ${dmy(d.to)}` : d.from === d.to ? dmy(d.from) : `${dmy(d.from)} - ${dmy(d.to)}`;
  const rows = d.rows || [];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RZGS-PRO';
  const ws = wb.addWorksheet('Payments', {
    views: [{ style: 'pageLayout', showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.8, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: {
      oddHeader: `&L&"Arial"&10RZGS-PRO\nrzgspro.com&C&"Arial"&10Payment Statement&R&"Arial"&10Date: ${dmy(d.date)}\nPeriod: ${title}`,
      oddFooter: '&L&"Arial"&8Generated automatically by RZGS-PRO · Confidential customer data&R&"Arial"&8Page &P of &N',
    },
  });
  ws.columns = COLUMNS.map(([, width]) => ({ width }));
  const last = COLUMNS.length;
  const cell = (r, c) => ws.getCell(r, c);
  const style = (c, { bold = false, size = 10, color, fill, align } = {}) => {
    c.font = { name: FONT, size, bold, color: color ? { argb: color } : undefined };
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.alignment = { horizontal: align || 'left', vertical: 'middle' };
    c.border = BOX;
  };

  ws.mergeCells(1, 1, 1, last);
  cell(1, 1).value = `PAYMENT STATEMENT · ${title.toUpperCase()}`;
  cell(1, 1).font = { name: FONT, bold: true, size: 15, color: { argb: TEAL } };
  ws.mergeCells(2, 1, 2, last);
  cell(2, 1).value = `Period: ${period}   ·   Customers on a paid plan (Elite $5, Diamond $49) who reached the payment step   ·   Amounts are plan prices`;
  cell(2, 1).font = { name: FONT, size: 9, color: { argb: 'FF666666' } };

  // summary by status
  let r = 4;
  [['Status', 1, 3], ['Customers', 4, 4], ['Amount', 5, 6]].forEach(([label, a, b]) => {
    ws.mergeCells(r, a, r, b);
    cell(r, a).value = label;
    style(cell(r, a), { bold: true, size: 9, color: 'FFFFFFFF', fill: TEAL, align: a === 1 ? 'left' : 'right' });
  });
  // money received (paid, and expired: they paid, the plan has since ended) and money not received yet,
  // each with its own total; the two are never added together
  const GROUPS = [
    ['Total received', ['paid', 'expired']],
    ['Total not received yet', ['confirm', 'waiting']],
  ];
  for (const [totalLabel, keys] of GROUPS) {
    const first = r + 1;
    for (const key of keys) {
      const [label, color] = STATUS[key];
      r += 1;
      const list = rows.filter((u) => u.status === key);
      ws.mergeCells(r, 1, r, 3);
      ws.mergeCells(r, 5, r, 6);
      cell(r, 1).value = label;
      cell(r, 4).value = list.length;
      cell(r, 5).value = list.reduce((sum, u) => sum + Number(u.amount || 0), 0);
      // merged cells share one style, so style each block once (columns 1-3, 4, 5-6)
      for (const c of [1, 4, 5]) style(cell(r, c), { bold: c === 1, color: c === 1 ? color : undefined, align: c === 1 ? 'left' : 'right' });
      cell(r, 5).numFmt = MONEY;
    }
    r += 1;
    const group = rows.filter((u) => keys.includes(u.status));
    ws.mergeCells(r, 1, r, 3);
    ws.mergeCells(r, 5, r, 6);
    cell(r, 1).value = totalLabel;
    cell(r, 4).value = { formula: `SUM(D${first}:D${r - 1})`, result: group.length };
    cell(r, 5).value = { formula: `SUM(E${first}:E${r - 1})`, result: group.reduce((sum, u) => sum + Number(u.amount || 0), 0) };
    for (const c of [1, 4, 5]) style(cell(r, c), { bold: true, fill: 'FFD8EFEA', align: c === 1 ? 'left' : 'right' });
    cell(r, 5).numFmt = MONEY;
  }
  for (let k = 4; k <= r; k++) ws.getRow(k).height = 17;

  // customer rows
  r += 2;
  const head = r;
  COLUMNS.forEach(([label, , align], i) => {
    cell(head, i + 1).value = label;
    style(cell(head, i + 1), { bold: true, size: 9, color: 'FFFFFFFF', fill: TEAL, align });
  });
  ws.getRow(head).height = 20;
  ws.pageSetup.printTitlesRow = `${head}:${head}`;
  if (!rows.length) {
    ws.mergeCells(head + 1, 1, head + 1, last);
    cell(head + 1, 1).value = 'No payments in this period.';
    style(cell(head + 1, 1), { size: 10, color: 'FF666666' });
  }
  rows.forEach((u, i) => {
    const row = head + 1 + i;
    const [label, color] = STATUS[u.status] || [u.status];
    const values = [i + 1, u.name, u.email, u.telegram ? `@${u.telegram.replace(/^@/, '')}` : null, PLAN[u.plan] || u.plan,
      u.amount, label, u.since, u.expires, u.days_left];
    values.forEach((v, j) => {
      const c = cell(row, j + 1);
      c.value = v ?? '-';
      style(c, { size: 9, bold: j === 6, color: j === 6 ? color : undefined, fill: i % 2 ? BAND : undefined, align: COLUMNS[j][2] });
    });
    cell(row, 6).numFmt = MONEY;
    ws.getRow(row).height = 16;
  });

  ws.pageSetup.printArea = `A1:${ws.getColumn(last).letter}${head + Math.max(rows.length, 1)}`;
  return wb;
}
