// Prints a worksheet (the statement from statement-xlsx.js, the customer list from users-xlsx.js) to an A4 PDF,
// so the PDF always matches the Excel file: same rows, merged cells, fills, fonts, borders, number formats,
// page header and footer. Follows the sheet's page setup: orientation, one page (fitToHeight 1) or as many
// pages as needed at full width, repeating the printTitlesRow on each new page.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const colPt = (width) => ((width ?? 9) * 7 + 5) * 0.75; // Excel column width (characters) to points
const color = (argb, fallback = [0, 0, 0]) => {
  if (!argb) return rgb(...fallback);
  const hex = argb.slice(-6);
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
};

function show(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && 'formula' in v) v = v.result;
  if (v == null) return '';
  const fmt = cell.numFmt || '';
  if (typeof v === 'number' && fmt.includes('$')) {
    if (v === 0 && fmt.includes('"-"')) return '-';
    const s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? `(${s})` : s;
  }
  if (typeof v === 'number' && fmt.includes('%')) return (v * 100).toFixed(1) + '%';
  return String(v);
}

// "&L...&C...&R..." -> { L: [lines], C: [...], R: [...] }, dropping font codes like &"Arial" and &10
function headerParts(text, page, pages) {
  const out = { L: [], C: [], R: [] };
  for (const m of (text || '').matchAll(/&([LCR])((?:(?!&[LCR]).)*)/gs)) {
    const clean = m[2].replace(/&"[^"]*"/g, '').replace(/&\d+/g, '').replace(/&P/g, String(page)).replace(/&N/g, String(pages));
    out[m[1]] = clean.split('\n');
  }
  return out;
}

// Text that doesn't fit its cell is cut short with "…" (Excel would hide the overflow too).
function fit(text, font, size, width) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > width) t = t.slice(0, -1);
  return t + '…';
}

export async function printStatement(ws) {
  const pdf = await PDFDocument.create();
  const fonts = {
    r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const fontOf = (f = {}) => fonts[(f.bold ? 'b' : '') + (f.italic ? 'i' : '') || 'r'] || fonts.r;
  // The built-in PDF fonts only cover Western letters; anything else (e.g. a Khmer name) prints as "?".
  // The Excel file keeps the real text.
  const drawable = new Map();
  const safe = (text) => [...text].map((ch) => {
    if (!drawable.has(ch)) {
      try { fonts.r.encodeText(ch); drawable.set(ch, true); } catch { drawable.set(ch, false); }
    }
    return drawable.get(ch) ? ch : '?';
  }).join('');

  const setup = ws.pageSetup || {};
  const m = setup.margins || { left: 0.5, right: 0.5, top: 0.9, bottom: 0.7, header: 0.35, footer: 0.3 };
  const [W, H] = setup.orientation === 'landscape' ? [A4[1], A4[0]] : A4;
  const box = { x: m.left * 72, w: W - (m.left + m.right) * 72, h: H - (m.top + m.bottom) * 72 };

  // grid
  const nCols = ws.columnCount;
  let nRows = 0;
  ws.eachRow((row, r) => { if (row.values.some((v) => v != null && v !== '')) nRows = r; });
  const colX = [0];
  for (let c = 1; c <= nCols; c++) colX.push(colX[c - 1] + colPt(ws.getColumn(c).width));
  const rowH = (r) => ws.getRow(r).height || 15;
  const total = Array.from({ length: nRows }, (_, i) => rowH(i + 1)).reduce((a, b) => a + b, 0);
  const onePage = setup.fitToHeight === 1;
  const scale = Math.min(1, box.w / colX[nCols], onePage ? box.h / total : 1);
  const left = box.x + (box.w - colX[nCols] * scale) / 2; // centred, like horizontalCentered
  const X = (c) => left + colX[c - 1] * scale;

  // merged ranges: master "r,c" -> [r1, c1, r2, c2]; covered cells are skipped
  const span = new Map();
  const covered = new Set();
  for (const ref of ws.model.merges || []) {
    const [a, b] = ref.split(':').map((x) => ws.getCell(x));
    span.set(`${a.row},${a.col}`, [a.row, a.col, b.row, b.col]);
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) if (r !== a.row || c !== a.col) covered.add(`${r},${c}`);
  }

  // split the rows into pages; the title row repeats at the top of every page after the first
  const titleRow = Number(String(setup.printTitlesRow || '').split(':')[0]) || 0;
  const pages = [[]];
  let used = 0;
  for (let r = 1; r <= nRows; r++) {
    const h = rowH(r) * scale;
    if (!onePage && used + h > box.h && pages[pages.length - 1].length) {
      pages.push(titleRow && r > titleRow ? [titleRow] : []);
      used = titleRow && r > titleRow ? rowH(titleRow) * scale : 0;
    }
    pages[pages.length - 1].push(r);
    used += h;
  }

  const drawRow = (page, r, yTop) => {
    for (let c = 1; c <= nCols; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const cell = ws.getCell(r, c);
      const [, c1, r2, c2] = span.get(`${r},${c}`) || [r, c, r, c];
      const x = X(c1), w = X(Math.min(c2 + 1, nCols + 1)) - x;
      let h = 0;
      for (let k = r; k <= r2; k++) h += rowH(k) * scale;
      const fill = cell.fill?.type === 'pattern' && cell.fill.fgColor?.argb;
      if (fill) page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: color(fill) });
      const border = cell.border?.top || cell.border?.left;
      if (border) page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: color(border.color?.argb, [0.75, 0.85, 0.83]), borderWidth: 0.5 * scale + 0.25 });

      const raw = safe(show(cell));
      if (!raw) continue;
      const f = cell.font || {};
      const size = (f.size || 11) * scale;
      const font = fontOf(f);
      const pad = 3 * scale + (cell.alignment?.indent || 0) * 9 * scale;
      const text = c2 > c1 || c === nCols ? raw : fit(raw, font, size, w - 2 * pad);
      const tw = font.widthOfTextAtSize(text, size);
      const align = cell.alignment?.horizontal || (typeof (cell.value?.result ?? cell.value) === 'number' ? 'right' : 'left');
      const tx = align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - pad - tw : x + pad;
      page.drawText(text, { x: tx, y: yTop - h / 2 - size * 0.35, size, font, color: color(f.color?.argb) });
    }
  };

  const hf = ws.headerFooter || {};
  const put = (page, parts, baseY, size, down) => {
    for (const [k, lines] of Object.entries(parts)) {
      lines.forEach((line, i) => {
        line = safe(line);
        const tw = fonts.r.widthOfTextAtSize(line, size);
        const x = k === 'L' ? m.left * 72 : k === 'R' ? W - m.right * 72 - tw : (W - tw) / 2;
        const y = down ? baseY - i * (size + 2) : baseY + (lines.length - 1 - i) * (size + 2);
        page.drawText(line, { x, y, size, font: fonts.r, color: rgb(0, 0, 0) });
      });
    }
  };

  pages.forEach((rows, i) => {
    const page = pdf.addPage([W, H]);
    let y = H - m.top * 72;
    for (const r of rows) {
      drawRow(page, r, y);
      y -= rowH(r) * scale;
    }
    put(page, headerParts(hf.oddHeader, i + 1, pages.length), H - (m.header || 0.35) * 72 - 10, 10, true);
    put(page, headerParts(hf.oddFooter, i + 1, pages.length), (m.footer || 0.3) * 72, 8, false);
  });

  return await pdf.save();
}
