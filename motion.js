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
  }

  window.rzgsMotion = { shake, reveal, conceal, fromTap };
})();
