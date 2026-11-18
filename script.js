/* ==========================================================================
   Clean addresses: rzgspro.com/signup, not rzgspro.com/signup.html
   The host serves every page at both addresses and the links use the clean one. A page opened at an old
   ".html" address (a bookmark, an email link) tidies its own address here; "?..." and "#..." are kept.
   Only on the real site: a simple test server (an IP address, localhost) cannot open addresses without .html.
   ========================================================================== */
(function tidyAddress(place) {
  const path = place.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  if (path !== place.pathname && /[a-z]\.[a-z]/i.test(place.hostname)) {
    history.replaceState(null, '', (path || '/') + place.search + place.hash);
  }
})(window.location);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ==========================================================================
   Header: scrolled state + mobile menu
   ========================================================================== */
const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.getElementById('primary-nav');

// the dark story of the home page and the partner brokers after it: while they pass under the header, the header is dark
// glass (theme.css: .on-dark)
const darkParts = [...document.querySelectorAll('.fd, .pz')];
function onScroll() {
  header.classList.toggle('is-scrolled', window.scrollY > 8);
  document.documentElement.classList.toggle('past-fold', window.scrollY > window.innerHeight * 0.5);
  if (darkParts.length) {
    const middle = header.offsetHeight / 2;
    header.classList.toggle('on-dark', darkParts.some((part) => {
      const r = part.getBoundingClientRect();
      return r.top < middle && r.bottom > middle;
    }));
  }
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Join community on phones and tablets: the icon and its words, but the words fold while a main button passes under
   them, so it never covers one. */
const community = document.querySelector('.tg-float');
if (community) {
  const smallScreen = window.matchMedia('(max-width: 1023.98px)');
  // (and the three partner brokers' buttons, which float low on a phone's screen)
  const mainButtons = [...document.querySelectorAll('main .btn-primary, main .btn-lg, main .pz .partner-card')];
  const story = document.querySelector('.fd .fd-stage'); // the dark story of the home page: its words pass under the button
  let fullWidth = 0;
  let looking = false;
  const foldWords = () => {
    looking = false;
    if (!smallScreen.matches) {
      community.classList.remove('is-folded');
      return;
    }
    const box = community.getBoundingClientRect();
    fullWidth = Math.max(fullWidth, box.width);
    const left = box.right - fullWidth; // how far it reaches with its words out
    const s = story && story.closest('.is-pinned') ? story.getBoundingClientRect() : null;
    community.classList.toggle('is-folded', (!!s && s.bottom > box.top && s.top < box.bottom) || mainButtons.some((button) => {
      const r = button.getBoundingClientRect();
      return r.width > 0 && r.bottom > box.top && r.top < box.bottom && r.right > left && r.left < box.right;
    }));
  };
  const lookSoon = () => {
    if (looking) return;
    looking = true;
    requestAnimationFrame(foldWords);
  };
  window.addEventListener('scroll', lookSoon, { passive: true });
  window.addEventListener('resize', () => {
    fullWidth = 0;
    community.classList.remove('is-folded');
    lookSoon();
  });
  window.addEventListener('load', lookSoon);
  if (document.fonts) document.fonts.ready.then(lookSoon);
  // the page can still move with nobody scrolling: the free-trial bar arrives, the first sections slide in
  new ResizeObserver(lookSoon).observe(document.body);
  setTimeout(lookSoon, 1500);
  lookSoon();
}

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
   Top menu: drop-down panels (the owner's picture, 14 Nov 2026)
   A computer: a panel opens under the menu bar when the pointer rests on its item, or with a click, Enter or Space;
   it closes when the pointer leaves, with Escape, or with a click elsewhere. A phone: each item opens its links
   inside the menu, one at a time.
   ========================================================================== */
const menuItems = [...document.querySelectorAll('[data-menu]')];
if (menuItems.length) {
  const pointerMenus = window.matchMedia('(min-width: 1024px) and (hover: hover)');
  let openItem = null;
  let openTimer = 0;
  let shutTimer = 0;
  let restedAt = 0; // when the pointer last opened a panel: a click just after keeps it open
  const show = (item, on) => {
    item.classList.toggle('is-open', on);
    item.querySelector('.nav-chev-btn').setAttribute('aria-expanded', String(on));
  };
  const openOnly = (item) => {
    clearTimeout(shutTimer);
    clearTimeout(openTimer);
    if (openItem && openItem !== item) show(openItem, false);
    openItem = item;
    show(item, true);
  };
  const shutMenus = () => {
    clearTimeout(openTimer);
    clearTimeout(shutTimer);
    if (openItem) show(openItem, false);
    openItem = null;
  };
  menuItems.forEach((item) => {
    // the item's name goes to its page; the small arrow beside it opens and closes its panel (15 Nov 2026)
    const trigger = item.querySelector('.nav-chev-btn');
    trigger.addEventListener('click', () => {
      if (item.classList.contains('is-open') && performance.now() - restedAt > 600) shutMenus();
      else openOnly(item);
    });
    // a mouse: open after a short rest (passing over does not open it), at once while another panel is open
    item.addEventListener('pointerenter', (event) => {
      if (!pointerMenus.matches || event.pointerType !== 'mouse') return;
      clearTimeout(shutTimer);
      clearTimeout(openTimer);
      if (openItem === item) return;
      const rest = () => { restedAt = performance.now(); openOnly(item); };
      if (openItem) rest();
      else openTimer = setTimeout(rest, 90);
    });
    item.addEventListener('pointerleave', (event) => {
      if (!pointerMenus.matches || event.pointerType !== 'mouse') return;
      clearTimeout(openTimer);
      shutTimer = setTimeout(() => { if (openItem === item) shutMenus(); }, 240);
    });
    // the keyboard leaves the panel: it closes
    item.addEventListener('focusout', (event) => {
      if (openItem === item && !item.contains(event.relatedTarget)) shutMenus();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !item.classList.contains('is-open')) return;
      event.stopPropagation(); // on a phone the menu itself stays open
      shutMenus();
      trigger.focus();
    });
    // a link in the panel: the panel closes (a link to a part of this page only scrolls)
    item.querySelectorAll('.mega a').forEach((link) => link.addEventListener('click', shutMenus));
  });
  document.addEventListener('click', (event) => {
    if (openItem && !openItem.contains(event.target)) shutMenus();
  });
  pointerMenus.addEventListener('change', shutMenus);
}

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

/* ==========================================================================
   In-page links glide (the owner, 18 Nov 2026: "Start now" reached the partner brokers far too fast, flashing through
   the six parts of Why choose and lagging on a phone: "scroll slowly but faster than by hand, about 1.5 s to 2 s"):
   a link to a part of this page scrolls there smoothly, gently starting and stopping, in at most 1.8 s (a short hop
   about half a second). A touch, the wheel, a key or a mouse press stops it at once. With "reduce motion" it jumps.
   The parts on the way show and turn over as when scrolling by hand (the owner: "let it flip like normal").
   ========================================================================== */
(function glideLinks() {
  const root = document.documentElement;
  const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;            // slow, quicker, slow
  let run = 0;
  const stop = () => {
    if (!run) return;
    cancelAnimationFrame(run);
    run = 0;
  };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => window.addEventListener(type, stop, { passive: true }));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('data-plans') || link.classList.contains('skip-link') || link.target === '_blank') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || url.hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    stop();
    const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const goal = () => Math.max(0, Math.min(root.scrollHeight - innerHeight, target.getBoundingClientRect().top + window.scrollY - pad));
    const from = window.scrollY;
    const distance = Math.abs(goal() - from);
    if (url.hash !== location.hash) history.pushState(null, '', url.hash);
    if (reducedMotion.matches || distance < 2) {
      window.scrollTo({ top: goal(), behavior: 'instant' });
      return;
    }
    const duration = Math.min(1800, Math.max(500, 400 + distance * 0.25));
    const t0 = performance.now();
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      // the goal is measured again each frame: a phone's bars can change the page's height on the way
      window.scrollTo({ top: from + (goal() - from) * ease(k), behavior: 'instant' });
      if (k < 1) run = requestAnimationFrame(frame);
      else run = 0;
    };
    run = requestAnimationFrame(frame);
  });
})();

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
      // what comes into sight together comes one after another (the owner's video, 8 Nov 2026), unless the page
      // already gave it its own delay
      let next = 0;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (!entry.target.style.getPropertyValue('--d')) entry.target.style.setProperty('--d', `${Math.min(next, 5) * 70}ms`);
        next += 1;
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
   One-tap card: Activate / Pause demo
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
    toggleLabel.textContent = active ? 'Pause the bot' : 'Activate the bot';
    status.textContent = active ? 'The bot is active' : 'The bot is paused';
  });
}

// Footer year
const yearEl = document.querySelector('[data-year]');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ==========================================================================
   Partner brokers: the row of cards slides slowly and never ends.
   The page holds each broker once; the copies that fill the loop are made here.
   ========================================================================== */
const partnerRail = document.querySelector('[data-partner-rail]');

if (partnerRail && !reducedMotion.matches) {
  const track = partnerRail.querySelector('.partner-track');
  const cards = [...track.children];
  partnerRail.classList.add('is-moving');
  const setWidth = track.scrollWidth;                                             // one set of cards
  const sets = Math.ceil(Math.max(partnerRail.clientWidth, 2000) / setWidth) + 1; // half of the loop is wider than the screen
  for (let i = 1; i < sets * 2; i += 1) {
    cards.forEach((card) => {
      const copy = card.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');                                    // screen readers and the Tab key meet each broker once
      copy.querySelectorAll('a').forEach((link) => { link.tabIndex = -1; });
      track.append(copy);
    });
  }
  partnerRail.style.setProperty('--partner-time', `${Math.round((setWidth * sets) / 40)}s`);   // about 40 px per second
}

/* ==========================================================================
   Running lines (the owner, 16 Nov 2026): a line of short points that runs to the left and never ends.
   The page holds each point once; the copies that fill the loop are made here.
   Without this script, or with "reduce motion", the points stand still.
   ========================================================================== */
if (!reducedMotion.matches) {
  document.querySelectorAll('[data-run]').forEach((strip) => {
    const track = strip.querySelector('.run-track');
    if (!track || !track.children.length) return;
    const points = [...track.children];
    strip.classList.add('is-moving');
    const setWidth = track.scrollWidth;                                           // one set of points
    if (!setWidth) { strip.classList.remove('is-moving'); return; }
    const sets = Math.ceil(Math.max(strip.clientWidth, 1600) / setWidth) + 1;     // half of the loop is wider than the line
    for (let i = 1; i < sets * 2; i += 1) {
      points.forEach((point) => {
        const copy = point.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');                                  // a screen reader meets each point once
        track.append(copy);
      });
    }
    strip.style.setProperty('--run-time', `${Math.round((setWidth * sets) / 34)}s`); // about 34 px per second
  });
}

/* ==========================================================================
   Background: live trading chart (candlesticks + a ticking price line)
   ========================================================================== */
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
const UP = '43, 243, 145';
const DOWN = '24, 160, 200';
const LIME = '25, 211, 255';

let width = 0;
let height = 0;
let layers = [];
let rafId = null;
let lastTime = 0;
let lastDraw = 0;

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

    // symbol tag riding the last price: only on wide screens, where it has clear space beside the content
    if (width < 1400) return;
    const label = 'XAUUSD';
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
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
    new LineLayer({ top: 0.36, band: 0.26, step: 7, speed: 16, end: small ? 0.72 : 0.84, alpha: 0.26, fill: 0.04 }),
    new CandleLayer({ top: 0.66, band: 0.24, spacing: small ? 15 : 20, body: small ? 7 : 9, speed: 14, alpha: 0.2, volume: true }),
  ];
  layers.forEach((layer) => layer.resize());
}

function resizeCanvas() {
  width = document.documentElement.clientWidth;
  height = window.innerHeight;
  // on a phone the chart is faint and small: a sharper picture would only cost battery
  const dpr = width < 700 ? 1 : Math.min(window.devicePixelRatio || 1, 2);
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
  rafId = requestAnimationFrame(frame);
  // the chart moves a few pixels a second: 24 pictures a second look the same and save the battery.
  // The crosshair follows a mouse at full speed.
  if (pointer.x === null && now - lastDraw < 40) return;
  lastDraw = now;
  // clamp so returning to a background tab doesn't fast-forward the chart
  const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
  lastTime = now;
  layers.forEach((layer) => layer.update(dt));
  render(now);
}

function startChart() {
  cancelAnimationFrame(rafId);
  lastTime = 0;
  // the light theme hides the chart: then it is not drawn at all
  if (getComputedStyle(canvas).display === 'none') return;
  if (reducedMotion.matches) render(0);
  else rafId = requestAnimationFrame(frame);
}

let resizeRaf = null;
window.addEventListener('resize', () => {
  // a phone's address bar sliding away changes only the height: the chart carries on as it is
  if (document.documentElement.clientWidth === width && matchMedia('(pointer: coarse)').matches) return;
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeCanvas();
    if (reducedMotion.matches && getComputedStyle(canvas).display !== 'none') render(0);
  });
});
reducedMotion.addEventListener('change', startChart);

resizeCanvas();
startChart();
// redraw once the mono font is ready so the price tag uses it
if (document.fonts && reducedMotion.matches && getComputedStyle(canvas).display !== 'none') document.fonts.ready.then(() => render(0));
