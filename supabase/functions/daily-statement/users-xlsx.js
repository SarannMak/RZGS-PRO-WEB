// Builds the customer list (the report bot's /users) as a landscape A4 Excel sheet, from rz_customer_list().
// Same look as the statement; the column header row repeats on every printed page.
import ExcelJS from 'exceljs';

const FONT = 'Arial';
const TEAL = 'FF0E4C44';
const BAND = 'FFEEF6F4';
const LINE = { style: 'thin', color: { argb: 'FFBFD8D3' } };
const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const RANGE = { today: 'New users today', week: 'New users this week', month: 'New users this month', all: 'All users' };

// Where each customer is in the bot's buying steps, in words.
const STAGE = {
  plan: 'Choosing a plan', ask_broker: 'Opening broker account', ask_broker_email: 'Sending broker email',
  review_referral: 'Broker check', pay: 'Waiting for payment', review_payment: 'Payment check',
  ask_mt5: 'Sending MT5 number', review_mt5: 'MT5 check', build: 'Bot being built', active: 'Active',
};
const status = (u) => (u.stage === 'active' && u.expired ? 'Expired' : STAGE[u.stage] || 'Not started in bot');
const PLAN = { trial: 'Trial', elite: 'Elite', diamond: 'Diamond' };

const COLUMNS = [
  ['No.', 5, 'center'], ['Name', 20], ['Email', 28], ['Telegram', 16], ['Phone', 15], ['Country', 12],
  ['Signed up', 11, 'center'], ['Last login', 11, 'center'], ['Plan', 9, 'center'], ['Status', 20],
  ['Broker', 10], ['MT5 account', 12], ['Plan expires', 11, 'center'],
];

const dmy = (iso) => iso.split('-').reverse().join('/');

export function buildUserList(d) {
  const title = RANGE[d.range] || RANGE.today;
  const period = !d.from ? `up to ${dmy(d.to)}` : d.from === d.to ? dmy(d.from) : `${dmy(d.from)} - ${dmy(d.to)}`;
  const rows = d.rows || [];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RZGS-PRO';
  const ws = wb.addWorksheet('Customers', {
    views: [{ style: 'pageLayout', showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      printTitlesRow: '4:4', margins: { left: 0.4, right: 0.4, top: 0.8, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: {
      oddHeader: `&L&"Arial"&10RZGS-PRO\nrzgspro.com&C&"Arial"&10Customer List&R&"Arial"&10Date: ${dmy(d.date)}\n${title}`,
      oddFooter: '&L&"Arial"&8Generated automatically by RZGS-PRO · Confidential customer data&R&"Arial"&8Page &P of &N',
    },
  });
  ws.columns = COLUMNS.map(([, width]) => ({ width }));
  const last = COLUMNS.length;

  ws.mergeCells(1, 1, 1, last);
  ws.getCell(1, 1).value = `CUSTOMER LIST · ${title.toUpperCase()}`;
  ws.getCell(1, 1).font = { name: FONT, bold: true, size: 15, color: { argb: TEAL } };
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).value = `Period: ${period}   ·   ${rows.length} customer${rows.length === 1 ? '' : 's'}   ·   `
    + `Active: ${rows.filter((u) => status(u) === 'Active').length}   ·   In progress: ${rows.filter((u) => u.stage && u.stage !== 'active').length}`
    + `   ·   Not started in bot: ${rows.filter((u) => !u.stage).length}`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, color: { argb: 'FF666666' } };

  COLUMNS.forEach(([label, , align], i) => {
    const c = ws.getCell(4, i + 1);
    c.value = label;
    c.font = { name: FONT, bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    c.alignment = { horizontal: align || 'left', vertical: 'middle' };
    c.border = BOX;
  });
  ws.getRow(4).height = 20;

  if (!rows.length) {
    ws.mergeCells(5, 1, 5, last);
    ws.getCell(5, 1).value = 'No customers in this period.';
    ws.getCell(5, 1).font = { name: FONT, size: 10, italic: true, color: { argb: 'FF666666' } };
    ws.getCell(5, 1).border = BOX;
  }
  rows.forEach((u, i) => {
    const r = 5 + i;
    const s = status(u);
    const values = [i + 1, u.name, u.email, u.telegram ? `@${u.telegram.replace(/^@/, '')}` : null, u.phone, u.country,
      u.signed_up, u.last_login, PLAN[u.plan] || u.plan, s, u.broker, u.mt5, u.expires];
    values.forEach((v, j) => {
      const c = ws.getCell(r, j + 1);
      c.value = v ?? '-';
      c.font = { name: FONT, size: 9, bold: j === 9 && s === 'Active', color: j === 9 && s === 'Expired' ? { argb: 'FFB42318' } : undefined };
      c.alignment = { horizontal: COLUMNS[j][2] || 'left', vertical: 'middle' };
      c.border = BOX;
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
    ws.getRow(r).height = 16;
  });

  ws.pageSetup.printArea = `A1:${ws.getColumn(last).letter}${4 + Math.max(rows.length, 1)}`;
  return wb;
}
