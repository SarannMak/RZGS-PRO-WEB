/* RZGS-PRO, home page: "Why choose RZGS-PRO" (the owner, 16 Nov 2026, from his video)
   1. The page turns dark and the six parts are told one by one while you scroll: the stage stays in place, a big word
      passes behind, the board screen of the part rises in the middle and its words come in beside it while the last
      ones move aside. The motion follows the scroll with a little give, and every part holds still for a moment.
      With "reduce motion" the six boards simply stand one under the other.
   2. Board 1 is one cycle of the bot drawn live, the way the old board drew it: a price grid like a real chart, the
      exact levels, the take profits and the basket. It never stops between steps: one cycle in an uptrend, then the
      same cycle in a downtrend, again and again. It runs only while it can be seen. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    inCubic: (k) => k * k * k,
    outCubic: (k) => 1 - Math.pow(1 - k, 3),
    spring: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.cos(k * Math.PI * 2.6) * Math.exp(-k * 6.2)),
  };

  /* ---------------------------------------------------------------- 1. the six parts, told one by one while scrolling */
  const fd = document.querySelector('.fd');
  if (fd && !reduced.matches) {
    const track = fd.querySelector('.fd-track');
    const parts = [...fd.querySelectorAll('.fd-slide')].map((s) => ({ s, word: s.querySelector('.fd-word'), board: s.querySelector('.fd-board'), text: s.querySelector('.fd-text') }));
    const N = parts.length;
    const now = fd.querySelector('[data-fd-now]');
    const bar = fd.querySelector('[data-fd-bar]');
    const goBtns = [...fd.querySelectorAll('[data-fd-go]')];
    const fdStage = fd.querySelector('.fd-stage');
    fd.classList.add('is-pinned');
    let target = 0, cur = 0, raf = 0, narrow = false, shift = 0;
    // every part holds still for a moment: of each step of scrolling, the first and the last fifth do not move it
    const hold = (raw) => { const i = Math.floor(raw), k = clamp((raw - i - 0.2) / 0.6); return Math.min(N - 1, i + k * k * (3 - 2 * k)); };
    function measure() {
      narrow = innerWidth < 1100;
      shift = parts[0].board.offsetWidth + 80 + parts[0].text.offsetWidth;   // from beside the board to the other side of it
      const total = track.offsetHeight - innerHeight;
      target = hold(clamp(-track.getBoundingClientRect().top / Math.max(1, total)) * (N - 1));
    }
    // on a phone or a tablet the board takes the height the tallest words under it leave free (theme.css: --below)
    let below = '';
    function fitBelow() {
      const v = innerWidth < 1100 ? `${Math.ceil(Math.max(...parts.map((p) => p.text.offsetHeight)))}px` : '';
      if (v !== below) {
        below = v;
        if (v) fdStage.style.setProperty('--below', v);
        else fdStage.style.removeProperty('--below');
      }
      // a phone or a tablet (16 Nov 2026, the owner: "I need the full detail, make the box taller"): each card is as
      // tall as all its rows and its words come under it. Where the screen is short the words keep their title
      // (.fd-short), and only when that is not enough do the card's last rows give way (.fd-clip). theme.css takes
      // --top, --gap, --ch (the card's rows) and --own (its words).
      if (!v) {
        for (const { s } of parts) {
          for (const k of ['--own', '--ch', '--top', '--gap', '--chart-h']) s.style.removeProperty(k);
          s.classList.remove('fd-short', 'fd-clip');
        }
        return;
      }
      const H = fdStage.clientHeight, top = H >= 760 ? 124 : H >= 620 ? 112 : 100, gap = H >= 760 ? 22 : H >= 620 ? 16 : 14, foot = 92;
      for (const { s, board, text } of parts) {
        s.classList.remove('fd-short', 'fd-clip');
        const full = text.offsetHeight;
        s.classList.add('fd-short');
        const short = text.offsetHeight;
        s.classList.remove('fd-short');
        let words = full, ch;
        if (board.matches('[data-app]')) {
          // the app fills what its words leave, as before
          ch = H - top - gap - full - foot;
          if (ch < 300) { words = short; ch = H - top - gap - short - foot; s.classList.add('fd-short'); }
          ch = clamp(ch, 240, 460);
        } else {
          const head = board.querySelector('.fb-head'), body = board.querySelector('.fd-board-body');
          let end = 0;
          for (const c of body.children) end = Math.max(end, c.offsetTop + c.offsetHeight);
          let need = (head ? head.offsetHeight : 0) + end;            // the rows themselves; 14 px of air under them
          const chart = board.matches('.fd-board--chart') ? board.querySelector('.fd-chart') : null;
          if (chart) {
            // the strategy's chart takes the height its card has left on this screen (17 Nov 2026, the owner: "it is still
            // low, it cuts the +1.00$ and BUY L3 at the top"): with all its words while the chart keeps 148 px, else with
            // their title only; 104 to 200 px (theme.css: --chart-h)
            const others = need - chart.offsetHeight;
            const left = (w) => H - top - gap - w - foot - 6 - others;
            let want = left(full);
            if (want < 148) { words = short; s.classList.add('fd-short'); want = left(short); }
            want = Math.round(clamp(want, H < 620 ? 104 : 120, 200));
            s.style.setProperty('--chart-h', `${want}px`);
            need = others + want;
            ch = need + 6;
          } else {
            ch = need + 14;
            if (top + ch + gap + full + foot > H) { words = short; s.classList.add('fd-short'); }
          }
          const room = H - top - gap - words - foot;
          if (ch > room) ch = Math.max(200, room);
          if (need > ch + 1) s.classList.add('fd-clip');               // only when a row would really be cut
        }
        s.style.setProperty('--top', `${top}px`);
        s.style.setProperty('--gap', `${gap}px`);
        s.style.setProperty('--ch', `${Math.round(ch)}px`);
        s.style.setProperty('--own', `${words}px`);
      }
    }
    function paint() {
      parts.forEach(({ s, word, board, text }, i) => {
        const d = i - cur, a = Math.abs(d);
        // the big word passes behind, right to left; its neighbours show at the edges (on a phone only the one word)
        word.style.transform = `translate3d(${(d * (narrow ? 110 : 62)).toFixed(2)}vw, 0, 0)`;
        word.style.opacity = narrow ? clamp(1 - a * 1.6).toFixed(3) : (clamp(1 - a * 0.6) * (0.55 + 0.45 * clamp(1 - a))).toFixed(3);
        // the board turns like a card, right to left, around its middle: the one in front turns away to its edge
        // while the next one turns on from its edge (the owner's video)
        const ang = Math.max(-0.5, Math.min(0.5, d)) * 180;
        const on = a < 0.5;
        const k = Math.min(a / 0.5, 1);
        board.style.transform = `perspective(1300px) rotateY(${ang.toFixed(2)}deg) scale(${(1 - 0.08 * Math.sin(Math.PI * k / 2)).toFixed(4)})`;
        board.style.opacity = on ? (1 - 0.3 * k * k).toFixed(3) : '0';
        board.style.visibility = on ? '' : 'hidden';
        const op = on ? 1 : 0;
        // the words come in from the right and move to the other side of the board, fading (on a phone: across)
        let tx, to;
        if (narrow) { tx = `${(d * 100).toFixed(2)}vw`; to = clamp(1 - a * 1.6); }
        // (while they cross the board they fade far down, so they never sit on it; the last ones stay faint on the left)
        else { tx = `${(d * shift).toFixed(1)}px`; to = d <= 0 ? lerp(1, 0.38, Math.min(a, 1)) * (1 - 0.8 * Math.sin(Math.PI * Math.min(a, 1))) * clamp(1 - (a - 1.2) * 3) : clamp(1 - d * 1.3) * (1 - 0.5 * Math.sin(Math.PI * Math.min(d, 1))); }
        text.style.transform = `translate3d(${tx}, 0, 0)`;
        text.style.opacity = to.toFixed(3);
        // (a phone fades them without a blur: a blur on moving words is heavy there, 18 Nov 2026)
        text.style.filter = !narrow && a > 0.03 ? `blur(${(Math.min(a, 1.4) * 3).toFixed(2)}px)` : 'none';
        s.classList.toggle('is-current', a < 0.5);
        const away = a >= 0.6;                                     // the live chart and the loops of a part away rest
        if (s.classList.contains('is-shut') !== away) s.classList.toggle('is-shut', away);
        s.style.visibility = !op && to <= 0.001 && a > 1.5 ? 'hidden' : '';
      });
      const n = String(Math.round(cur) + 1).padStart(2, '0');
      if (now && now.textContent !== n) now.textContent = n;
      // the arrows: none before the first part, none after the last
      goBtns.forEach((b) => {
        const off = Number(b.dataset.fdGo) < 0 ? Math.round(cur) <= 0 : Math.round(cur) >= N - 1;
        if (b.classList.contains('is-off') !== off) { b.classList.toggle('is-off', off); b.setAttribute('aria-disabled', String(off)); }
      });
      if (bar) bar.style.transform = `scaleX(${(cur / (N - 1)).toFixed(4)})`;
    }
    function loop() {
      raf = 0;
      cur += (target - cur) * 0.14;
      if (Math.abs(target - cur) < 0.0005) cur = target;
      paint();
      if (cur !== target) raf = requestAnimationFrame(loop);
    }
    const kick = () => { measure(); if (!raf) raf = requestAnimationFrame(loop); };
    // To the part before or after (17 Nov 2026, the owner: "on phone, swipe it left or right to flip the card; a button
    // <<< 02/06 >>>"): the arrows by the counter and a sideways swipe on the stage scroll the page to the middle of that
    // part's hold, so it turns over as if it had been scrolled to. Pressed again while it travels, it goes one more.
    let aim = null, aimTimer = 0;
    function step(dir) {
      const from = aim === null ? Math.round(target) : aim;
      const k = Math.max(0, Math.min(N - 1, from + dir));
      if (k === from) return;
      aim = k;
      clearTimeout(aimTimer);
      aimTimer = setTimeout(() => { aim = null; }, 900);
      const total = track.offsetHeight - innerHeight;
      const top = track.getBoundingClientRect().top + scrollY + (k / (N - 1)) * total;
      window.scrollTo({ top: Math.round(top), behavior: 'smooth' });
    }
    goBtns.forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.fdGo))));
    let sx = 0, sy = 0, st = 0, touching = false;
    fdStage.addEventListener('touchstart', (e) => {
      touching = e.touches.length === 1;
      if (!touching) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = performance.now();
    }, { passive: true });
    fdStage.addEventListener('touchend', (e) => {
      if (!touching) return;
      touching = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      // a sideways swipe: far enough, more across than down, and quick (a slow drag is someone reading)
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - st < 900) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    fdStage.addEventListener('touchcancel', () => { touching = false; }, { passive: true });
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', () => { fitBelow(); kick(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitBelow(); kick(); });
    fitBelow();
    measure();
    cur = target;
    paint();
  }

  /* ---------------------------------------------------------------- the Live board: the Control App, its five screens in turn
     (16 Nov 2026, the owner: "like in the real live app"). The Trades chart is drawn the way the app draws it
     (app.html, renderLadder) and, while the board is in the middle, the price moves a little every second: the last
     candle, the price tag, the basket's close price and Home's equity and floating profit move with it. */
  const app = document.querySelector('[data-app]');
  if (app) {
    const slide = app.closest('.fd-slide');
    const tabs = [...app.querySelectorAll('[data-app-tab]')];
    const views = [...app.querySelectorAll('[data-app-view]')];
    const items = slide ? [...slide.querySelectorAll('[data-app-item]')] : [];
    const cv = app.querySelector('[data-fa-chart]');
    const eqEl = app.querySelector('[data-fa-eq]'), flEl = app.querySelector('[data-fa-float]');
    // the example account: 0.04 lots sold at 4,119.92 / 4,121.92 / 4,123.92 (x2), 0.01 bought at 4,123.92, take profit 1.00$,
    // basket profit 6.00$, grid 2.00$ (the same as the app's own test bot)
    const BID0 = 4122.72, BAL = 10234.56, FLOAT0 = 6.64;
    const TRADES = [['sell', 'L1', 0.01, 4119.92], ['sell', 'L2', 0.01, 4121.92], ['sell', 'L3', 0.02, 4123.92], ['buy', 'L3', 0.01, 4123.92]];
    const BARS = [];
    for (let i = 0, p = 4121.7; i < 30; i += 1) {
      const c = 4122.9 + 1.35 * Math.sin(i * 0.52 + 0.4) + 0.3 * Math.sin(i * 1.9);
      BARS.push([p, Math.max(p, c) + 0.16 + (i % 3) * 0.07, Math.min(p, c) - 0.14 - (i % 4) * 0.06, c]);
      p = c;
    }
    let bid = BID0;
    const setLast = () => { const b = BARS[BARS.length - 1]; b[3] = bid; b[1] = Math.max(b[0], bid) + 0.12; b[2] = Math.min(b[0], bid) - 0.1; };
    setLast();
    const reached = (price) => { for (let j = BARS.length - 1; j >= 0; j -= 1) if (BARS[j][2] <= price && price <= BARS[j][1]) return j; return -1; };
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const MONO = (w, px) => `${w} ${px}px "IBM Plex Mono", Consolas, monospace`;
    const C = { grid: 'rgba(148,170,255,0.12)', muted: '#8f9bc0', up: '#4cc38a', down: '#ff7d84', buy: '#5aa2ff', sell: '#f5b04a', tag: 'rgba(10,15,36,0.94)', bg: '#060b1c' };
    function drawChart() {
      if (!cv) return;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (W < 120 || H < 50) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // a short chart leaves out the next entries and shows the trades closer (as the app does when it is moved back)
      const tall = H >= 150, SW = 58, PW = W - SW, lo = tall ? 4117.1 : 4119.35, hi = tall ? 4126.8 : 4125.35, y = (p) => (hi - p) / (hi - lo) * H;
      // the grid every 1.00 and the price scale
      g.lineWidth = 1; g.textBaseline = 'middle'; g.font = MONO(500, 9.5);
      g.strokeStyle = C.grid; g.fillStyle = C.muted; g.setLineDash([2, 4]);
      const step = H < 170 ? 2 : 1;
      for (let v = tall ? 4118 : 4120; v <= 4126; v += step) {
        const yy = Math.round(y(v)) + 0.5;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(PW, yy); g.stroke();
        if (yy > 7 && yy < H - 7) g.fillText(fmt(v), PW + 6, yy);
      }
      // the newest candle leaves room on its right for the trades' tags
      const n = BARS.length, right = PW - 66, bw = right / n, bx = (i) => right - (n - i - 0.5) * bw;
      for (let i = n - 1; i >= 0; i -= 10) { const xx = Math.round(bx(i)) + 0.5; g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, H); g.stroke(); }
      g.setLineDash([]);
      g.beginPath(); g.moveTo(PW + 0.5, 0); g.lineTo(PW + 0.5, H); g.stroke();
      const body = Math.max(1, Math.min(8, bw * 0.62));
      g.globalAlpha = 0.85;
      BARS.forEach((b, i) => {
        const xx = Math.round(bx(i)) + 0.5, yo = y(b[0]), yc = y(b[3]);
        g.strokeStyle = g.fillStyle = b[3] >= b[0] ? C.up : C.down;
        g.beginPath(); g.moveTo(xx, y(b[1])); g.lineTo(xx, y(b[2])); g.stroke();
        g.fillRect(xx - body / 2, Math.min(yo, yc), body, Math.max(1, Math.abs(yc - yo)));
      });
      g.globalAlpha = 1;
      // a dashed line across with a word at its left: the next entries, the take profit
      const across = (price, colour, word, dash = [4, 4]) => {
        const yy = Math.round(y(price)) + 0.5;
        g.save(); g.strokeStyle = colour; g.setLineDash(dash); g.beginPath(); g.moveTo(0, yy); g.lineTo(PW, yy); g.stroke(); g.restore();
        if (word) { g.font = MONO(500, 9.5); g.fillStyle = colour; g.fillText(word, 2, yy < 14 ? yy + 8 : yy - 7); }
      };
      if (tall) {
        across(4125.92, 'rgba(143,155,192,0.75)', 'NEXT 4125.92', [3, 4]);
        across(4117.92, 'rgba(143,155,192,0.75)', 'NEXT 4117.92', [3, 4]);
      }
      across(4124.92, C.buy, 'TP');
      // the sell basket: where its 3 trades close together at +6.00$, an orange zone on its profit side
      const sells = TRADES.filter((t) => t[0] === 'sell'), lots = sells.reduce((a, t) => a + t[2], 0);
      const profit = sells.reduce((a, t) => a + (t[3] - bid) * t[2] * 100, 0), basket = bid - (6 - profit) / (lots * 100);
      const yb = Math.round(y(basket)) + 0.5, band = g.createLinearGradient(0, yb, 0, yb + 22);
      band.addColorStop(0, 'rgba(245,160,74,0.42)'); band.addColorStop(1, 'rgba(245,160,74,0.03)');
      g.fillStyle = band; g.fillRect(0, yb, PW, 22);
      g.save(); g.strokeStyle = C.sell; g.lineWidth = 2; g.shadowColor = 'rgba(245,160,74,0.6)'; g.shadowBlur = 4;
      g.beginPath(); g.moveTo(0, yb); g.lineTo(PW, yb); g.stroke(); g.restore();
      g.font = MONO(700, 9.5); g.fillStyle = C.sell; g.fillText('BASKET', 2, yb - 7);
      // a closed trade's profit where it closed
      { const i = 9, xx = bx(i), yy = y(BARS[i][1]); g.fillStyle = C.up; g.beginPath(); g.arc(xx, yy, 2.2, 0, Math.PI * 2); g.fill();
        g.font = MONO(700, 9.5); g.save(); g.shadowColor = C.up; g.shadowBlur = 6; g.fillText('+1.00$ TP', Math.max(2, xx - 26), yy - 10); g.restore(); }
      // the open trades: a dashed line from the candle each opened on, its tag above the line on the right, never two on one
      g.font = MONO(600, 9.5);
      const tags = TRADES.map(([side, tag, lot, price]) => { const text = `${tag} ${lot.toFixed(2)}`; return { side, price, text, w: Math.ceil(g.measureText(text).width) + 14, at: reached(price) }; })
        .map((t) => ({ ...t, x: PW - t.w - 4, top: y(t.price) - 19, h: 16 })).sort((a, b) => a.top - b.top);
      for (let i = 1; i < tags.length; i += 1) tags[i].top = Math.max(tags[i].top, tags[i - 1].top + tags[i - 1].h + 2);
      for (const t of tags) {
        const c = C[t.side], yy = Math.round(y(t.price)) + 0.5, x0 = t.at >= 0 ? bx(t.at) : 0;
        g.save(); g.strokeStyle = c; g.setLineDash([5, 4]); g.shadowColor = c; g.shadowBlur = 3;
        g.beginPath(); g.moveTo(x0, yy); g.lineTo(PW, yy); g.stroke(); g.setLineDash([]);
        if (t.at >= 0) { g.fillStyle = c; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + 6, yy - 5); g.lineTo(x0 + 6, yy + 5); g.closePath(); g.fill(); }
        g.shadowBlur = 0;
        const cut = 4, L = t.x, T = t.top, R = t.x + t.w, B = t.top + t.h;
        g.beginPath(); g.moveTo(L + cut, T); g.lineTo(R, T); g.lineTo(R, B - cut); g.lineTo(R - cut, B); g.lineTo(L, B); g.lineTo(L, T + cut); g.closePath();
        g.fillStyle = C.tag; g.fill(); g.strokeStyle = c; g.stroke();
        g.fillStyle = c; g.fillText(t.text, L + 7, T + t.h / 2 + 0.5);
        g.restore();
      }
      // the price tags on the scale: the take profit and the basket outlined, the price now filled
      g.font = MONO(500, 9.5);
      for (const [price, c] of [[4124.92, C.buy], [basket, C.sell]]) {
        const yy = Math.max(8, Math.min(H - 8, y(price)));
        g.fillStyle = '#10173a'; g.fillRect(PW + 1, yy - 8, SW - 1, 16);
        g.strokeStyle = c; g.strokeRect(PW + 1.5, yy - 7.5, SW - 2, 15);
        g.fillStyle = c; g.fillText(fmt(price), PW + 5, yy + 0.5);
      }
      const yp = Math.round(y(bid)) + 0.5;
      g.save(); g.strokeStyle = C.buy; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, yp); g.lineTo(PW, yp); g.stroke(); g.restore();
      g.fillStyle = C.buy; g.fillRect(PW + 1, yp - 8, SW - 1, 16);
      g.fillStyle = C.bg; g.fillText(fmt(bid), PW + 5, yp + 0.5);
    }
    // every second, while the board is in the middle: the price moves a little, and what hangs on it
    function tick() {
      bid = Math.min(4123.5, Math.max(4121.95, bid + (Math.random() - 0.5) * 0.46));
      setLast();
      const fl = FLOAT0 - 3 * (bid - BID0);         // 0.04 lots sold, 0.01 bought: 0.03 lots short
      if (eqEl) eqEl.textContent = '$' + fmt(BAL + fl);
      if (flEl) flEl.textContent = (fl >= -0.004 ? '+' : '-') + Math.abs(fl).toFixed(2) + '$';
      if (views[1] && views[1].classList.contains('is-on')) drawChart();
    }
    let tabAt = 0, tabTimer = 0, tickTimer = 0;
    const showTab = (i) => {
      tabAt = i;
      tabs.forEach((t, k) => { t.classList.toggle('is-on', k === i); t.setAttribute('aria-selected', String(k === i)); });
      views.forEach((v, k) => v.classList.toggle('is-on', k === i));
      items.forEach((li, k) => li.classList.toggle('is-on', k === i));
      if (i === 1) drawChart();
    };
    const turning = () => !!slide && slide.classList.contains('is-current') && !reduced.matches && !document.hidden;
    const restart = () => {
      clearInterval(tabTimer); clearInterval(tickTimer);
      const on = turning();
      tabTimer = on ? setInterval(() => showTab((tabAt + 1) % views.length), 3000) : 0;
      tickTimer = on ? setInterval(tick, 1000) : 0;
    };
    tabs.forEach((t, k) => t.addEventListener('click', () => { showTab(k); restart(); }));
    if (slide) new MutationObserver(restart).observe(slide, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', restart);
    if (cv) new ResizeObserver(() => drawChart()).observe(cv);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawChart);
    drawChart();
    restart();
  }

  /* ---------------------------------------------------------------- 2. the strategy, live */
  const box = document.querySelector('[data-strategy]');
  const stage = box && box.querySelector('[data-sl]');
  const canvas = stage && stage.querySelector('canvas');
  const ctx = canvas && canvas.getContext('2d');
  if (!ctx) return;
  const pick = (sel) => box.querySelector(sel);
  const ui = {
    card: pick('.sl-card'), cycle: pick('[data-sl-cycle]'), value: pick('[data-sl-value]'), tp: pick('[data-sl-tp]'),
    basket: pick('[data-sl-chip="basket"]'), bname: pick('[data-sl-bname]'), bval: pick('[data-sl-bval]'), bar: pick('[data-sl-bar]'),
    price: pick('[data-sl-price]'), change: pick('[data-sl-change]'),
  };
  const steps = [...box.querySelectorAll('[data-fx-step]')];

  // The cycle of the old board, unchanged (story seconds; dollars from the first open). The bot's own rules: a BUY and
  // a SELL open together; the side that wins closes at take profit (1.00$); the next pair opens a grid distance (2.00$)
  // beyond that close; only the holding side grows (0.01, 0.01, 0.02); the holding side closes together once its total
  // reaches the basket profit (6.00$ in this example).
  const KEYS = [
    [1.60, 0.0], [1.74, 0.16], [1.85, 0.0], [2.04, -0.34], [2.24, 0.08], [2.45, 0.46], [2.75, 1.0],
    [2.95, 1.32], [3.14, 2.06], [3.30, 1.84], [3.55, 3.0], [3.66, 3.28], [3.80, 4.0], [3.92, 4.42],
    [4.06, 5.2], [4.20, 6.0], [4.32, 6.46], [4.50, 5.62], [4.66, 4.3], [4.81, 3.18], [4.95, 2.25],
    [5.10, 2.62], [5.25, 2.12], [5.40, 2.4],
  ];
  function priceAt(t) {
    if (t <= KEYS[0][0]) return KEYS[0][1];
    if (t >= KEYS[KEYS.length - 1][0]) return KEYS[KEYS.length - 1][1];
    let i = 0;
    while (t > KEYS[i + 1][0]) i += 1;
    const [t0, p0] = KEYS[i], [t1, p1] = KEYS[i + 1];
    const slope = (j) => {
      const a = KEYS[Math.max(0, j - 1)], b = KEYS[Math.min(KEYS.length - 1, j + 1)];
      return (b[1] - a[1]) / (b[0] - a[0]);
    };
    const h = t1 - t0, u = (t - t0) / h, m0 = slope(i) * h, m1 = slope(i + 1) * h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
  }
  const T0 = 1.6, T1 = 5.4, TP = 1, BASKET = 6, BASKET_AT = 4.95;
  const TRADES = [
    { side: 'buy', lvl: 1, lot: 0.01, at: 1.85, p: 0, close: { at: 2.75, kind: 'tp' } },
    { side: 'sell', lvl: 1, lot: 0.01, at: 1.85, p: 0, close: { at: BASKET_AT, kind: 'basket' } },
    { side: 'buy', lvl: 2, lot: 0.01, at: 3.55, p: 3, close: { at: 3.80, kind: 'tp' } },
    { side: 'sell', lvl: 2, lot: 0.01, at: 3.55, p: 3, close: { at: BASKET_AT, kind: 'basket' } },
    { side: 'buy', lvl: 3, lot: 0.01, at: 4.20, p: 6, close: null },
    { side: 'sell', lvl: 3, lot: 0.02, at: 4.20, p: 6, close: { at: BASKET_AT, kind: 'basket' } },
  ];
  const STEP_AT = [1.6, 2.5, 3.5, 4.5];
  // a cycle is 5.2 story seconds: it comes in (1.45), draws (1.6 to 5.4), shows its result, and goes (6.35 to 6.65)
  const LOOP_AT = 1.45, LOOP = 5.2, SPEED = 0.42, STILL_AT = 5.5;
  // the second cycle is the first one upside down: gold falls, the sells take profit and the buys hold
  const CYCLES = [
    { dir: 1, start: 4120, name: '1st · Uptrend', hold: 'Sell', lo: -1.7, hi: 7.6 },
    { dir: -1, start: 4120 + priceAt(T1), name: '2nd · Downtrend', hold: 'Buy', lo: -7.6, hi: 1.7 },
  ];
  const sideIn = (tr, c) => (c.dir > 0 ? tr.side : tr.side === 'buy' ? 'sell' : 'buy');
  const cycleProfit = (t) => TRADES.filter((tr) => tr.close && tr.close.kind === 'tp' && t >= tr.close.at).length * TP + (t >= BASKET_AT ? BASKET : 0);
  // the holding side's open profit (the same in both cycles: the second is the first one mirrored)
  const basketAt = (t) => TRADES.filter((tr) => tr.side === 'sell' && t >= tr.at && t < BASKET_AT).reduce((s, tr) => s + (tr.p - priceAt(t)) * tr.lot * 100, 0);
  const money = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  const COL = stage.closest('.fd') ? {
    blue: '#3d8ef5', deep: '#8cc2ff', soft: '#2a5bb0', buy: '#5aa2ff', sell: '#a78bfa', tp: '#6aa8f5',
    grid: 'rgba(170, 190, 255, 0.16)', gridV: 'rgba(148, 170, 255, 0.05)', axis: 'rgba(200, 210, 240, 0.55)', text: '#eef2ff', muted: '#9aa6c8',
    pill: '#0c1330', card: 'rgba(12, 18, 42, 0.96)', area: 'rgba(61, 142, 245, 0.34)',
  } : {
    blue: '#0b74de', deep: '#0753c8', soft: '#8fbaf2', buy: '#0b6bd3', sell: '#e0670f', tp: '#5d9cec',
    grid: '#e6edf6', gridV: '#eff3f9', axis: '#98a2b3', text: '#0b1426', muted: '#667085',
    pill: '#fff', card: 'rgba(255, 255, 255, 0.97)', area: 'rgba(11, 116, 222, 0.18)',
  };
  const trend = box.querySelector('[data-fd-trend]');
  const FONT = (w, s) => `${w} ${s}px Poppins, system-ui, sans-serif`;

  // ---- the size of the drawing
  let W = 1, H = 1, dpr = 1, small = false, tight = false;
  const P = { l: 0, r: 1, t: 0, b: 1, x0: 0, x1: 1 };
  // an order's label: how far from its level, and how big (a short chart has them closer and smaller, 17 Nov 2026)
  const PO = () => (tight ? 17 : small ? 22 : 28), PS = () => (tight ? 9 : small ? 9.5 : 11);
  let cardBox = null;
  function layout() {
    W = Math.max(1, stage.clientWidth);                // the size in the layout (a moving board is scaled and tilted)
    H = Math.max(1, stage.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    small = W < 520;
    measureCard();
    const card = !!stage.closest('.fd-board--chart');            // the card of the owner's picture: prices left, minutes under
    tight = card && H < 196;
    P.l = card ? (small ? 36 : 42) : 0;
    P.r = card ? W - 6 : W - (small ? 54 : 66);                    // (the old board: the price scale on the right)
    P.t = card ? 10 : small && cardBox ? cardBox.y1 + 10 : 16;
    P.b = H - (card ? 22 : small ? 14 : 16);
    if (card) {
      // Room for the label of the highest order over it and of the lowest one under it (the owner, 16 Nov 2026: on a
      // phone the top label was cut off right under the card's head, the bottom one lay on the minutes). The highest
      // and the lowest order stand `edge` of the height away from the top and the bottom of the chart.
      const need = PO() + Math.round(PS() * 1.95) / 2 + 3;
      const edge = (CYCLES[0].hi - 6) / (CYCLES[0].hi - CYCLES[0].lo);
      for (let i = 0; i < 3; i += 1) {
        P.t = Math.max(10, (need - edge * P.b) / (1 - edge));
        P.b = Math.min(H - 22, (H - 10 - need - edge * P.t) / (1 - edge));
      }
      P.t = Math.round(P.t);
      P.b = Math.round(P.b);
    }
    P.x0 = P.l + (P.r - P.l) * 0.045;
    P.x1 = P.r - (P.r - P.l) * 0.035;
  }
  function measureCard() {
    if (!ui.card) { cardBox = null; return; }
    const c = ui.card;
    cardBox = { x0: c.offsetLeft, y0: c.offsetTop, x1: c.offsetLeft + c.offsetWidth, y1: c.offsetTop + c.offsetHeight };
  }
  const X = (t) => lerp(P.x0, P.x1, clamp((t - T0) / (T1 - T0)));
  let cyc = CYCLES[0];
  const Y = (q) => lerp(P.b, P.t, (q - cyc.lo) / (cyc.hi - cyc.lo));

  // ---- drawing helpers
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function spaced(px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }
  function pill(text, x, y, color, alpha, size) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = FONT(600, size);
    const w = ctx.measureText(text).width + size * 1.5, h = Math.round(size * 1.95);
    const cx = clamp(x, w / 2 + 6, P.r - w / 2 - 6);
    y = clamp(y, h / 2 + 2, H - h / 2 - 2);                       // never cut off by the edge of the drawing
    rr(cx - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = COL.pill;
    ctx.shadowColor = 'rgba(15, 35, 70, 0.10)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + 0.5);
    ctx.restore();
  }
  function diamond(x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  function ring(x, y, k, rad, color, strength) {
    if (k <= 0 || k >= 1) return;
    ctx.beginPath();
    ctx.arc(x, y, 4 + rad * E.outExpo(k), 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.globalAlpha = (1 - k) * strength;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // nothing that floats may sit on the cycle profit card
  function offCard(x0, y0, x1, y1) {
    if (!cardBox || x1 < cardBox.x0 - 8 || x0 > cardBox.x1 + 8) return 0;
    if (cardBox.y0 < H / 2) return Math.max(0, cardBox.y1 + 8 - y0);  // the card is at the top: push it down
    return -Math.max(0, y1 - (cardBox.y0 - 8));                        // the card is at the bottom: push it up
  }

  // ---- one frame of the chart
  let lastPrice = 4120;
  function draw(s, now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fade = Math.min(seg(s, LOOP_AT, LOOP_AT + 0.17), 1 - seg(s, 6.35, 6.65));
    const lab = small ? 10 : 11;

    const card = P.l > 0;
    if (card) {
      // the owner's card: dashed lines with the price on the left, the minutes of the cycle under the chart
      const pLo = Math.ceil(cyc.start + cyc.lo), pHi = Math.floor(cyc.start + cyc.hi), step = P.b - P.t < 170 ? 2 : 1;
      ctx.font = FONT(500, lab);
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      for (let price = pLo + (((step - (pLo % step)) % step)); price <= pHi; price += step) {
        const y = Math.round(Y(price - cyc.start)) + 0.5;
        ctx.strokeStyle = COL.grid;
        ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.r, y); ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.fillStyle = COL.axis;
        ctx.textAlign = 'left';
        ctx.fillText(price.toLocaleString('en-US'), 0, y);
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = fade;
      ctx.fillStyle = COL.axis;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i <= 4; i += 1) ctx.fillText('12:0' + i, lerp(P.x0, P.x1, i / 4), H - 5);
      ctx.globalAlpha = 1;
    } else {
      // the grid of a real chart: a line at every dollar with its price on the scale, and time lines
      ctx.lineWidth = 1;
      ctx.strokeStyle = COL.gridV;
      ctx.beginPath();
      for (let i = 1; i < 8; i += 1) { const x = Math.round(P.l + ((P.r - P.l) * i) / 8) + 0.5; ctx.moveTo(x, P.t); ctx.lineTo(x, P.b); }
      ctx.stroke();
      const pLo = Math.ceil(cyc.start + cyc.lo), pHi = Math.floor(cyc.start + cyc.hi);
      ctx.font = FONT(500, lab);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let price = pLo; price <= pHi; price += 1) {
        const y = Math.round(Y(price - cyc.start)) + 0.5;
        ctx.strokeStyle = COL.grid;
        ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.r, y); ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.fillStyle = COL.axis;
        ctx.fillText(money(price), W - 6, y);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = COL.grid;
      ctx.beginPath(); ctx.moveTo(Math.round(P.r) + 0.5, P.t); ctx.lineTo(Math.round(P.r) + 0.5, P.b); ctx.stroke();
    }

    ctx.save();
    ctx.globalAlpha = fade;
    const qAt = (t) => cyc.dir * priceAt(t);
    const head = clamp(s, T0, T1);

    // trades: the level line of every order, the take profit line of the side that wins, their markers
    for (const tr of TRADES) {
      if (s < tr.at) continue;
      const side = sideIn(tr, cyc), up = side === 'buy' ? 1 : -1, color = side === 'buy' ? COL.buy : COL.sell;
      const closeAt = tr.close ? tr.close.at : Infinity;
      const gone = tr.close && tr.close.kind === 'basket' ? E.inCubic(seg(s, closeAt + 0.02, closeAt + 0.22)) : tr.close ? E.inCubic(seg(s, closeAt, closeAt + 0.25)) : 0;
      if (gone >= 1) continue;
      const x = X(tr.at), yl = Y(cyc.dir * tr.p);
      const wipe = E.outExpo(seg(s, tr.at + 0.05, tr.at + 0.5));
      const flash = tr.close && tr.close.kind === 'basket' ? seg(s, closeAt - 0.14, closeAt) : 0;
      ctx.globalAlpha = fade * 0.8 * (1 - gone);
      ctx.strokeStyle = flash > 0 ? COL.blue : color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, yl); ctx.lineTo(x + (P.r - x) * wipe, yl); ctx.stroke();
      if (tr.side === 'buy') {
        const tk = E.outExpo(seg(s, tr.at + 0.1, tr.at + 0.5)), done = tr.close ? seg(s, closeAt, closeAt + 0.3) : 0;
        if (done < 1) {
          const yt = Y(cyc.dir * (tr.p + TP));
          ctx.globalAlpha = fade * 0.9 * (1 - done);
          ctx.strokeStyle = COL.tp;
          ctx.setLineDash([5, 5]);
          ctx.lineDashOffset = -now / 60;
          ctx.beginPath(); ctx.moveTo(x + 4, yt); ctx.lineTo(x + 4 + (P.r - x - 4) * tk, yt); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const open = E.spring(seg(s, tr.at, tr.at + 0.45));
      let my = yl - up * 9;
      if (tr.close && tr.close.kind === 'tp' && s >= closeAt) my = lerp(my, Y(cyc.dir * (tr.p + TP)) - up * 5, E.outExpo(seg(s, closeAt, closeAt + 0.25)));
      const pulse = tr.close && tr.close.kind === 'basket' ? 0.6 * seg(s, closeAt - 0.12, closeAt) : 0;
      const size = 6.5 * Math.max(0.0001, open * (1 - gone) * (1 + pulse));
      ctx.globalAlpha = fade * (1 - gone);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, yl); ctx.lineTo(x, lerp(yl, my, open)); ctx.stroke();
      diamond(x, my, size, flash > 0.5 ? COL.blue : color);
      ctx.globalAlpha = fade;
      const rAt = tr.close && tr.close.kind === 'tp' && s >= closeAt ? closeAt : tr.at;
      const rx = rAt === closeAt ? X(closeAt) : x, ry = rAt === closeAt ? Y(cyc.dir * (tr.p + TP)) : yl;
      ring(rx, ry, seg(s, rAt, rAt + 0.55), 22, rAt === closeAt ? COL.blue : color, 0.7 * fade);
    }

    // the price, drawing itself, with the soft area under it
    const N = 220, k = (head - T0) / (T1 - T0), n = Math.max(1, Math.round(N * k));
    const pts = [];
    for (let i = 0; i <= n; i += 1) { const t = T0 + ((head - T0) * i) / n; pts.push([X(t), Y(qAt(t))]); }
    const area = ctx.createLinearGradient(0, P.t, 0, P.b);
    area.addColorStop(0, COL.area);
    area.addColorStop(1, 'rgba(11, 116, 222, 0)');
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], P.b);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], P.b);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    const stroke = ctx.createLinearGradient(P.x0, 0, P.x1, 0);
    stroke.addColorStop(0, COL.soft);
    stroke.addColorStop(0.45, COL.blue);
    stroke.addColorStop(1, COL.deep);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineWidth = small ? 2.4 : 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // the head of the line: where the price is now, its line to the scale and its price
    const [hx, hy] = pts[pts.length - 1];
    if (s >= T0 && s < T1) {
      ctx.globalAlpha = fade * 0.16;
      ctx.strokeStyle = COL.blue;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, P.t); ctx.lineTo(Math.round(hx) + 0.5, P.b); ctx.stroke();
    }
    ctx.globalAlpha = fade * 0.55;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = COL.blue;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(P.r, hy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = fade;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
    glow.addColorStop(0, 'rgba(11, 116, 222, 0.32)');
    glow.addColorStop(1, 'rgba(11, 116, 222, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, small ? 4.5 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = COL.blue; ctx.stroke();
    // a price that ticks like a live one
    const live = s >= T0 && s < T1 && !reduced.matches ? (hash(Math.floor(now / 140)) - 0.5) * 0.06 : 0;
    const price = money(cyc.start + qAt(head) + live);
    ctx.font = FONT(600, lab);
    const tw = ctx.measureText(price).width + 14, th = small ? 19 : 21;
    if (!card) {
      rr(P.r + 3, hy - th / 2, W - P.r - 5, th, 6);
      ctx.fillStyle = COL.blue; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(price, P.r + 3 + (W - P.r - 5) / 2, hy + 0.5);
    }
    ctx.textBaseline = 'middle';
    lastPrice = cyc.start + qAt(head) + live;
    if (s >= T0 && s < T1 && hx + 14 + tw < P.r) {
      // while a new order's label comes in where the head is, the price steps aside (fades), so the two never lie one
      // over the other (16 Nov 2026)
      // (and while a take profit's gain rises from where the head is, 17 Nov 2026)
      const busy = Math.max(0, ...TRADES.map((tr) => Math.min(seg(s, tr.at, tr.at + 0.12), 1 - seg(s, tr.at + 0.55, tr.at + 0.75))),
        ...TRADES.filter((tr) => tr.close && tr.close.kind === 'tp').map((tr) => Math.min(seg(s, tr.close.at - 0.06, tr.close.at + 0.04), 1 - seg(s, tr.close.at + (tight ? 0.5 : 0.7), tr.close.at + (tight ? 0.66 : 0.9)))));
      ctx.save();
      ctx.globalAlpha *= 1 - busy;
      ctx.font = FONT(600, small ? 11 : 12.5);
      ctx.fillStyle = COL.text; ctx.textAlign = 'left';
      ctx.fillText(price, hx + 12, hy - (cyc.dir > 0 ? 14 : -14));
      ctx.restore();
    }

    // order labels, exactly at their level: a buy above it, a sell below it
    ctx.globalAlpha = 1;
    for (const tr of TRADES) {
      if (s < tr.at + 0.08) continue;
      const closeAt = tr.close ? tr.close.at : Infinity, gone = seg(s, closeAt, closeAt + 0.2);
      if (gone >= 1) continue;
      const side = sideIn(tr, cyc), up = side === 'buy' ? 1 : -1;
      const y = Y(cyc.dir * tr.p) - up * PO();
      pill(`${side.toUpperCase()} L${tr.lvl}  ${tr.lot.toFixed(2)}`, X(tr.at), y, side === 'buy' ? COL.buy : COL.sell, fade * E.outExpo(seg(s, tr.at + 0.08, tr.at + 0.35)) * (1 - gone), PS());
    }

    // take profits: the gain rises from the take profit line
    for (const tr of TRADES) {
      if (!tr.close || tr.close.kind !== 'tp') continue;
      const kk = seg(s, tr.close.at, tr.close.at + (tight ? 0.62 : 0.85));    // (quicker on a short chart: gone before the next label)
      if (kk <= 0 || kk >= 1) continue;
      const x = X(tr.close.at), up = sideIn(tr, cyc) === 'buy' ? 1 : -1;
      let y = Y(cyc.dir * (tr.p + TP)) - up * (tight ? 22 : small ? 30 : 38) - kk * (tight ? 12 : small ? 22 : 34);
      const big = tight ? 15 : small ? 17 : 22, sub = tight ? 12 : small ? 13 : 16;
      y += offCard(x - 50, y - big, x + 50, y + 16);
      y = clamp(y, big * 0.8 + 3, H - 16 - sub);                     // never out of the top, never on the minutes
      ctx.globalAlpha = fade * (1 - kk * kk);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = FONT(800, big);
      ctx.fillStyle = COL.blue;
      ctx.fillText(`+${TP.toFixed(2)}$`, x, y);
      ctx.font = FONT(600, tight ? 8 : small ? 8.5 : 9.5);
      spaced(2);
      ctx.fillText('TAKE PROFIT', x, y + sub);
      spaced(0);
    }

    // the basket: lightning from every holding order to one point, a burst and a shock ring, then BASKET CLOSED
    const core = [X(BASKET_AT), Y(qAt(BASKET_AT))];
    const bt = s - BASKET_AT;
    if (bt > -0.1 && bt < 0.08) {
      const frame = Math.floor(now / 16);
      for (const tr of TRADES) {
        if (tr.side !== 'sell') continue;
        const side = sideIn(tr, cyc), up = side === 'buy' ? 1 : -1;
        const from = [X(tr.at), Y(cyc.dir * tr.p) - up * 9];
        ctx.globalAlpha = fade * 0.65 * (1 - seg(bt, 0, 0.08));
        ctx.strokeStyle = side === 'buy' ? COL.buy : COL.sell;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 14; i += 1) {
          const kq = i / 13, j = i === 0 || i === 13 ? 0 : 16;
          const xx = lerp(from[0], core[0], kq) + (hash(frame * 31 + i + tr.lvl * 7) - 0.5) * j;
          const yy = lerp(from[1], core[1], kq) + (hash(frame * 17 + i + tr.lvl * 11) - 0.5) * j;
          if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    const bk = seg(s, BASKET_AT, BASKET_AT + 1.0);
    if (bk > 0 && bk < 1 && !reduced.matches) {           // with "reduce motion" the still picture has no sparks
      for (let i = 0; i < 54; i += 1) {
        const ang = hash(i * 3 + 1) * Math.PI * 2, v = 18 + hash(i * 5 + 2) * 52;
        const d = v * (1 - Math.exp(-4 * bk));
        ctx.globalAlpha = fade * (1 - bk);
        ctx.fillStyle = i % 3 === 0 ? COL.sell : i % 3 === 1 ? COL.blue : COL.soft;
        ctx.beginPath();
        ctx.arc(core[0] + Math.cos(ang) * d, core[1] + Math.sin(ang) * d * 0.8 + 26 * bk * bk, 2.2 * (1 - bk * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (!reduced.matches) ring(core[0], core[1], seg(s, BASKET_AT, BASKET_AT + 0.7), tight ? 36 : small ? 46 : 70, COL.blue, 0.6 * fade);
    const show = seg(s, BASKET_AT, BASKET_AT + 0.22);
    if (show > 0 && s < BASKET_AT + 0.95) {
      const e = E.outExpo(show), out = 1 - seg(s, BASKET_AT + 0.7, BASKET_AT + 0.95);
      const bw = tight ? 176 : small ? 196 : 262, bh = tight ? 44 : small ? 54 : 66;
      const beside = cardBox && cardBox.y1 > P.t + 4;                 // the card stands in the chart (a computer)
      const minX = (beside ? cardBox.x1 : 0) + bw / 2 + 10, maxX = P.r - bw / 2 - 8;
      const cx = clamp(core[0], Math.min(minX, maxX), maxX);
      // on the empty side of the line: under the close in the uptrend, over it in the downtrend
      const cy = clamp(core[1] + cyc.dir * (tight ? 40 : small ? 66 : 92), P.t + bh / 2 + 4, P.b - bh / 2 - 4);
      const zoom = lerp(small ? 1.12 : 1.4, 1, e);
      ctx.save();
      ctx.globalAlpha = fade * out;
      ctx.translate(cx, cy);
      ctx.scale(zoom, zoom);
      rr(-bw / 2, -bh / 2, bw, bh, tight ? 13 : 16);
      ctx.fillStyle = COL.card;
      ctx.shadowColor = 'rgba(8, 102, 207, 0.28)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 10;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COL.blue;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = FONT(800, tight ? 13 : small ? 15 : 19);
      spaced(lerp(tight ? 2.5 : small ? 3 : 5, tight ? 1.2 : 1.5, e));
      ctx.fillStyle = COL.blue;
      ctx.fillText('BASKET CLOSED', 0, tight ? -1 : small ? 1 : 2);
      spaced(0);
      ctx.font = FONT(500, tight ? 9.5 : small ? 10 : 11.5);
      ctx.fillStyle = COL.muted;
      ctx.fillText(`+${BASKET.toFixed(2)}$  ·  3 ${cyc.hold.toLowerCase()}s closed together`, 0, tight ? 14 : small ? 17 : 21);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- the cycle profit card (words, so they stay sharp) and the four steps under the title
  const last = {};
  function put(key, el, text) { if (el && last[key] !== text) { last[key] = text; el.textContent = text; } }
  function paintCard(s, ci, fade) {
    const c = CYCLES[ci];
    if (ui.card && last.ci !== ci) {
      last.ci = ci;
      stage.dataset.cycle = String(ci + 1);
      if (trend) [...trend.children].forEach((b, k) => b.classList.toggle('is-on', k === ci));   // Uptrend / Downtrend on the board
      requestAnimationFrame(layout);
    }
    if (ui.card) ui.card.style.opacity = String(fade);
    put('cycle', ui.cycle, c.name);
    put('price', ui.price, '$' + money(lastPrice));
    const cp = cycleProfit(s);
    let shown = cp;
    for (const tr of TRADES) if (tr.close && tr.close.kind === 'tp' && s >= tr.close.at && s < tr.close.at + 0.3) shown = lerp(cp - TP, cp, E.outCubic(seg(s, tr.close.at, tr.close.at + 0.3)));
    if (s >= BASKET_AT && s < BASKET_AT + 0.4) shown = lerp(cp - BASKET, cp, E.outCubic(seg(s, BASKET_AT, BASKET_AT + 0.4)));
    put('value', ui.value, `+${shown.toFixed(2)}$`);
    put('change', ui.change, '\u25B2 +' + shown.toFixed(2) + '$ this cycle');
    const tps = TRADES.filter((tr) => tr.close && tr.close.kind === 'tp' && s >= tr.close.at).length;
    if (ui.tp && ui.tp.tagName === 'DD') put('tp', ui.tp, '+' + (tps * TP).toFixed(2) + '$');
    else if (ui.tp) { ui.tp.hidden = !tps; put('tp', ui.tp, `TP +${(tps * TP).toFixed(2)}`); }
    if (ui.basket) { ui.basket.hidden = s < BASKET_AT; put('bchip', ui.basket, `Basket +${BASKET.toFixed(2)}`); }
    const sb = s < BASKET_AT ? Math.max(0, basketAt(s)) : BASKET, mk = clamp(sb / BASKET);
    put('bname', ui.bname, `${c.hold} basket`);
    put('bval', ui.bval, `${sb.toFixed(2)} / ${BASKET.toFixed(2)}$`);
    if (ui.bar) ui.bar.style.transform = `scaleX(${mk.toFixed(3)})`;
    if (ui.card) { ui.card.classList.toggle('is-full', mk >= 1); ui.card.dataset.hold = c.hold.toLowerCase(); }
  }
  let lit = -1;
  function setStep(n) {
    if (n === lit) return;
    const before = lit;
    lit = n;
    steps.forEach((li, i) => { li.classList.toggle('was-on', i === before); li.classList.toggle('is-on', i === n); });
  }

  // ---- its clock: it runs only while it can be seen (on screen, its box open on a computer, the tab in front)
  let tau = 0, lastNow = 0, raf = 0, seen = false;
  const canRun = () => seen && !box.classList.contains('is-shut') && !document.hidden && !reduced.matches;
  function render(now) {
    const sAbs = tau * SPEED;
    const s = reduced.matches ? STILL_AT : LOOP_AT + (sAbs % LOOP);
    const ci = reduced.matches ? 0 : Math.floor(sAbs / LOOP) % 2 === 1 ? 1 : 0;
    cyc = CYCLES[ci];
    draw(s, now);
    paintCard(s, ci, reduced.matches ? 1 : Math.min(seg(s, LOOP_AT, LOOP_AT + 0.17), 1 - seg(s, 6.35, 6.65)));
    setStep(STEP_AT.reduce((at, from, i) => (s >= from ? i : at), 0));
  }
  function frame(now) {
    raf = 0;
    if (!canRun()) return;
    tau += clamp((now - lastNow) / 1000, 0, 0.05);          // a frame's own time can come a little before the last one
    lastNow = now;
    render(now);
    raf = requestAnimationFrame(frame);
  }
  function run() {
    if (canRun()) {
      if (!raf) { lastNow = performance.now(); raf = requestAnimationFrame(frame); }
    } else render(performance.now());
  }
  layout();
  render(performance.now());
  new ResizeObserver(() => { layout(); render(performance.now()); }).observe(stage);
  if (window.IntersectionObserver) new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; run(); }, { rootMargin: '60px 0px' }).observe(stage);
  else { seen = true; run(); }
  new MutationObserver(run).observe(box, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', run);
  reduced.addEventListener('change', run);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render(performance.now()));
})();
