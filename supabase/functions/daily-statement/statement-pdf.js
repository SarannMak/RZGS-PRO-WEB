// Prints the statement worksheet (from statement-xlsx.js) to a one-page A4 PDF, so the PDF always matches the Excel file:
// same rows, merged cells, fills, fonts, borders, number formats, page header and footer.
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
function headerParts(text, page = 1, pages = 1) {
  const out = { L: [], C: [], R: [] };
  for (const m of (text || '').matchAll(/&([LCR])((?:(?!&[LCR]).)*)/gs)) {
    const clean = m[2].replace(/&"[^"]*"/g, '').replace(/&\d+/g, '').replace(/&P/g, String(page)).replace(/&N/g, String(pages));
    out[m[1]] = clean.split('\n');
  }
  return out;
}

export async function printStatement(ws) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const fonts = {
    r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const fontOf = (f = {}) => fonts[(f.bold ? 'b' : '') + (f.italic ? 'i' : '') || 'r'] || fonts.r;

  const m = ws.pageSetup.margins || { left: 0.5, right: 0.5, top: 0.9, bottom: 0.7, header: 0.35, footer: 0.3 };
  const [W, H] = A4;
  const box = { x: m.left * 72, y: m.bottom * 72, w: W - (m.left + m.right) * 72, h: H - (m.top + m.bottom) * 72 };

  // grid
  const nCols = ws.columnCount;
  let nRows = 0;
  ws.eachRow((row, r) => { if (row.values.some((v) => v != null && v !== '')) nRows = r; });
  const colX = [0];
  for (let c = 1; c <= nCols; c++) colX.push(colX[c - 1] + colPt(ws.getColumn(c).width));
  const rowY = [0];
  for (let r = 1; r <= nRows; r++) rowY.push(rowY[r - 1] + (ws.getRow(r).height || 15));
  const scale = Math.min(1, box.w / colX[nCols], box.h / rowY[nRows]);
  const left = box.x + (box.w - colX[nCols] * scale) / 2; // centred, like horizontalCentered
  const top = H - m.top * 72;
  const X = (c) => left + colX[c - 1] * scale;
  const Y = (r) => top - rowY[r - 1] * scale;

  // merged ranges: master "r,c" -> [r1, c1, r2, c2]; covered cells are skipped
  const span = new Map();
  const covered = new Set();
  for (const ref of ws.model.merges || []) {
    const [a, b] = ref.split(':').map((x) => ws.getCell(x));
    span.set(`${a.row},${a.col}`, [a.row, a.col, b.row, b.col]);
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) if (r !== a.row || c !== a.col) covered.add(`${r},${c}`);
  }

  for (let r = 1; r <= nRows; r++) {
    for (let c = 1; c <= nCols; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const cell = ws.getCell(r, c);
      const [r1, c1, r2, c2] = span.get(`${r},${c}`) || [r, c, r, c];
      const x = X(c1), w = X(c2 + 1 > nCols ? nCols + 1 : c2 + 1) - x;
      const yTop = Y(r1), h = (rowY[r2] - rowY[r1 - 1]) * scale;
      const fill = cell.fill?.type === 'pattern' && cell.fill.fgColor?.argb;
      if (fill) page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: color(fill) });
      const border = cell.border?.top || cell.border?.left;
      if (border) page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: color(border.color?.argb, [0.75, 0.85, 0.83]), borderWidth: 0.5 * scale + 0.25 });

      const text = show(cell);
      if (!text) continue;
      const f = cell.font || {};
      const size = (f.size || 11) * scale;
      const font = fontOf(f);
      const tw = font.widthOfTextAtSize(text, size);
      const pad = 3 * scale + (cell.alignment?.indent || 0) * 9 * scale;
      const align = cell.alignment?.horizontal || (typeof (cell.value?.result ?? cell.value) === 'number' ? 'right' : 'left');
      const tx = align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - pad - tw : x + pad;
      page.drawText(text, { x: tx, y: yTop - h / 2 - size * 0.35, size, font, color: color(f.color?.argb) });
    }
  }

  // page header and footer
  const hf = ws.headerFooter || {};
  const put = (parts, baseY, size, down) => {
    for (const [k, lines] of Object.entries(parts)) {
      lines.forEach((line, i) => {
        const tw = fonts.r.widthOfTextAtSize(line, size);
        const x = k === 'L' ? m.left * 72 : k === 'R' ? W - m.right * 72 - tw : (W - tw) / 2;
        const y = down ? baseY - i * (size + 2) : baseY + (lines.length - 1 - i) * (size + 2);
        page.drawText(line, { x, y, size, font: fonts.r, color: rgb(0, 0, 0) });
      });
    }
  };
  put(headerParts(hf.oddHeader), H - (m.header || 0.35) * 72 - 10, 10, true);
  put(headerParts(hf.oddFooter), (m.footer || 0.3) * 72, 8, false);

  return await pdf.save();
}
