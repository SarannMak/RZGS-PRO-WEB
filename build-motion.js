/* ==========================================================================
   RZGS-PRO: the page builds itself (the owner, 9 Nov 2026, from a reel of an AI design tool).

   A few cursors, each with a tag saying what it does, fly over the page at the same time and
   make it: one draws a box that the panel fills, one drags a block into place, one scales a
   part up from its corner handles, and the words are typed in behind them, caret and all.
   About a second and a half; a tap, a key or a scroll ends it at once and leaves the page as
   it is. Light: only transforms, opacity and clipping (no canvas, no 3D).

   window.rzgsBuild.play({ blocks, roots, scroller, bits }) builds the given blocks (panels,
   rows, menus) and the bits inside them (titles, figures, buttons, charts) that are on the
   screen; scrolling the scroller (the page by default) ends it; bits adds a page's own kinds
   of words to type. A part that waits for its figures before it is built carries .rzb-wait
   (unseen) until then. rzgsBuild.active() is false with "reduce motion".
   Used by the control app (app.html), Manage account (motion.js) and the admin page.
   rzgsBuild.blocksIn(root, selector) lists the blocks of a part of the page, outermost only.
   A block's frame shows its name: data-build-name, its label or title, or what it is.
   roots: the parts being built; their own "come in" animation is left out meanwhile.
   With "reduce motion" nothing happens.
   ========================================================================== */
(() => {
  'use strict';

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const COLOURS = ['#19d3ff', '#a6ff1a', '#37efb8', '#f3fbff'];
  // in milliseconds: the flight to a block, the making of it, the pause between two typed bits
  const T = { start: 40, travel: 150, make: 280, fade: 160, bitGap: 28 };
  const EASE = {
    fly: 'cubic-bezier(0.65, 0, 0.35, 1)',
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    spring: 'cubic-bezier(0.3, 1.35, 0.5, 1)',
  };
  const BITS = 'h1, h2, h3, .cap, .num, b, .hint, .eq-big, .eq-day, label, output, .chipx, .pill, .btn, button, svg, input, .bar, .led, .icon-btn, .ladder, table';
  const POP = 'button, .btn, .chipx, .pill, .led, .icon-btn';
  const WIPE = 'svg, .bar, .ladder, table';
  const MAX_BITS = 12; // a block with more bits shows the rest at once with it

  let style = null;
  function addStyle() {
    if (style) return;
    style = document.createElement('style');
    style.textContent = `
.rzb-layer{position:fixed;inset:0;z-index:60;pointer-events:none;overflow:hidden}
.rzb-box{position:absolute;border:1px solid var(--c)}
.rzb-box>i{position:absolute;width:7px;height:7px;background:#030c13;border:1px solid var(--c)}
.rzb-box>i:nth-of-type(1){left:-4px;top:-4px}.rzb-box>i:nth-of-type(2){right:-4px;top:-4px}
.rzb-box>i:nth-of-type(3){left:-4px;bottom:-4px}.rzb-box>i:nth-of-type(4){right:-4px;bottom:-4px}
.rzb-name,.rzb-size{position:absolute;white-space:nowrap;font:600 10px/1.5 'IBM Plex Mono',Consolas,monospace;letter-spacing:.04em}
.rzb-name{left:-1px;bottom:100%;margin-bottom:4px;padding:0 6px;background:var(--c);color:#02131a}
.rzb-size{right:-1px;top:100%;margin-top:4px;padding:0 5px;background:#030c13;color:var(--c);border:1px solid var(--c);font-weight:500}
.rzb-box.rzb-top .rzb-name{bottom:auto;top:3px;left:3px;margin:0}
.rzb-box.rzb-low .rzb-size{top:auto;bottom:3px;right:3px;margin:0}
.rzb-cursor{position:absolute;left:0;top:0;will-change:transform}
.rzb-cursor svg{display:block;width:17px;height:20px}
.rzb-tag{position:absolute;left:13px;top:17px;padding:1px 7px;background:var(--c);color:#02131a;font:600 10px/1.5 'IBM Plex Mono',Consolas,monospace;letter-spacing:.04em;white-space:nowrap}
.rzb-caret{position:absolute;left:0;top:0;width:2px;background:#a6ff1a}
.rzb-root{animation:none!important}
.rzb-wait{opacity:0!important}`;
    document.head.append(style);
  }
  addStyle(); // .rzb-wait works before the first build

  const make = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  };
  const shown = (el) => el.isConnected && el.getClientRects().length > 0;
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

  // the outermost elements matching the selector inside root (a block inside a block is a bit of it)
  function blocksIn(root, selector) {
    if (!root) return [];
    return [...root.querySelectorAll(selector)].filter((el) => {
      const outer = el.parentElement && el.parentElement.closest(selector);
      return shown(el) && !(outer && root.contains(outer));
    });
  }

  // what a block is called on its frame: the page's own name for it (data-build-name) or its label; a title or link
  // block its words; else its heading (its first part: "Plan", not "PlanDetails"), its label, or what it is
  function nameOf(el) {
    const words = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const title = el.querySelector('h1, h2, h3');
    const label = el.querySelector('.cap, [class*="-label"], legend, label');
    const buttons = el.querySelectorAll('button, .btn');
    const text = el.dataset.buildName || el.getAttribute('aria-label')
      || (el.matches('h1, h2, h3, a, p') && words(el))
      || (title && words(title.querySelector('span') || title))
      || (label && words(label).replace(/\s*\*$/, ''))
      || (buttons.length === 1 && words(buttons[0])) || '';
    if (text) return text.length > 22 ? `${text.slice(0, 21)}…` : text;
    if (el.matches('nav')) return 'Menu';
    if (el.matches('[role="tablist"], .seg')) return 'Tabs';
    if (el.matches('header')) return 'Header';
    if (el.querySelector('button, .btn')) return 'Buttons';
    return 'Frame';
  }

  let current = null;
  function finish() {
    if (!current) return;
    const { runs, timers, layer, roots, stop } = current;
    current = null;
    timers.forEach(clearTimeout);
    runs.forEach((run) => { try { run.finish(); } catch (e) { /* already gone */ } });
    layer.remove();
    roots.forEach((root) => root.classList.remove('rzb-root'));
    stop();
  }

  const active = () => !calm.matches && Boolean(document.body && document.body.animate);
  function play({ blocks = [], roots = [], scroller = null, bits: moreBits = '' } = {}) {
    finish();
    if (!active()) return;
    const bitsOf = moreBits ? `${BITS}, ${moreBits}` : BITS;
    const vw = innerWidth, vh = innerHeight;
    const list = blocks.filter((el) => el && shown(el)).map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.bottom > 0 && r.top < vh && r.width > 8 && r.height > 8)
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    if (!list.length) return;
    addStyle();
    const layer = make('div', 'rzb-layer', document.body);
    layer.setAttribute('aria-hidden', 'true');
    const runs = [], timers = [];
    roots.forEach((root) => root && root.classList.add('rzb-root'));
    const animate = (el, frames, options) => {
      const run = el.animate(frames, { fill: 'backwards', ...options });
      runs.push(run);
      return run;
    };
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    // the cursors: three (four on a busy page), each with its colour and a tag that says what it does
    const count = Math.min(list.length > 9 ? 4 : 3, list.length);
    const cursors = Array.from({ length: count }, (_, k) => {
      const node = make('div', 'rzb-cursor', layer);
      node.style.setProperty('--c', COLOURS[k]);
      node.innerHTML = `<svg viewBox="0 0 17 20"><path d="M1.5 1.5v15.2l4.2-4 2.9 6.6 2.6-1.1-2.9-6.5h5.8z" fill="#f3fbff" stroke="#02131a" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
      const tag = make('span', 'rzb-tag', node);
      tag.textContent = 'Build';
      return { node, tag, colour: COLOURS[k], path: [], k };
    });
    const say = (cursor, at, word) => later(at, () => { cursor.tag.textContent = word; });

    // the blocks, in reading order, shared out over the cursors
    let end = 0, bigIndex = 0, caretsLeft = 16;
    list.forEach((block, i) => {
      const cursor = cursors[i % count];
      const { el, r } = block;
      // where this cursor is and when it is free
      if (!cursor.path.length) {
        const from = { t: T.start * cursor.k, x: clamp(r.left + r.width * (0.3 + 0.2 * cursor.k), 12, vw - 60), y: clamp(r.top + r.height + 30, 12, vh - 40) };
        cursor.path.push({ t: 0, x: from.x, y: from.y }, from);
      }
      const last = cursor.path[cursor.path.length - 1];
      let t = last.t;
      // a low block (a header, a row of tabs or buttons, a menu) is dragged in; a panel is drawn or scaled
      // a block with a lit box inside is never scaled: the box measures its item while the block is built
      const pick = ['draw', 'move', 'scale'][bigIndex++ % 3];
      const kind = r.height < 70 ? 'move' : pick === 'scale' && el.querySelector('.rz-pill, .has-pill') ? 'draw' : pick;
      const side = i % 2 ? 1 : -1;
      const dx = side * Math.min(48, r.width * 0.12);
      const start = kind === 'draw' ? { x: r.left, y: r.top }
        : kind === 'move' ? { x: r.left + Math.min(36, r.width / 2) - dx, y: r.top + Math.min(18, r.height / 2) }
        : { x: r.left + r.width * 0.59, y: r.top + r.height * 0.59 };
      const goal = kind === 'draw' ? { x: r.right - 4, y: r.bottom - 4 }
        : kind === 'move' ? { x: start.x + dx, y: start.y }
        : { x: r.right - 4, y: r.bottom - 4 };
      cursor.path.push({ t: t + T.travel, x: start.x, y: start.y });
      t += T.travel;
      cursor.path.push({ t: t + T.make * 0.8, x: goal.x, y: goal.y });
      say(cursor, t, kind === 'draw' ? 'Draw' : kind === 'move' ? 'Move' : 'Scale');

      // its frame: an outline with corner handles, its name above, its size below
      const box = make('div', 'rzb-box', layer);
      box.style.cssText = `--c:${cursor.colour};left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      if (r.top < 24) box.classList.add('rzb-top');
      if (r.bottom > vh - 24) box.classList.add('rzb-low');
      for (let h = 0; h < 4; h += 1) make('i', '', box);
      make('span', 'rzb-name', box).textContent = nameOf(el);
      make('span', 'rzb-size', box).textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      const made = { duration: T.make * 0.8, delay: t };
      if (kind === 'draw') {
        animate(box, [{ clipPath: 'inset(0 100% 100% 0)' }, { clipPath: 'inset(-30px -60px -30px -30px)' }], { ...made, easing: EASE.out });
        animate(el, [{ opacity: 0, clipPath: 'inset(0 100% 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { ...made, delay: t + 40, easing: EASE.out });
      } else if (kind === 'move') {
        animate(box, [{ transform: `translateX(${-dx}px)`, opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'none', opacity: 1 }], { ...made, easing: EASE.out });
        animate(el, [{ transform: `translateX(${-dx}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { ...made, easing: EASE.out });
      } else {
        animate(box, [{ transform: 'scale(0.8)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'none', opacity: 1 }], { ...made, easing: EASE.spring });
        animate(el, [{ transform: 'scale(0.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ...made, easing: EASE.spring });
      }
      // the frame stays a moment, then goes
      animate(box, [{ opacity: 1 }, { opacity: 0 }], { duration: T.fade, delay: t + T.make + 90, fill: 'forwards' });

      // the bits inside: typed, popped up or wiped in, one after another, while the cursor flies on
      const bits = [...el.querySelectorAll(bitsOf)].filter((bit) => shown(bit) && !bit.parentElement.closest(bitsOf)
        && (() => { const q = bit.getBoundingClientRect(); return q.width > 0 && q.bottom > 0 && q.top < vh; })()).slice(0, MAX_BITS);
      let at = t + T.make * 0.45;
      if (bits.length) say(cursor, at, 'Type');
      bits.forEach((bit) => {
        const q = bit.getBoundingClientRect();
        if (bit.matches(POP)) {
          // a tab under a lit box keeps its size (the box measures it): it only fades in
          const frames = bit.closest('.has-pill') ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }];
          animate(bit, frames, { duration: 260, delay: at, easing: EASE.spring });
        } else if (bit.matches(WIPE)) {
          animate(bit, [{ clipPath: 'inset(0 100% 0 0)', opacity: 0.3 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], { duration: 300, delay: at, easing: 'linear' });
        } else if (bit.matches('input')) {
          animate(bit, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: at, easing: EASE.out });
        } else {
          const letters = clamp((bit.textContent || '').trim().length, 1, 28);
          const duration = clamp(letters * 12, 80, 260);
          animate(bit, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration, delay: at, easing: `steps(${letters}, end)` });
          // a caret runs along the words being typed
          if (letters > 1 && caretsLeft > 0 && q.height < 80) {
            caretsLeft -= 1;
            const caret = make('i', 'rzb-caret', layer);
            caret.style.cssText = `height:${Math.round(q.height)}px;transform:translate(${q.left}px,${q.top}px);opacity:0`;
            animate(caret, [
              { transform: `translate(${q.left}px,${q.top}px)`, opacity: 1 },
              { transform: `translate(${q.right}px,${q.top}px)`, opacity: 1 },
            ], { duration, delay: at, easing: `steps(${letters}, end)`, fill: 'none' });
          }
          end = Math.max(end, at + duration);
        }
        at += T.bitGap;
      });
      end = Math.max(end, at + 260, t + T.make + 90 + T.fade);
      cursor.path.push({ t: t + T.make, x: goal.x + 6, y: goal.y + 4 });
    });

    // each cursor follows its path, then fades where it stopped
    cursors.forEach((cursor) => {
      const total = cursor.path[cursor.path.length - 1].t + 160;
      const frames = cursor.path.map((p) => ({ offset: clamp(p.t / total, 0, 1), transform: `translate(${p.x}px,${p.y}px)`, easing: EASE.fly }));
      frames.push({ offset: 1, transform: frames[frames.length - 1].transform });
      animate(cursor.node, frames, { duration: total, fill: 'both' });
      animate(cursor.node, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: total, fill: 'both' });
      end = Math.max(end, total);
    });

    // a tap, a key, the wheel or a scroll: done at once
    const now = () => finish();
    const opts = { capture: true, passive: true };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((type) => addEventListener(type, now, opts));
    const scrollers = [scroller || window];
    scrollers.forEach((root) => root.addEventListener('scroll', now, opts));
    document.addEventListener('visibilitychange', now);
    const stop = () => {
      events.forEach((type) => removeEventListener(type, now, opts));
      scrollers.forEach((root) => root.removeEventListener('scroll', now, opts));
      document.removeEventListener('visibilitychange', now);
    };
    current = { runs, timers, layer, roots: roots.filter(Boolean), stop };
    window.rzgsBuild.last = { at: performance.now(), takes: Math.round(end + 80), blocks: list.length };
    const mine = current;
    later(end + 80, () => { if (current === mine) finish(); });
  }

  window.rzgsBuild = { play, finish, blocksIn, active };
})();
