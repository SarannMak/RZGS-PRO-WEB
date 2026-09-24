const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ==========================================================================
   Header: scrolled state + mobile menu
   ========================================================================== */
const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.getElementById('primary-nav');

function onScroll() {
  header.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

function setMenu(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  nav.classList.toggle('is-open', open);
  header.classList.toggle('menu-open', open);
}
const menuIsOpen = () => menuToggle.getAttribute('aria-expanded') === 'true';

menuToggle.addEventListener('click', () => setMenu(!menuIsOpen()));
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('click', (event) => {
  if (menuIsOpen() && !header.contains(event.target)) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuIsOpen()) {
    setMenu(false);
    menuToggle.focus();
  }
});
window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
  if (event.matches) setMenu(false);
});

/* ==========================================================================
   Highlight the link for the section in view
   (home page nav + the "On this page" list on legal pages)
   ========================================================================== */
function highlightWhileScrolling(links, extraSections = []) {
  if (!links.length) return;
  const sections = [...extraSections, ...links.map((link) => document.querySelector(link.hash))].filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          const active = link.hash === `#${entry.target.id}`;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  sections.forEach((section) => observer.observe(section));
}

// The hero is observed too, so scrolling back to the top clears the highlight
highlightWhileScrolling([...document.querySelectorAll('.nav-link[href^="#"]')], [document.getElementById('top')].filter(Boolean));
highlightWhileScrolling([...document.querySelectorAll('.toc a[href^="#"]')]);

// "On this page" is a collapsible box on phones and an always-open sidebar on desktop
const tocBoxes = document.querySelectorAll('[data-toc]');
if (tocBoxes.length) {
  const desktop = window.matchMedia('(min-width: 1024px)');
  const syncToc = () => tocBoxes.forEach((box) => { box.open = desktop.matches; });
  syncToc();
  desktop.addEventListener('change', syncToc);
  // on phones, close the box after jumping to a section
  tocBoxes.forEach((box) => box.addEventListener('click', (event) => {
    if (!desktop.matches && event.target.closest('a')) box.open = false;
  }));
}

/* ==========================================================================
   Scroll reveal
   ========================================================================== */
const revealEls = document.querySelectorAll('.reveal');

if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  revealEls.forEach((el) => el.classList.add('is-visible'));
} else {
  const revealer = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
  );
  revealEls.forEach((el) => revealer.observe(el));
}

/* ==========================================================================
   Card spotlight (follows the pointer)
   ========================================================================== */
document.querySelectorAll('[data-spotlight]').forEach((card) => {
  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  });
});

/* ==========================================================================
   One-tap card: Activate / Pause AI Trading demo
   ========================================================================== */
const aiPanel = document.querySelector('[data-ai-panel]');

if (aiPanel) {
  const toggle = aiPanel.querySelector('[data-ai-toggle]');
  const toggleLabel = aiPanel.querySelector('[data-ai-toggle-label]');
  const chip = aiPanel.querySelector('[data-ai-chip]');
  const status = aiPanel.querySelector('[data-ai-status]');

  toggle.addEventListener('click', () => {
    const active = aiPanel.dataset.state !== 'active';
    aiPanel.dataset.state = active ? 'active' : 'paused';
    chip.textContent = active ? 'Active' : 'Paused';
    toggleLabel.textContent = active ? 'Pause AI Trading' : 'Activate AI Trading';
    status.textContent = active ? 'AI trading is active' : 'AI trading is paused';
  });
}

// Footer year
const yearEl = document.querySelector('[data-year]');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ==========================================================================
   Background: live trading chart (candlesticks + a ticking price line)
   ========================================================================== */
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
const UP = '0, 239, 167';
const DOWN = '255, 95, 126';
const LIME = '130, 255, 0';

let width = 0;
let height = 0;
let layers = [];
let rafId = null;
let lastTime = 0;

// Mouse crosshair, like a charting terminal (mouse only, not touch)
const pointer = { x: null, y: null };
window.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => {
  pointer.x = null;
  pointer.y = null;
});

// Random walk with trend regimes and gentle mean reversion, so price swings up and down
function makeWalk() {
  let price = 0;
  let drift = 0;
  return () => {
    if (Math.random() < 0.05) drift = (Math.random() - 0.5) * 0.9;
    drift = drift * 0.98 - price * 0.002;
    const open = price;
    const close = open + drift + (Math.random() - 0.5);
    price = close;
    return {
      open,
      close,
      high: Math.max(open, close) + Math.random() * 0.6,
      low: Math.min(open, close) - Math.random() * 0.6,
      volume: 0.25 + Math.random() * 0.75,
    };
  };
}

// Auto-scaling price axis that eases toward the visible range instead of jumping
class Scale {
  constructor() {
    this.lo = null;
    this.hi = null;
  }
  fit(lo, hi, k) {
    if (this.lo === null) {
      this.lo = lo;
      this.hi = hi;
    } else {
      this.lo += (lo - this.lo) * k;
      this.hi += (hi - this.hi) * k;
    }
  }
  y(value, top, bandHeight) {
    return top + ((this.hi - value) / (this.hi - this.lo || 1)) * bandHeight;
  }
}

class CandleLayer {
  constructor(options) {
    Object.assign(this, options); // top, band, spacing, body, speed, alpha, volume
    this.next = makeWalk();
    this.candles = [];
    this.offset = 0;
    this.scale = new Scale();
  }

  resize() {
    const count = Math.ceil(width / this.spacing) + 2;
    while (this.candles.length < count) this.candles.push(this.next());
    if (this.candles.length > count) this.candles.splice(0, this.candles.length - count);
    this.fitScale(1);
  }

  fitScale(k) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of this.candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    this.scale.fit(lo, hi, k);
  }

  update(dt) {
    this.offset += this.speed * dt;
    while (this.offset >= this.spacing) {
      this.offset -= this.spacing;
      this.candles.shift();
      this.candles.push(this.next());
    }
    this.fitScale(Math.min(1, dt * 1.5));
  }

  draw() {
    const top = this.top * height;
    const band = this.band * height;
    const upBodies = new Path2D();
    const downBodies = new Path2D();
    const upWicks = new Path2D();
    const downWicks = new Path2D();
    const volumes = new Path2D();

    this.candles.forEach((c, i) => {
      const x = Math.round(i * this.spacing - this.offset);
      const cx = x + Math.floor(this.body / 2) + 0.5;
      const yOpen = this.scale.y(c.open, top, band);
      const yClose = this.scale.y(c.close, top, band);
      const isUp = c.close >= c.open;

      const wicks = isUp ? upWicks : downWicks;
      wicks.moveTo(cx, this.scale.y(c.high, top, band));
      wicks.lineTo(cx, this.scale.y(c.low, top, band));
      (isUp ? upBodies : downBodies).rect(x, Math.min(yOpen, yClose), this.body, Math.max(1.5, Math.abs(yClose - yOpen)));

      if (this.volume) {
        const h = c.volume * height * 0.05;
        volumes.rect(x, height - h, this.body, h);
      }
    });

    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${UP}, ${this.alpha * 0.8})`;
    ctx.stroke(upWicks);
    ctx.fillStyle = `rgba(${UP}, ${this.alpha})`;
    ctx.fill(upBodies);
    ctx.strokeStyle = `rgba(${DOWN}, ${this.alpha * 0.7})`;
    ctx.stroke(downWicks);
    ctx.fillStyle = `rgba(${DOWN}, ${this.alpha * 0.85})`;
    ctx.fill(downBodies);
    if (this.volume) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.fill(volumes);
    }
  }
}

// Price line that "ticks" live at its right end, with a last-price marker
class LineLayer {
  constructor(options) {
    Object.assign(this, options); // top, band, step, speed, end, alpha, fill
    // smoothed walk so the line swings up and down without jittering
    const walk = makeWalk();
    let smooth = null;
    this.next = () => {
      const close = walk().close;
      smooth = smooth === null ? close : smooth * 0.65 + close * 0.35;
      return smooth;
    };
    this.points = [];
    this.target = 0;
    this.offset = 0;
    this.scale = new Scale();
  }

  get endX() {
    return width * this.end;
  }

  resize() {
    const count = Math.ceil(this.endX / this.step) + 2;
    while (this.points.length < count) this.points.push(this.next());
    if (this.points.length > count) this.points.splice(0, this.points.length - count);
    this.target = this.next();
    this.fitScale(1);
  }

  fitScale(k) {
    let lo = this.target;
    let hi = this.target;
    for (const p of this.points) {
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const pad = (hi - lo) * 0.12;
    this.scale.fit(lo - pad, hi + pad, k);
  }

  update(dt) {
    this.offset += this.speed * dt;
    while (this.offset >= this.step) {
      this.offset -= this.step;
      this.points.shift();
      this.points.push(this.target);
      this.target = this.next();
    }
    this.fitScale(Math.min(1, dt * 1.5));
  }

  draw(now) {
    const top = this.top * height;
    const band = this.band * height;
    const n = this.points.length;
    const endX = this.endX;
    const last = this.points[n - 1];
    const live = last + (this.target - last) * (this.offset / this.step);
    const liveY = this.scale.y(live, top, band);

    const line = new Path2D();
    const firstX = endX - (n - 1) * this.step - this.offset;
    this.points.forEach((p, i) => {
      const x = endX - (n - 1 - i) * this.step - this.offset;
      const y = this.scale.y(p, top, band);
      if (i === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    });
    line.lineTo(endX, liveY);

    // soft area under the line
    const area = new Path2D(line);
    area.lineTo(endX, top + band);
    area.lineTo(firstX, top + band);
    area.closePath();
    const fillGradient = ctx.createLinearGradient(0, top, 0, top + band);
    fillGradient.addColorStop(0, `rgba(${LIME}, ${this.fill})`);
    fillGradient.addColorStop(1, `rgba(${LIME}, 0)`);
    ctx.fillStyle = fillGradient;
    ctx.fill(area);

    const strokeGradient = ctx.createLinearGradient(0, 0, endX, 0);
    strokeGradient.addColorStop(0, `rgba(${UP}, 0)`);
    strokeGradient.addColorStop(0.35, `rgba(${UP}, ${this.alpha * 0.7})`);
    strokeGradient.addColorStop(1, `rgba(${LIME}, ${this.alpha})`);
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke(line);

    // last-price line to the right edge
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = `rgba(${LIME}, 0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(endX, Math.round(liveY) + 0.5);
    ctx.lineTo(width, Math.round(liveY) + 0.5);
    ctx.stroke();
    ctx.restore();

    // pulsing live dot
    const pulse = (now / 1600) % 1;
    ctx.fillStyle = `rgba(${LIME}, ${0.35 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(endX, liveY, 4 + pulse * 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${LIME}, 0.9)`;
    ctx.beginPath();
    ctx.arc(endX, liveY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // symbol tag riding the last price (skipped on phones, where the hero art covers it)
    if (width < 700) return;
    const label = 'XAUUSD';
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    const tagW = ctx.measureText(label).width + 14;
    const tagX = width - tagW - 12;
    const tagY = Math.round(liveY - 10);
    ctx.fillStyle = `rgba(${LIME}, 0.12)`;
    ctx.strokeStyle = `rgba(${LIME}, 0.35)`;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, tagW, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(${LIME}, 0.8)`;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tagX + 7, tagY + 10.5);
  }
}

function buildLayers() {
  const small = width < 700;
  layers = [
    new CandleLayer({ top: 0.08, band: 0.24, spacing: small ? 11 : 14, body: small ? 5 : 6, speed: 9, alpha: 0.13 }),
    new LineLayer({ top: 0.36, band: 0.26, step: 7, speed: 16, end: small ? 0.72 : 0.84, alpha: 0.4, fill: 0.06 }),
    new CandleLayer({ top: 0.66, band: 0.24, spacing: small ? 15 : 20, body: small ? 7 : 9, speed: 14, alpha: 0.2, volume: true }),
  ];
  layers.forEach((layer) => layer.resize());
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = document.documentElement.clientWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (layers.length) layers.forEach((layer) => layer.resize());
  else buildLayers();
}

function fadeLeftEdge() {
  // candles scroll out to the left, so let them dissolve instead of being cut off
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const gradient = ctx.createLinearGradient(0, 0, width * 0.18, 0);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawCrosshair() {
  if (pointer.x === null || reducedMotion.matches) return;
  const x = Math.round(pointer.x) + 0.5;
  const y = Math.round(pointer.y) + 0.5;
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.restore();
}

function render(now) {
  ctx.clearRect(0, 0, width, height);
  layers.forEach((layer) => layer.draw(now));
  fadeLeftEdge();
  drawCrosshair();
}

function frame(now) {
  // clamp so returning to a background tab doesn't fast-forward the chart
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;
  layers.forEach((layer) => layer.update(dt));
  render(now);
  rafId = requestAnimationFrame(frame);
}

function startChart() {
  cancelAnimationFrame(rafId);
  lastTime = 0;
  if (reducedMotion.matches) render(0);
  else rafId = requestAnimationFrame(frame);
}

let resizeRaf = null;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeCanvas();
    if (reducedMotion.matches) render(0);
  });
});
reducedMotion.addEventListener('change', startChart);

resizeCanvas();
startChart();
// redraw once the mono font is ready so the price tag uses it
if (document.fonts && reducedMotion.matches) document.fonts.ready.then(() => render(0));
