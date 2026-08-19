/**
 * Runtime for the cloned Elementor markup.
 *
 * The pages ship Elementor's compiled CSS verbatim, so the job here is to
 * reproduce the *DOM contract* the WordPress JS created — the classes, inline
 * styles and injected nodes the stylesheets and the layout depend on — not to
 * re-invent the behaviour (playbook §3.12, §7.3). Every contract below was read
 * off the live site's post-init DOM with scripts/inspect-live.mjs.
 *
 * Replaces: elementor-frontend, elementor-pro-frontend, smartmenus, e-sticky,
 * the Essential Addons frontend (isotope + imagesLoaded) and jQuery.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const onReady = (fn) =>
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn();

const settingsOf = (el) => {
  try { return JSON.parse(el.getAttribute('data-settings') || '{}'); } catch { return {}; }
};

/* ------------------------------------------------------------------ *
 * Environment classes
 *
 * Elementor stamps the browser/OS onto <body>; e-apple-webkit.css keys 61 rules
 * off `.e--ua-appleWebkit`, so Safari renders differently without them.
 * ------------------------------------------------------------------ */
function initEnvironment() {
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const flags = {
    webkit: /AppleWebKit/i.test(ua),
    blink: /Chrome/i.test(ua) && !/Edge/i.test(ua),
    chrome: /Chrome/i.test(ua) && !/Edg/i.test(ua),
    safari: isSafari,
    appleWebkit: isSafari,
    firefox: /Firefox/i.test(ua),
    gecko: /Gecko\//i.test(ua) && /Firefox/i.test(ua),
    edge: /Edg\//i.test(ua),
    mac: /Mac/i.test(navigator.platform || ua),
    windows: /Win/i.test(navigator.platform || ua),
    linux: /Linux/i.test(navigator.platform || ua) && !/Android/i.test(ua),
  };
  for (const [key, on] of Object.entries(flags)) {
    if (on) document.body.classList.add(`e--ua-${key}`);
  }
}

/* ------------------------------------------------------------------ *
 * Background lazy-load
 *
 * Elementor prints a stylesheet that blanks background images on the 4th and
 * later top-level containers until JS marks them `.e-lazyloaded`. Without this
 * the guard never lifts and those sections lose their backgrounds entirely.
 * ------------------------------------------------------------------ */
function initLazyBackgrounds() {
  const targets = document.querySelectorAll('.e-con.e-parent:not(.e-no-lazyload)');
  if (!targets.length) return;
  const reveal = (el) => el.classList.add('e-lazyloaded');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(reveal);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target);
      io.unobserve(entry.target);
    }
  }, { rootMargin: '400px 0px' });
  targets.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ *
 * Sticky containers (e-sticky)
 *
 * Contract: the container gains `elementor-sticky elementor-sticky--active
 * elementor-section--handles-inside`, is pinned with inline position/width/top,
 * and a visibility-hidden clone (`elementor-sticky__spacer`) is inserted after
 * it to hold the space. Past `sticky_effects_offset` it also gains
 * `elementor-sticky--effects`, which the compiled CSS animates.
 * ------------------------------------------------------------------ */
function initSticky() {
  const els = [...document.querySelectorAll('[data-settings]')].filter((el) => {
    const s = settingsOf(el);
    return s.sticky === 'top' || s.sticky === 'bottom';
  });

  for (const el of els) {
    const s = settingsOf(el);
    const effectsOffset = Number(s.sticky_effects_offset) || 0;
    const offset = Number(s.sticky_offset) || 0;

    const spacer = el.cloneNode(true);
    spacer.classList.add('elementor-sticky__spacer');
    spacer.classList.remove('elementor-sticky--active', 'elementor-sticky--effects');
    spacer.removeAttribute('data-settings');
    spacer.setAttribute('style', 'visibility: hidden; transition: none; animation: auto ease 0s 1 normal none running none;');
    spacer.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    el.after(spacer);

    el.classList.add('elementor-sticky', 'elementor-sticky--active', 'elementor-section--handles-inside');

    const pin = () => {
      const width = spacer.getBoundingClientRect().width;
      el.style.cssText = `position: fixed; width: ${width}px; margin-top: 0px; margin-bottom: 0px; ${s.sticky === 'bottom' ? 'bottom' : 'top'}: ${offset}px;`;
    };
    const sync = () => {
      el.classList.toggle('elementor-sticky--effects', window.scrollY > effectsOffset);
    };

    pin();
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', () => { pin(); sync(); });
  }
}

/* ------------------------------------------------------------------ *
 * Nav menu (SmartMenus replacement)
 *
 * Both navs — the horizontal one and the burger panel — are SmartMenus instances
 * on the live site, so both get the same annotations and the same click rule.
 * Read off production:
 *
 *   click a parent whose submenu is CLOSED  → open it, do not follow the link
 *   click a parent whose submenu is OPEN    → follow the link
 *
 * That matters: every parent here has a real href (`/services`, `/buildings/`),
 * so a plain "navigate on click" makes the submenus unreachable on touch — the
 * burger panel would jump to /services instead of expanding.
 *
 * Desktop additionally opens on hover after 250 ms and closes 500 ms after the
 * pointer leaves — the delay is what lets the pointer cross the gap between the
 * parent item and the submenu (playbook §3.11).
 *
 * Mobile: the burger toggles `.elementor-active` on the toggle and drives the
 * dropdown's `--menu-height`; the dropdown itself is stretched to the viewport
 * width by Elementor's "stretch" option, which is inline `width`/`left`/`top`.
 * ------------------------------------------------------------------ */
const SHOW_TIMEOUT = 250;
const HIDE_TIMEOUT = 500;
const OPEN_SUBMENU_STYLE =
  'z-index: 3; width: auto; min-width: 10em; display: block; max-width: 1000px; top: auto; left: 0px; margin-left: 0px; margin-top: 0px;';
const CLOSED_SUBMENU_STYLE =
  'width: auto; min-width: 10em; display: none; max-width: 1000px; top: auto; left: 0px; margin-left: 0px; margin-top: 0px;';

let menuUid = 0;

function initNavMenu(widget) {
  const mainNav = widget.querySelector('nav.elementor-nav-menu--main');
  const dropdownNav = widget.querySelector('nav.elementor-nav-menu--dropdown');
  const toggle = widget.querySelector('.elementor-menu-toggle');
  const stretch = settingsOf(widget).full_width === 'stretch';

  if (mainNav) initDesktopMenu(mainNav);
  if (dropdownNav) initCollapsibleMenu(dropdownNav);
  if (toggle && dropdownNav) initToggle(toggle, dropdownNav, widget, stretch);
}

/**
 * The annotations SmartMenus adds to a nav on init: an instance id on the list,
 * and the `has-submenu` / id / aria pairing between each parent link and its
 * submenu. The compiled CSS and assistive tech both key off these.
 *
 * @returns {Array<{li: Element, link: Element, sub: Element}>} the parent items.
 */
function annotateSubmenus(nav) {
  const root = nav.querySelector('ul.elementor-nav-menu');
  if (!root) return [];
  const uid = `sm-${++menuUid}`;
  root.setAttribute('data-smartmenus-id', uid);

  const parents = [];
  [...nav.querySelectorAll('li.menu-item-has-children')].forEach((li, i) => {
    const link = li.querySelector(':scope > a');
    const sub = li.querySelector(':scope > ul.sub-menu');
    if (!link || !sub) return;
    const linkId = `${uid}-${i * 2 + 1}`;
    const subId = `${uid}-${i * 2 + 2}`;
    link.classList.add('has-submenu');
    link.id = linkId;
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-controls', subId);
    link.setAttribute('aria-expanded', 'false');
    sub.id = subId;
    sub.setAttribute('role', 'group');
    sub.setAttribute('aria-hidden', 'true');
    sub.setAttribute('aria-labelledby', linkId);
    sub.setAttribute('aria-expanded', 'false');
    parents.push({ li, link, sub });
  });
  return parents;
}

/** Marks a parent open or closed, aria included. `styleFor` differs per nav. */
function setExpanded({ link, sub }, open, styleFor) {
  link.setAttribute('aria-expanded', String(open));
  sub.setAttribute('aria-hidden', String(!open));
  sub.setAttribute('aria-expanded', String(open));
  sub.setAttribute('style', styleFor(open));
}

const isOpen = ({ link }) => link.getAttribute('aria-expanded') === 'true';

/**
 * Wires the click rule shared by both navs: the first click opens, and only a
 * click on an already-open parent follows the link. A parent whose href is a
 * `#` placeholder never navigates.
 */
function wireParentClick(parent, styleFor, { onOpen, beforeOpen } = {}) {
  parent.link.addEventListener('click', (event) => {
    if (isOpen(parent)) {
      if (parent.link.getAttribute('href') === '#') {
        event.preventDefault();
        setExpanded(parent, false, styleFor);
      }
      return; // open already — let the browser follow the link
    }
    event.preventDefault();
    beforeOpen?.(parent);
    setExpanded(parent, true, styleFor);
    onOpen?.(parent);
  });
}

function initDesktopMenu(nav) {
  const parents = annotateSubmenus(nav);
  if (!parents.length) return;
  const styleFor = (open) => (open ? OPEN_SUBMENU_STYLE : CLOSED_SUBMENU_STYLE);

  let openItem = null;
  let showTimer = null;
  let hideTimer = null;

  const close = (parent) => {
    if (!parent) return;
    setExpanded(parent, false, styleFor);
    if (openItem === parent) openItem = null;
  };
  const open = (parent) => {
    if (openItem && openItem !== parent) close(openItem);
    setExpanded(parent, true, styleFor);
    openItem = parent;
  };
  const cancelTimers = () => { clearTimeout(showTimer); clearTimeout(hideTimer); };

  for (const parent of parents) {
    parent.li.addEventListener('mouseenter', () => {
      cancelTimers();
      showTimer = setTimeout(() => open(parent), SHOW_TIMEOUT);
    });
    parent.li.addEventListener('mouseleave', () => {
      cancelTimers();
      hideTimer = setTimeout(() => close(parent), HIDE_TIMEOUT);
    });
    parent.li.addEventListener('focusout', (e) => {
      if (parent.li.contains(e.relatedTarget)) return;
      cancelTimers();
      hideTimer = setTimeout(() => close(parent), HIDE_TIMEOUT);
    });
    // Keyboard focus only. A mouse press focuses the link before the click event
    // fires, so opening on any focusin would leave the click handler looking at an
    // already-open menu — and following the link instead of opening it.
    parent.li.addEventListener('focusin', (e) => {
      if (!e.target.matches?.(':focus-visible')) return;
      cancelTimers();
      open(parent);
    });
    wireParentClick(parent, styleFor, {
      beforeOpen: () => { cancelTimers(); if (openItem) close(openItem); },
      onOpen: (p) => { openItem = p; },
    });
  }

  document.addEventListener('click', (e) => {
    if (openItem && !openItem.li.contains(e.target)) close(openItem);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openItem) close(openItem);
  });
}

/** The burger panel: submenus expand in flow, and the panel re-measures. */
function initCollapsibleMenu(nav) {
  const styleFor = (open) => `width: auto; display: ${open ? 'block' : 'none'};`;
  for (const parent of annotateSubmenus(nav)) {
    setExpanded(parent, false, styleFor);
    wireParentClick(parent, styleFor);
  }
}

function initToggle(toggle, dropdownNav, widget, stretch) {
  const list = dropdownNav.querySelector('ul.elementor-nav-menu');
  // Elementor stamps the toggle's button semantics from JS, not from PHP.
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-label', 'Menu Toggle');

  /** Elementor's "stretch" option pins the panel to the viewport width. */
  const place = () => {
    const rect = dropdownNav.getBoundingClientRect();
    const parentRect = widget.getBoundingClientRect();
    const style = {
      top: `${Math.round(parentRect.height)}px`,
    };
    if (stretch) {
      const viewport = document.documentElement.clientWidth;
      const left = rect.left - parseFloat(dropdownNav.style.left || '0');
      style.width = `${viewport}px`;
      style.left = `${-left}px`;
    }
    Object.assign(dropdownNav.style, style);
  };

  const setOpen = (open) => {
    toggle.classList.toggle('elementor-active', open);
    toggle.setAttribute('aria-expanded', String(open));
    dropdownNav.style.setProperty('--menu-height', open ? `${list.scrollHeight}px` : '0');
    dropdownNav.setAttribute('aria-hidden', String(!open));
  };

  place();
  setOpen(false);
  window.addEventListener('resize', () => {
    place();
    if (toggle.classList.contains('elementor-active')) setOpen(true);
  });

  const flip = () => setOpen(!toggle.classList.contains('elementor-active'));
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
  });
  // Reopening after a submenu expands has to re-measure the panel.
  dropdownNav.addEventListener('click', () => {
    if (toggle.classList.contains('elementor-active')) {
      requestAnimationFrame(() => setOpen(true));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Container background video
 *
 * WordPress already renders the container and an empty <video> into
 * `.e-con-inner`; Elementor's JS only fills in the `src`. Setting the source on
 * the existing element is the whole contract — creating a second player would
 * leave the server-rendered one silently blank.
 * ------------------------------------------------------------------ */
function initBackgroundVideo() {
  for (const el of document.querySelectorAll('[data-settings]')) {
    const s = settingsOf(el);
    if (s.background_background !== 'video' || !s.background_video_link) continue;

    let video = el.querySelector(':scope > .e-con-inner > .elementor-background-video-container > video, :scope > .elementor-background-video-container > video');

    if (!video) {
      const host = el.querySelector(':scope > .e-con-inner') || el;
      const container = document.createElement('div');
      container.className = 'elementor-background-video-container';
      video = document.createElement('video');
      video.className = 'elementor-background-video-hosted';
      video.setAttribute('role', 'presentation');
      container.append(video);
      host.prepend(container);
    }

    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    if (!video.getAttribute('src')) video.src = s.background_video_link;

    // Elementor sizes the player from the *container*, not from the video's own
    // dimensions: whichever axis is short gets 100% and the other overflows, so the
    // frame always covers. Without this the video falls back to its intrinsic
    // aspect ratio and letterboxes — badly on mobile, where the section is tall.
    const ratio = aspectRatio(s.background_video_ratio);
    const fit = () => {
      // Size against the video container, which is pinned to the whole section —
      // not against `.e-con-inner`, which is the boxed content column and is
      // narrower on every boxed layout.
      const host = video.parentElement ?? el;
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      const widthIsFixed = width / height > ratio;
      video.style.width = widthIsFixed ? '100%' : `${height * ratio}px`;
      video.style.height = widthIsFixed ? `${width / ratio}px` : '100%';
    };
    fit();
    window.addEventListener('resize', fit);
    video.addEventListener('loadedmetadata', fit);

    // Autoplay only starts once a source exists, and only for a muted element.
    video.play?.().catch(() => { /* blocked by policy — the poster still shows */ });
  }
}

/** Elementor's background-video ratio setting, defaulting to 16:9. */
function aspectRatio(setting) {
  const [w, h] = String(setting || '16:9').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/* ------------------------------------------------------------------ *
 * Entrance animations
 *
 * Elementor renders the widget with `elementor-invisible` and the animation name
 * in `data-settings._animation`. On the element scrolling into view it drops the
 * invisible class and adds `animated <name>` after `_animation_delay` ms; the
 * keyframes come from the e-animation-<name> stylesheet the page already links.
 * ------------------------------------------------------------------ */
function initAnimations() {
  const targets = [...document.querySelectorAll('.elementor-invisible[data-settings]')]
    .filter((el) => {
      const name = settingsOf(el)._animation;
      return name && name !== 'none';
    });
  if (!targets.length) return;

  const run = (el) => {
    const { _animation: name, _animation_delay: delay } = settingsOf(el);
    setTimeout(() => {
      el.classList.remove('elementor-invisible');
      el.classList.add('animated', name);
    }, Number(delay) || 0);
  };

  // Reduced motion still has to clear `elementor-invisible` — it is what makes the
  // element visible at all — but it skips the keyframes.
  if (reduceMotion) {
    for (const el of targets) el.classList.remove('elementor-invisible');
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      run(entry.target);
    }
  }, { rootMargin: '0px 0px -50px 0px' });
  for (const el of targets) io.observe(el);
}

/* ------------------------------------------------------------------ *
 * Essential Addons filterable gallery
 *
 * WordPress renders the first page of tiles into the container; the plugin's JS
 * then lays them out with Isotope and wires the category controls. Isotope's
 * contract is the whole reason this cannot be left to CSS: the container is
 * `position: relative` with an explicit pixel height, and every tile is
 * `position: absolute` with a percentage `left` and a pixel `top`. Without it the
 * tiles stack and the section collapses (playbook §7.4).
 *
 * Reproduced here as a fitRows layout — items flow left to right into as many
 * columns as their CSS width allows, each row as tall as its tallest tile — which
 * is what the plugin's configuration produces.
 * ------------------------------------------------------------------ */
function initFilterableGallery(widget) {
  const container = widget.querySelector('.eael-filter-gallery-container');
  if (!container) return;
  const items = [...container.querySelectorAll(':scope > .eael-filterable-gallery-item-wrap')];
  if (!items.length) return;

  const duration = Number(settingsOf(container).duration) || 500;
  container.style.position = 'relative';
  for (const item of items) item.style.position = 'absolute';

  let filter = '*';

  const layout = () => {
    const width = container.clientWidth;
    if (!width) return;
    // Per-tile width comes from the widget's own inline stylesheet, as a
    // percentage that changes at Elementor's breakpoints — so measure it rather
    // than duplicating those media queries here.
    const itemWidth = items[0].getBoundingClientRect().width;
    const columns = Math.max(1, Math.round(width / itemWidth));
    const step = 100 / columns;

    let column = 0;
    let top = 0;
    let rowHeight = 0;
    for (const item of items) {
      if (item.dataset.fgHidden === 'true') continue;
      if (column === columns) { column = 0; top += rowHeight; rowHeight = 0; }
      // Isotope prints the percentage at six significant digits.
      item.style.left = `${Number((column * step).toPrecision(6))}%`;
      item.style.top = `${top}px`;
      rowHeight = Math.max(rowHeight, item.getBoundingClientRect().height);
      column++;
    }
    container.style.height = `${top + rowHeight}px`;
  };

  const applyFilter = () => {
    for (const item of items) {
      const shown = filter === '*' || item.matches(filter);
      item.dataset.fgHidden = String(!shown);
      item.style.display = shown ? '' : 'none';
    }
    layout();
  };

  for (const control of widget.querySelectorAll('.eael-filter-gallery-control li[data-filter]')) {
    control.addEventListener('click', () => {
      for (const other of widget.querySelectorAll('.eael-filter-gallery-control li[data-filter]')) {
        other.classList.remove('active');
        other.tabIndex = -1;
      }
      control.classList.add('active');
      control.tabIndex = 0;
      filter = control.getAttribute('data-filter') || '*';
      applyFilter();
    });
  }

  container.style.transitionDuration = `${duration}ms`;
  applyFilter();
  window.addEventListener('resize', layout);
  // Tiles are sized by their images; a tile measured before its image decodes is
  // the wrong height, and every row after it lands in the wrong place.
  for (const img of container.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', layout, { once: true });
  }
}

/* ------------------------------------------------------------------ */
onReady(() => {
  initEnvironment();
  initLazyBackgrounds();
  initSticky();
  initBackgroundVideo();
  initAnimations();

  for (const widget of document.querySelectorAll('[data-widget_type]')) {
    // The sticky spacer is a visibility-hidden clone; wiring its widgets up would
    // duplicate every document-level listener for no visible effect.
    if (widget.closest('.elementor-sticky__spacer')) continue;
    const type = widget.getAttribute('data-widget_type');
    if (type === 'nav-menu.default') initNavMenu(widget);
    else if (type === 'eael-filterable-gallery.default') initFilterableGallery(widget);
  }
});
