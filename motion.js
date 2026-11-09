/* ==========================================================================
   RZGS-PRO motion: the moves that need a script. The styles are in motion.css.
   Other scripts use window.rzgsMotion: shake, reveal, conceal and fromTap.
   ========================================================================== */
(() => {
  'use strict';

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SOFT_STOP = 'cubic-bezier(0.16, 1, 0.3, 1)';

  /* ---------------------------------------------------------------- where the last tap was */
  const tap = { x: null, y: null };

  document.addEventListener('click', (event) => {
    const target = event.target.closest && event.target.closest('a, button, summary, [role="tab"]');
    // a click made with the keyboard has no place: the middle of the button then
    if (event.detail === 0 && target) {
      const box = target.getBoundingClientRect();
      tap.x = box.left + box.width / 2;
      tap.y = box.top + box.height / 2;
    } else {
      tap.x = event.clientX;
      tap.y = event.clientY;
    }
    if (target) burst(target);
  }, true);

  // Call this just before showModal(): the box grows out of the place that was tapped.
  // Opened with no tap (a link from an email, say), it grows from the middle of the screen.
  function fromTap(dialog) {
    if (tap.x === null) return;
    dialog.style.setProperty('--from-x', `${tap.x}px`);
    dialog.style.setProperty('--from-y', `${tap.y}px`);
    // how far the furthest corner of the screen is: a circle this big covers everything, and no bigger, so its growth can be seen
    const across = Math.max(tap.x, window.innerWidth - tap.x);
    const down = Math.max(tap.y, window.innerHeight - tap.y);
    dialog.style.setProperty('--from-r', `${Math.ceil(Math.hypot(across, down))}px`);
  }

  /* ---------------------------------------------------------------- pop and burst */
  // On the main buttons that lead somewhere. A form's own button waits for the answer: that can be a "no".
  function burst(button) {
    if (calm.matches || button.disabled) return;
    const isMain = button.matches('a.btn-primary, .trial-bar-go, .plan-btn') || (button.matches('button.btn-primary') && button.type !== 'submit');
    if (!isMain) return;
    const mark = document.createElement('span');
    mark.className = 'tap-burst';
    mark.setAttribute('aria-hidden', 'true');
    mark.style.left = `${tap.x}px`;
    mark.style.top = `${tap.y}px`;
    let sparks = '<b></b>';
    for (let i = 0; i < 8; i += 1) {
      const angle = i * 45 + (Math.random() * 18 - 9);
      const reach = 38 + Math.random() * 26;
      // white on top of the button's own cyan and lime, which would hide them
      sparks += `<i style="--angle:${angle.toFixed(0)}deg;--reach:${reach.toFixed(0)}px;--spark:${i % 2 ? '#d8ff8a' : '#ffffff'}"></i>`;
    }
    mark.innerHTML = sparks;
    (button.closest('dialog') || document.body).append(mark); // an open box lies above the rest of the page
    setTimeout(() => mark.remove(), 650);
  }

  /* ---------------------------------------------------------------- the shake that says no */
  function shake(element) {
    if (!element || !element.animate) return;
    if (calm.matches) {
      element.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
      return;
    }
    element.animate(
      [0, -9, 8, -6, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 420, easing: 'ease-out' },
    );
  }

  /* ---------------------------------------------------------------- nothing jumps */
  // The element's own size, and the same with no size: what is under it moves along smoothly.
  function folded(element) {
    const own = getComputedStyle(element);
    const gap = parseFloat(getComputedStyle(element.parentElement).rowGap) || 0;
    return [
      { height: '0px', marginTop: `${-gap}px`, marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, overflow: 'hidden' },
      { height: `${element.offsetHeight}px`, marginTop: own.marginTop, marginBottom: own.marginBottom, paddingTop: own.paddingTop, paddingBottom: own.paddingBottom, opacity: 1, overflow: 'hidden' },
    ];
  }

  const leaving = new Map(); // element -> the animation that is taking it away

  // Instead of element.hidden = false
  function reveal(element) {
    if (leaving.has(element)) {
      leaving.get(element).cancel();
      leaving.delete(element);
    }
    const wasHidden = element.hidden;
    element.hidden = false;
    if (!wasHidden || calm.matches || !element.animate) return;
    element.animate(folded(element), { duration: 260, easing: SOFT_STOP });
  }

  // Instead of element.hidden = true. "done" runs once it is gone.
  function conceal(element, done) {
    const finish = () => {
      leaving.delete(element);
      element.hidden = true;
      if (done) done();
    };
    if (leaving.has(element)) return; // already on its way
    if (element.hidden || calm.matches || !element.animate) {
      finish();
      return;
    }
    const going = element.animate(folded(element).reverse(), { duration: 170, easing: 'ease-in' });
    going.onfinish = finish;
    leaving.set(element, going);
  }

  // The questions open smoothly by CSS where the browser can do that (style.css); elsewhere here.
  if (!window.CSS || !CSS.supports('interpolate-size', 'allow-keywords')) {
    const contentOf = (details) => details.querySelector(':scope > :not(summary)');
    const closeSmoothly = (details) => {
      const content = contentOf(details);
      if (calm.matches || !content.animate) {
        details.open = false;
        return;
      }
      content.animate(
        [{ height: `${content.offsetHeight}px`, opacity: 1, overflow: 'hidden' }, { height: '0px', opacity: 0, overflow: 'hidden' }],
        { duration: 180, easing: 'ease-in' },
      ).onfinish = () => { details.open = false; };
    };
    const openSmoothly = (details) => {
      details.open = true;
      const content = contentOf(details);
      if (calm.matches || !content.animate) return;
      content.animate(
        [{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: `${content.offsetHeight}px`, opacity: 1, overflow: 'hidden' }],
        { duration: 300, easing: SOFT_STOP },
      );
    };
    // "name" makes the browser close the other questions at once, so the group is kept here instead
    document.querySelectorAll('details.faq-item[name]').forEach((details) => details.removeAttribute('name'));
    document.addEventListener('click', (event) => {
      const summary = event.target.closest('details.faq-item > summary, details.toc > summary');
      if (!summary) return;
      event.preventDefault();
      const details = summary.parentElement;
      if (details.open) {
        closeSmoothly(details);
        return;
      }
      if (details.matches('.faq-item')) {
        document.querySelectorAll('details.faq-item[open]').forEach(closeSmoothly);
      }
      openSmoothly(details);
    });
  }

  /* ---------------------------------------------------------------- one line under the top menu */
  // On computers: it stands under this page's link and slides to the link under the pointer.
  // Kept for the pages without the video's motion (everything but the five main pages, 8 Nov 2026).
  function navGlide() {
    const navList = document.querySelector('.nav-list');
    if (navList) {
      const wide = window.matchMedia('(min-width: 1024px)');
      const links = [...navList.querySelectorAll('.nav-link')];
      const line = document.createElement('li');
      line.className = 'nav-glide';
      line.setAttribute('aria-hidden', 'true');
      navList.append(line);
      navList.classList.add('has-glide');

      const here = () => links.find((link) => link.getAttribute('aria-current') === 'page' || link.classList.contains('is-active'));
      const moveTo = (link) => {
        if (!wide.matches) return;
        line.classList.toggle('is-on', Boolean(link));
        if (!link) return;
        const box = link.getBoundingClientRect();
        const list = navList.getBoundingClientRect();
        line.style.setProperty('--x', `${box.left - list.left}px`);
        line.style.setProperty('--y', `${box.bottom - list.top - 10}px`);
        line.style.setProperty('--w', String(box.width));
      };
      // set in place with no slide: on arriving at the page, when the fonts come, when the window changes
      const settle = () => {
        line.classList.add('is-still');
        moveTo(here());
        requestAnimationFrame(() => requestAnimationFrame(() => line.classList.remove('is-still')));
      };
      links.forEach((link) => {
        link.addEventListener('pointerenter', () => moveTo(link));
        link.addEventListener('focus', () => moveTo(link));
      });
      navList.addEventListener('pointerleave', () => moveTo(here()));
      navList.addEventListener('focusout', (event) => {
        if (!navList.contains(event.relatedTarget)) moveTo(here());
      });
      window.addEventListener('resize', settle);
      settle();
      if (document.fonts) document.fonts.ready.then(settle);
      // the menu's font can arrive after fonts.ready and make the links wider: the line follows their size, every time
      if (window.ResizeObserver) {
        const watch = new ResizeObserver(settle);
        links.forEach((link) => watch.observe(link));
      }
    }
  }

  /* ================================================================ the moves of the owner's video (8 Nov 2026)
     A dashboard reel the owner sent: a lit box that stretches from tab to tab, a page that blurs away, a title that
     comes in letter by letter out of a blur, panels that follow one after another, numbers that count and bars that
     grow. Only on the pages whose <body> has data-motion="video" (the owner, 8 Nov 2026: Home, The Bot, Tutorial,
     License, Contact for now; the other pages get their own moves later). The app (app.html) is left as it is. */
  const videoPage = document.body.dataset.motion === 'video';
  const SOFT = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const power3 = {
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  };
  const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  // a business screen (account, admin) moves quicker: nobody should wait for it
  const quick = document.body.matches('[data-auth-page="dashboard"], .adm-page') || Boolean(document.querySelector('.acc'));

  /* ---------------------------------------------------------------- the lit box that stretches */
  // One box behind the chosen item of every menu and row of tabs. When the choice moves, the edge in front leads
  // (0.36 s, power3.out) and the edge behind follows (0.55 s, power3.inOut): the box stretches toward the new item,
  // then catches up. "frame" boxes are an outline drawn over items that have their own background.
  const PILLS = [
    { key: 'nav', box: '.nav-list', items: '.nav-link', on: '[aria-current="page"], [aria-current="location"], .is-active', media: '(min-width: 1024px)', carry: true },
    { key: 'auth', box: '.auth-switch', items: 'a', on: '[aria-current="page"]', carry: true },
    { key: 'acc', box: '.acc-side', items: '.acc-nav > a, .acc-nav > button', on: '[aria-current="page"], [aria-selected="true"]', carry: true },
    { key: 'chips', box: '.acc-chips', items: 'button[role="tab"]', on: '[aria-selected="true"]', frame: true },
    { key: 'toc', box: '.toc ol', items: 'a', on: '.is-active, [aria-current]' },
    { key: 'path', box: '.path3d-bar', items: 'button[data-view]', on: '[aria-pressed="true"]', frame: true },
    { key: 'adm', box: '.adm-nav', items: 'a', on: '[aria-current="page"]' },
    { key: 'seg', box: '.adm-seg', items: 'button', on: '[aria-pressed="true"]' },
    { key: 'filter', box: '.adm-chips', items: 'button', on: '[aria-pressed="true"]', frame: true },
  ];
  const EDGES = ['l', 't', 'r', 'b'];
  const pills = [];

  // where an item is inside its box, as the four insets of an absolutely placed box (scrolled content included)
  function edgesOf(box, item) {
    const b = box.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const l = r.left - b.left - box.clientLeft + box.scrollLeft;
    const t = r.top - b.top - box.clientTop + box.scrollTop;
    return { l, t, r: box.clientWidth - l - r.width, b: box.clientHeight - t - r.height };
  }
  function paint(p) {
    EDGES.forEach((k) => p.el.style.setProperty(`--${k}`, `${p.cur[k].toFixed(2)}px`));
  }
  function slide(p, to) {
    cancelAnimationFrame(p.raf);
    p.raf = 0;
    p.to = to;
    const from = { ...p.cur };
    const dx = to.l - from.l;
    const dy = to.t - from.t;
    const time = {};
    EDGES.forEach((k) => {
      const behind = (k === 'l' && dx > 0.5) || (k === 'r' && dx < -0.5) || (k === 't' && dy > 0.5) || (k === 'b' && dy < -0.5);
      time[k] = behind ? [550, power3.inOut] : [360, power3.out];
    });
    const start = performance.now();
    const step = (now) => {
      let moving = false;
      EDGES.forEach((k) => {
        const t = Math.max(0, Math.min(1, (now - start) / time[k][0]));
        if (t < 1) moving = true;
        p.cur[k] = from[k] + (to[k] - from[k]) * time[k][1](t);
      });
      paint(p);
      p.raf = moving ? requestAnimationFrame(step) : 0;
    };
    p.raf = requestAnimationFrame(step);
  }
  function chosen(p) {
    return [...p.box.querySelectorAll(p.items)].find((item) => item.matches(p.on) && item.getClientRects().length);
  }
  // instant: no slide (arriving, a new size, fonts); otherwise the stretch. target: an item that is about to be chosen.
  function place(p, instant, target) {
    if (p.waiting || (p.media && !window.matchMedia(p.media).matches)) return; // waiting: a carried box is on its way

    const item = target || chosen(p);
    if (!item || !p.box.getClientRects().length) {
      p.el.classList.remove('is-on');
      p.shown = false;
      return;
    }
    const to = edgesOf(p.box, item);
    const near = (a, b) => a && EDGES.every((k) => Math.abs(a[k] - b[k]) < 0.5);
    if (instant || !p.shown || calm.matches) {
      if (p.raf && !instant) return;
      cancelAnimationFrame(p.raf);
      p.raf = 0;
      p.cur = to;
      p.to = to;
      paint(p);
    } else if (!(p.raf && near(p.to, to)) && !near(p.cur, to)) {
      slide(p, to);
    }
    p.shown = true;
    if (!p.el.classList.contains('is-on')) p.el.classList.add('is-on');
  }
  function setUpPill(spec, box) {
    if (box.rzPill) return;
    const el = document.createElement(box.matches('ul, ol') ? 'li' : 'span');
    el.className = `rz-pill${spec.frame ? ' rz-pill--frame' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    box.prepend(el);
    box.classList.add('has-pill', `has-pill--${spec.key}`);
    if (getComputedStyle(box).position === 'static') box.classList.add('rz-pill-box');
    const p = { ...spec, box, el, cur: { l: 0, t: 0, r: 0, b: 0 }, shown: false, raf: 0 };
    box.rzPill = p;
    pills.push(p);
    let queued = 0;
    const soon = (instant) => {
      cancelAnimationFrame(queued);
      // decided when it runs: a stretch that began in the meantime (a page's carried box) is not cut short
      queued = requestAnimationFrame(() => place(p, instant && !p.raf));
    };
    new MutationObserver((changes) => {
      if (changes.some((change) => change.target !== el)) soon(false);
    }).observe(box, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'aria-pressed', 'class'] });
    // a new size moves the box with no slide; a slide on its way is aimed at the new place instead
    if (window.ResizeObserver) {
      const sized = new ResizeObserver(() => {
        if (p.raf) {
          const item = chosen(p);
          if (item) place(p, false, item);
        } else soon(true);
      });
      sized.observe(box);
      box.querySelectorAll(spec.items).forEach((item) => sized.observe(item));
    }
    if (spec.media) window.matchMedia(spec.media).addEventListener('change', () => soon(true));
    place(p, true);
  }
  function setUpPills(root = document) {
    PILLS.forEach((spec) => {
      if (root !== document && root.matches && root.matches(spec.box)) setUpPill(spec, root);
      root.querySelectorAll(spec.box).forEach((box) => setUpPill(spec, box));
    });
  }

  // From page to page (the top menu, the log in / sign up switch, the account menu): the box of the page that is
  // left is kept for a moment, and the next page stretches it from there to its own item.
  // The item is found again on the new page by its words (both pages have the same menu), and measured there once
  // its fonts are in, so the stretch starts exactly on it.
  const CARRY = 'rz_pill';
  const wordsOf = (item) => item.textContent.replace(/\s+/g, ' ').trim();
  function carryFrom(p, link) {
    const from = p.shown ? chosen(p) : null;
    try {
      sessionStorage.setItem(CARRY, JSON.stringify({ key: p.key, words: from ? wordsOf(from) : '', at: Date.now() }));
    } catch (e) { /* not kept: the next page simply shows its box */ }
  }
  function arrivePills() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(CARRY) || 'null');
      sessionStorage.removeItem(CARRY);
    } catch (e) { /* none */ }
    if (!saved || !saved.words || Date.now() - saved.at > 15000 || calm.matches) return;
    const p = pills.find((one) => one.key === saved.key && one.carry);
    if (!p || (p.media && !window.matchMedia(p.media).matches)) return;
    if (!p.box.getClientRects().length && window.ResizeObserver) {
      // not on the screen yet: wait for it (at most 3 s)
      const shown = new ResizeObserver(() => {
        if (!p.box.getClientRects().length) return;
        shown.disconnect();
        carryInto(p, saved);
      });
      shown.observe(p.box);
      setTimeout(() => shown.disconnect(), 3000);
      return;
    }
    carryInto(p, saved);
  }
  function carryInto(p, saved) {
    const was = [...p.box.querySelectorAll(p.items)].find((item) => wordsOf(item) === saved.words && item.getClientRects().length);
    if (!was || was === chosen(p)) return;
    const go = () => {
      p.waiting = false;
      p.cur = edgesOf(p.box, was);
      paint(p);
      p.shown = true;
      p.el.classList.add('is-on');
      const item = chosen(p);
      if (item) slide(p, edgesOf(p.box, item));
      else {
        // nothing is chosen on this page: the box fades where it was
        p.el.classList.add('is-leaving');
        setTimeout(() => { p.el.classList.remove('is-on', 'is-leaving'); p.shown = false; }, 260);
      }
    };
    p.waiting = true; // nothing else places it until the stretch begins
    p.el.classList.remove('is-on'); // unseen for the moment the fonts may take
    if (document.fonts && document.fonts.status !== 'loaded') {
      Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 350))]).then(go);
    } else go();
  }

  /* ---------------------------------------------------------------- the page that blurs away */
  // A link to another page of the site: the content blurs and fades while the next page loads. Nothing waits for it;
  // the browser goes on at once. The menu that was used stays sharp, its box on its way to the new item.
  let leftBehind = [];
  function blocksBesides(root, keep) {
    if (!keep || !root.contains(keep)) return [root];
    const out = [];
    const walk = (el) => {
      [...el.children].forEach((child) => {
        if (child === keep) return;
        if (child.contains(keep)) walk(child);
        else out.push(child);
      });
    };
    walk(root);
    return out;
  }
  function comeBack() {
    leftBehind.forEach((run) => run.cancel());
    leftBehind = [];
  }
  function leave(link) {
    const p = pills.find((one) => one.box.contains(link) && link.matches(one.items));
    if (p && p.carry) carryFrom(p, link);
    if (p) place(p, false, link);
    if (calm.matches) return;
    const main = document.getElementById('main');
    const keep = p ? p.box : null;
    const blocks = [...(main ? blocksBesides(main, keep) : []), ...document.querySelectorAll('.site-footer')];
    leftBehind = blocks.filter((el) => el.getClientRects().length && el.animate).map((el) => el.animate(
      quick
        ? [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 -6px' }]
        : [{ opacity: 1, filter: 'blur(0px)', translate: '0 0' }, { opacity: 0, filter: 'blur(6px)', translate: '0 -6px' }],
      { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    ));
    // a page that never comes (a cancelled download, no connection): the content comes back
    setTimeout(comeBack, 4000);
  }
  // listened to on window, the last stop: a click another script has taken (a pop-up, a tab) is not a page change
  const watchLeaving = () => window.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // the same page: a jump
    leave(link);
  });
  // back to a page the browser kept: it is shown as it was
  const watchReturning = () => window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      comeBack();
      pills.forEach((p) => place(p, true));
    }
  });

  /* ---------------------------------------------------------------- letters out of a blur */
  // The title is cut into letters, each comes out of a blur a little after the one before; then the title is put
  // back exactly as it was. A letter of a gradient word carries its own piece of the gradient while it comes.
  // the colours of a CSS gradient as computed ("linear-gradient(90deg, rgb(25, 211, 255) 0%, ...)") and the one at x (0-1)
  function stopsOf(image) {
    const found = [...String(image).matchAll(/rgba?\(([^)]+)\)\s*([\d.]+%)?/g)];
    const stops = found.map((m, i) => ({
      rgb: m[1].split(',').slice(0, 3).map(Number),
      at: m[2] ? parseFloat(m[2]) / 100 : found.length > 1 ? i / (found.length - 1) : 0,
    }));
    return stops.length ? stops : [{ rgb: [25, 211, 255], at: 0 }];
  }
  function colourAt(stops, x) {
    const t = Math.max(0, Math.min(1, x));
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      if (t >= stops[i].at && t <= stops[i + 1].at) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
    return `rgb(${a.rgb.map((v, k) => Math.round(v + (b.rgb[k] - v) * f)).join(', ')})`;
  }
  const graphemes = (text) => (window.Intl && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
    : Array.from(text));
  function letters(el, { gap = 26, duration = 460, delay = 0 } = {}) {
    if (!el || calm.matches || !el.animate || el.rzLetters) return 0;
    const before = el.innerHTML;
    const text = el.textContent;
    const cut = [];
    const walk = (node, grad) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          if (!child.nodeValue.trim()) return;
          const bits = document.createDocumentFragment();
          graphemes(child.nodeValue).forEach((ch) => {
            if (/^\s+$/.test(ch)) { bits.append(ch); return; }
            const span = document.createElement('span');
            span.className = 'rz-ch';
            span.textContent = ch;
            if (grad) span.rzGrad = grad;
            bits.append(span);
            cut.push(span);
          });
          child.replaceWith(bits);
        } else if (child.nodeType === 1 && !child.matches('svg, img, br, input, button')) {
          walk(child, grad || (getComputedStyle(child).backgroundClip === 'text' ? child : null));
        }
      });
    };
    walk(el, null);
    if (!cut.length) return 0;
    el.rzLetters = true;
    // A gradient word: a browser can't blur a letter that is filled with a gradient (it vanishes), so while it comes
    // each letter wears the one colour of the gradient at its own place; the real gradient is back when the title is.
    cut.forEach((span) => {
      if (!span.rzGrad) return;
      const g = span.rzGrad;
      if (!g.rzStops) g.rzStops = stopsOf(getComputedStyle(g).backgroundImage);
      const box = g.getBoundingClientRect();
      const at = span.getBoundingClientRect();
      const colour = colourAt(g.rzStops, box.width ? (at.left + at.width / 2 - box.left) / box.width : 0);
      g.classList.add('rz-grad-cut');
      span.style.color = colour;
      span.style.webkitTextFillColor = colour;
    });
    const step = Math.min(gap, 520 / cut.length);
    cut.forEach((span, i) => span.animate(
      [{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)' }],
      { duration, delay: delay + i * step, easing: SOFT, fill: 'backwards' },
    ));
    const total = delay + (cut.length - 1) * step + duration;
    // put back as it was, unless another script has written something else in the meantime
    setTimeout(() => {
      if (el.textContent === text && el.querySelector('.rz-ch')) el.innerHTML = before;
      el.rzLetters = false;
    }, total + 60);
    return total;
  }

  /* ---------------------------------------------------------------- one after another */
  const PANELS = [
    '.dash-panel', '.dash-profile', '.dash-core', '.adm-tile', '.acc-stat', '.acc-chips', '.card:not(.auth-card)', '.adm-view-head',
    '.adm-lead', '.adm-tools', '.adm-statement > *', '.acc-toolbar', '.dash-hint', '.adm-group',
    '.acc-back', '.acc-help-card', '.acc-signout', '.acc-id', '.acc-state',
  ].join(', ');
  // On the business screens (account, admin) a panel fades and slides with no blur: a blur over a big panel costs a
  // lot while the page is busy drawing its figures, and made the profile page stutter (the owner, 8 Nov 2026).
  const rise = (el, delay, duration) => el.animate(
    quick
      ? [{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }]
      : [{ opacity: 0, filter: 'blur(6px)', translate: '0 10px' }, { opacity: 1, filter: 'blur(0px)', translate: '0 0' }],
    { duration, delay, easing: SOFT, fill: 'backwards' },
  );
  // A panel below the screen waits unseen and comes in when it is scrolled to.
  const sight = window.IntersectionObserver ? new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    sight.unobserve(entry.target);
    entry.target.classList.remove('rz-wait');
    rise(entry.target, 0, quick ? 380 : 520);
  }), { rootMargin: '0px 0px -40px 0px' }) : null;
  function waitForSight(el) {
    if (!sight || el.classList.contains('rz-wait')) return;
    el.classList.add('rz-wait');
    sight.observe(el);
  }

  // The panels of a view that are on the screen come one after another; the ones below come when scrolled to. For a
  // short while after, what a script still adds (figures from the server) comes in the same way.
  // title: false leaves the view's title alone; again: a view opened once more comes in once more.
  function enter(root, { watch = 1200, title = true, again = false } = {}) {
    if (!root || calm.matches || !root.animate || !root.getClientRects().length) return;
    if (root.rzEnteredAt && performance.now() - root.rzEnteredAt < 400) return;
    root.rzEnteredAt = performance.now();
    const gap = quick ? 45 : 70;
    const duration = quick ? 360 : 520;
    const head = title && root.querySelector('.adm-view-head h2, .acc-h1, .dash-title');
    if (head) letters(head, { gap: 18, duration: 320 });
    let n = 0;
    const take = (el) => {
      if ((el.rzRisen && !again) || el.classList.contains('rz-wait') || el.closest('.rz-ch') || !el.getClientRects().length) return;
      el.rzRisen = true;
      if (el.getBoundingClientRect().top > window.innerHeight) {
        waitForSight(el);
        return;
      }
      rise(el, Math.min(n, 7) * gap, duration);
      n += 1;
    };
    const panelsIn = (node) => {
      if (node.nodeType !== 1) return;
      const found = node.matches(PANELS) ? [node] : [...node.querySelectorAll(PANELS)];
      found.filter((el) => !found.some((other) => other !== el && other.contains(el))).forEach(take);
    };
    panelsIn(root);
    countIn(root);
    growIn(root);
    if (!watch || !window.MutationObserver) return;
    const seen = new MutationObserver((changes) => changes.forEach((change) => change.addedNodes.forEach((node) => {
      if (node.nodeType !== 1) return;
      panelsIn(node);
      countIn(node);
      growIn(node);
    })));
    seen.observe(root, { childList: true, subtree: true });
    setTimeout(() => seen.disconnect(), watch);
  }

  /* ---------------------------------------------------------------- numbers that count */
  // "$1,245.78", "-$3.20", "12", "50.0%", "$5 / month": the first number counts from where it was (0 the first
  // time) to its value, with the same decimals and commas; the words around it stay. Two numbers ("20 / 31") stay still.
  const NUMBER = /^([^\d-]*?)(-?)([^\d-]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s;
  function readNumber(text) {
    const m = NUMBER.exec(String(text).trim());
    if (!m || /\d/.test(m[5]) || /\d/.test(m[1] + m[3])) return null;
    const digits = m[4];
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
    return { head: m[1], sign: m[2], mid: m[3], value: Number(digits.replace(/,/g, '')) * (m[2] ? -1 : 1), decimals, commas: digits.includes(','), tail: m[5] };
  }
  const writeNumber = (n, v) => {
    const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: n.decimals, maximumFractionDigits: n.decimals, useGrouping: n.commas });
    return `${n.head}${v < 0 ? '-' : ''}${n.mid}${abs}${n.tail}`;
  };
  // el.rzShown: the last text written here, so a watcher can tell it from a script's new figure
  function count(el, fromValue = 0) {
    if (!el || el.rzCounting) return;
    const final = el.textContent;
    const n = readNumber(final);
    if (!n || calm.matches || n.value === fromValue || el.children.length) return;
    el.rzCounting = true;
    el.rzFinal = final;
    const start = performance.now();
    const duration = quick ? 600 : 800;
    const step = (now) => {
      // a script wrote a new figure: it stays (the same figure written again changes nothing)
      if (el.textContent !== el.rzShown && el.textContent !== final) { el.rzCounting = false; return; }
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      el.rzShown = t < 1 ? writeNumber(n, fromValue + (n.value - fromValue) * power3.out(t)) : final;
      el.textContent = el.rzShown;
      if (t < 1) requestAnimationFrame(step);
      else el.rzCounting = false;
    };
    el.rzShown = writeNumber(n, fromValue);
    el.textContent = el.rzShown;
    requestAnimationFrame(step);
  }
  const COUNTED = '.adm-num, .license-price, [data-plan-amount], .acc-sum-big, .adm-st tr.is-total td:last-child';
  function countIn(node) {
    if (node.nodeType !== 1) return;
    (node.matches(COUNTED) ? [node] : [...node.querySelectorAll(COUNTED)]).forEach((el) => {
      if (el.rzCounted || !el.getClientRects().length) return;
      el.rzCounted = true;
      count(el);
    });
  }
  // figures that a script changes in place (the profile's stats, the P/L Report): from the old value to the new
  const LIVE = '[data-stat], .acc-stat b';
  function watchLive(el) {
    if (el.rzLive || !window.MutationObserver) return;
    el.rzLive = true;
    let was = readNumber(el.textContent);
    new MutationObserver(() => {
      if (el.textContent === el.rzShown) return; // its own counting
      // the figure it counts to, written again: the count goes on, with no flash of the end figure
      if (el.rzCounting && el.textContent === el.rzFinal) { el.textContent = el.rzShown; return; }
      if (el.rzCounting) el.rzCounting = false; // a new figure while counting: count again from here
      const now = readNumber(el.textContent);
      const from = was && now && was.head === now.head && was.tail === now.tail ? was.value : 0;
      was = now;
      if (now) count(el, from);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
  // a number of the page itself (a price) counts when it comes into sight
  function countOnSight() {
    const els = [...document.querySelectorAll('.license-price')];
    if (!els.length || !window.IntersectionObserver) return;
    const seen = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      seen.unobserve(entry.target);
      countIn(entry.target);
    }), { threshold: 0.6 });
    els.forEach((el) => seen.observe(el));
  }

  /* ---------------------------------------------------------------- bars that grow */
  // Bars grow from their zero line, one a little after the other. The P/L Report's bars grow each time they are
  // drawn (when its part is opened or refreshed); the admin page's charts when their view is opened.
  function grow(svg) {
    if (calm.matches || !svg.querySelectorAll) return;
    svg.querySelectorAll('rect:not(.hit), path.bar').forEach((bar, i, all) => {
      if (!bar.animate) return;
      bar.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: quick ? 520 : 640, delay: i * Math.min(22, 420 / all.length), easing: SOFT, fill: 'backwards' });
    });
  }
  function growIn(node) {
    if (node.nodeType !== 1) return;
    const svgs = node.matches('.adm-chart svg') ? [node] : [...node.querySelectorAll('.adm-chart svg')];
    if (node.matches('.adm-chart') && node.querySelector('svg')) svgs.push(node.querySelector('svg'));
    [...new Set(svgs)].forEach(grow);
  }
  function watchBars() {
    document.querySelectorAll('.acc-bars').forEach((svg) => {
      new MutationObserver(() => { if (svg.getClientRects().length) grow(svg); }).observe(svg, { childList: true });
    });
  }

  /* ---------------------------------------------------------------- arriving */
  // The title first, letter by letter; what stands under it in the same block follows one after another.
  function arrive() {
    const title = document.querySelector('.hero-title, #page-title, .adm-head h1');
    let after = 0;
    if (title) {
      const total = letters(title, quick ? { gap: 18, duration: 340 } : {});
      if (total && !calm.matches) {
        const next = [];
        for (let el = title.nextElementSibling; el; el = el.nextElementSibling) {
          if (el.getClientRects().length && el.getBoundingClientRect().top < window.innerHeight) next.push(el);
        }
        const start = Math.min(total * 0.45, 260);
        next.forEach((el, i) => rise(el, start + Math.min(i, 5) * (quick ? 50 : 80), quick ? 380 : 560));
        after = start;
      }
    }
    // an account or admin screen: its view
    const view = document.querySelector('.dash-view:not([hidden]), .acc-part:not([hidden]), .adm-view:not([hidden])');
    if (view) setTimeout(() => enter(view, { watch: 3000 }), after);
    document.documentElement.classList.add('rz-in');
  }
  // The profile and Manage account pages draw their figures once the account is read (they say so with aria-busy).
  // Until then their content waits unseen (motion.css), so the name, the figures and the panels come in together,
  // instead of placeholders moving and the real figures popping in after them.
  // The profile page (8 Nov 2026, the owner: "even if it is not loaded, what is on the screen has its own motion"):
  // its sections come in at once, one after another, as frames with a slow scan line while the account is read
  // (motion.css hides their placeholders, which said "No plan" before the real plan came). When it is in, each
  // section's contents come in, the name letter by letter, the figures count up and the plan ring fills.
  const busy = () => document.querySelector('.acc[aria-busy="true"]');
  const SECTIONS = '.dash-profile, .dash-core, .dash-panel';
  function fillIn() {
    const accMain = document.querySelector('.acc-main');
    if (!accMain) return;
    const sections = [...accMain.querySelectorAll(SECTIONS)].filter((el) => el.getClientRects().length && !el.classList.contains('rz-wait')
      && el.getBoundingClientRect().top < window.innerHeight && !el.parentElement.closest(SECTIONS));
    sections.forEach((section, i) => [...section.children].forEach((child) => {
      if (!child.animate || !child.getClientRects().length) return;
      child.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }],
        { duration: 340, delay: i * 55, easing: SOFT, fill: 'backwards' });
    }));
    const title = accMain.querySelector('.dash-title, .acc-h1');
    if (title) letters(title, { gap: 24, duration: 380 });
    // the figures count from 0, the ring fills from empty
    accMain.querySelectorAll(`${LIVE}, [data-ring-big]`).forEach((el) => {
      if (!el.getClientRects().length) return;
      el.rzCounting = false;
      count(el, 0);
    });
    accMain.querySelectorAll('[data-ring-arc]').forEach((arc) => {
      const to = arc.getAttribute('stroke-dasharray');
      if (!to || to === '0 100') return;
      arc.style.transition = 'none';
      arc.setAttribute('stroke-dasharray', '0 100');
      getComputedStyle(arc).strokeDasharray; // the empty ring is drawn first
      arc.style.transition = `stroke-dasharray 1.1s ${SOFT}`;
      arc.setAttribute('stroke-dasharray', to);
      setTimeout(() => { arc.style.transition = ''; }, 1200);
    });
  }
  // A page marked data-build (Manage account, the profile page, log in and sign up; the owner, 9 Nov 2026) is built by
  // the cursors of build-motion.js once the account is read (at once on log in and sign up), and each part or tab the
  // first time it is opened: in place of the letters, the panels rising and the fill-in. Until the account is read, its
  // sections stand as the scan-line frames.
  const buildPage = document.body.hasAttribute('data-build') && window.rzgsBuild && window.rzgsBuild.active();
  const BUILD_BLOCKS = '.acc-side, .acc-back, .acc-h1, .acc-chips, .acc-help-card, .acc-signout, .acc-id, .acc-part-head, .dash-panel, .dash-profile, .dash-core,'
    + ' .auth-switch, .kicker, .auth-title, .auth-lead, .steps-bar, .field, .check-field, .form-actions, .auth-social, .trial-banner, .auth-note, .auth-alt, .trial-panel';
  const PARTS = '.acc-part, .dash-view';
  const BUILD_BITS = 'p, a, dt, dd, .dash-hint, .acc-sum-big, .acc-id-name, .acc-chip-ico';
  const builtParts = new Set();
  function buildPart(root) {
    root.querySelectorAll(PARTS).forEach((part) => { if (!part.hidden) builtParts.add(part.id); });
    if (root.matches(PARTS)) builtParts.add(root.id);
    document.documentElement.classList.add('rz-in');
    window.rzgsBuild.play({ blocks: window.rzgsBuild.blocksIn(root, BUILD_BLOCKS), bits: BUILD_BITS });
  }
  function arriveWhenReady() {
    const waiting = busy();
    if (buildPage) {
      const page = document.querySelector('.acc') || document.querySelector('.auth-section') || document.querySelector('main') || document.body;
      if (!waiting || !window.MutationObserver) {
        buildPart(page);
        return;
      }
      const ready = new MutationObserver(() => {
        if (busy()) return;
        ready.disconnect();
        buildPart(page);
      });
      ready.observe(waiting, { attributes: true, attributeFilter: ['aria-busy'] });
      return;
    }
    if (!waiting || calm.matches || !window.MutationObserver) {
      arrive();
      return;
    }
    const accMain = document.querySelector('.acc-main');
    if (accMain) enter(accMain, { watch: 0, title: false });
    document.documentElement.classList.add('rz-in');
    const ready = new MutationObserver(() => {
      if (busy()) return;
      ready.disconnect();
      fillIn();
    });
    ready.observe(waiting, { attributes: true, attributeFilter: ['aria-busy'] });
  }

  // a view of a page that is opened (a tab of the dashboard or of Manage account, a part of the admin page)
  function watchViews() {
    if (!window.MutationObserver) return;
    const views = document.querySelectorAll('.dash-view, .acc-part, .adm-view');
    if (!views.length) return;
    const watch = new MutationObserver((changes) => changes.forEach((change) => {
      const view = change.target;
      // while an account page is still unseen, its first part comes in with the rest of the page
      if (view.hidden || change.oldValue === null || busy()) return;
      if (buildPage && view.matches(PARTS) && !builtParts.has(view.id)) buildPart(view);
      else enter(view, { again: true });
    }));
    views.forEach((view) => watch.observe(view, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true }));
  }

  if (videoPage) {
    setUpPills();
    watchLeaving();
    watchReturning();
    document.querySelectorAll(LIVE).forEach(watchLive);
    watchViews();
    watchBars();
    countOnSight();
    arriveWhenReady();
    arrivePills();
    // the fonts change the width of every word: the boxes are put in place again (a slide on its way follows)
    if (document.fonts) document.fonts.ready.then(() => pills.forEach((p) => place(p, !p.raf)));
  } else {
    navGlide();
  }

  window.rzgsMotion = { shake, reveal, conceal, fromTap, enter, letters, count, grow, pills: setUpPills };
})();
