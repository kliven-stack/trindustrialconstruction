/**
 * Functional tests against the built clone (playbook §2: "plus functional tests").
 *
 * Everything the replaced WordPress JS used to do is exercised here — the parts a
 * computed-style diff cannot see. Run `node scripts/serve.mjs` first.
 *
 *   node scripts/functional.mjs
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.CLONE_ORIGIN || 'http://localhost:4321';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch();

/** SmartMenus only enables hover after two mousemoves ≤4px apart; mimic a real hand. */
const fineMove = async (page, x, y) => {
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(x + i * 2, y);
    await page.waitForTimeout(40);
  }
};

const open = async (path, width = 1440, height = 900) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**/*.{mp4,mov,webm}', (r) => r.abort());
  const page = await ctx.newPage();
  await page.bringToFront();
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { ctx, page };
};

/* ---------------------------------------------------------------- desktop nav */
{
  const { ctx, page } = await open('/');
  const parent = 'header .elementor-nav-menu--main .menu-item-has-children';
  const sub = `${parent} .sub-menu`;
  const shown = () => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sub);

  check('nav: submenu starts closed', (await shown()) === 'none');

  const box = await page.locator(`${parent} > a`).first().boundingBox();
  await fineMove(page, box.x + box.width / 2 - 6, box.y + box.height / 2);
  await page.waitForTimeout(500);
  check('nav: opens on hover', (await shown()) === 'block');

  // Playbook §3.11: the pointer must survive the gap between item and submenu.
  await fineMove(page, box.x + box.width / 2, box.y + box.height + 3);
  await page.waitForTimeout(150);
  const survivedGap = (await shown()) === 'block';
  await fineMove(page, box.x + 30, box.y + box.height + 30);
  await page.waitForTimeout(200);
  check('nav: stays open crossing the gap to a submenu item', survivedGap && (await shown()) === 'block');

  // The close is on a timer, so it must still be open shortly after leaving.
  await page.mouse.move(300, 700);
  await page.waitForTimeout(200);
  const stillOpenEarly = (await shown()) === 'block';
  await page.waitForTimeout(700);
  check('nav: closes ~500ms after leaving, not instantly', stillOpenEarly && (await shown()) === 'none');

  // Production behaviour (verified against the live site): hovering a parent opens
  // it, so the click that follows toggles it shut, and the next click reopens it.
  await fineMove(page, box.x + box.width / 2 - 6, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const openOnHover = (await shown()) === 'block';
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(350);
  const closedByClick = (await shown()) === 'none';
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(350);
  check('nav: click toggles an open submenu shut, then reopens it',
    openOnHover && closedByClick && (await shown()) === 'block');

  await page.mouse.click(600, 700);
  await page.waitForTimeout(350);
  check('nav: outside click closes', (await shown()) === 'none');

  check('nav: parent link has SmartMenus a11y attributes', await page.evaluate((s) => {
    const a = document.querySelector(s + ' > a');
    return a.classList.contains('has-submenu') && a.hasAttribute('aria-haspopup') && a.hasAttribute('aria-controls');
  }, parent));

  await ctx.close();
}

/* ---------------------------------------------------------------- burger menu */
for (const width of [900, 390]) {
  const { ctx, page } = await open('/', width, 844);
  const toggle = 'header .elementor-menu-toggle';
  const panel = 'header nav.elementor-nav-menu--dropdown';

  const height = () => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().height), panel);
  check(`burger @${width}: toggle is visible`, await page.locator(toggle).first().isVisible());
  check(`burger @${width}: panel starts collapsed`, (await height()) === 0);

  await page.locator(toggle).first().click();
  await page.waitForTimeout(600);
  const openHeight = await height();
  check(`burger @${width}: opens`, openHeight > 60, `${openHeight}px`);
  check(`burger @${width}: toggle marked active`, await page.evaluate((s) => document.querySelector(s).classList.contains('elementor-active'), toggle));
  check(`burger @${width}: panel stretches to the viewport`, await page.evaluate((s) => Math.abs(document.querySelector(s).getBoundingClientRect().width - document.documentElement.clientWidth) < 2, panel));

  await page.locator(`${panel} .menu-item-has-children > a`).first().click();
  await page.waitForTimeout(400);
  check(`burger @${width}: submenu expands in place`, await page.evaluate((s) => getComputedStyle(document.querySelector(s + ' .sub-menu')).display === 'block', panel));

  await page.locator(toggle).first().click();
  await page.waitForTimeout(600);
  check(`burger @${width}: closes`, (await height()) === 0);
  await ctx.close();
}

/* ---------------------------------------------------------------- sticky header */
{
  const { ctx, page } = await open('/');
  const sticky = 'header > .elementor-sticky--active';
  check('sticky: pinned and spacer inserted', await page.evaluate((s) => {
    const el = document.querySelector(s);
    const spacer = document.querySelector('header > .elementor-sticky__spacer');
    return !!el && !!spacer && getComputedStyle(el).position === 'fixed'
      && Math.abs(el.getBoundingClientRect().height - spacer.getBoundingClientRect().height) < 2;
  }, sticky));
  check('sticky: no effects class at rest', !(await page.evaluate((s) => document.querySelector(s).classList.contains('elementor-sticky--effects'), sticky)));
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(400);
  check('sticky: effects class past the offset', await page.evaluate((s) => document.querySelector(s).classList.contains('elementor-sticky--effects'), sticky));
  check('sticky: header stays at the top of the viewport', await page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top) === 0, sticky));
  await ctx.close();
}

/* ---------------------------------------------------------------- accordion */
{
  const { ctx, page } = await open('/');
  const items = 'details.e-n-accordion-item';
  const openCount = () => page.evaluate((s) => [...document.querySelectorAll(s)].filter((d) => d.open).length, items);
  check('accordion: one item open by default', (await openCount()) === 1);
  await page.locator(`${items} summary`).nth(1).click();
  await page.waitForTimeout(400);
  check('accordion: opening the second closes the first', (await openCount()) === 1
    && (await page.evaluate((s) => document.querySelectorAll(s)[1].open, items)));
  check('accordion: summary reports aria-expanded', await page.evaluate((s) => {
    const d = document.querySelectorAll(s)[1];
    return d.querySelector('summary').getAttribute('aria-expanded') === 'true';
  }, items));
  await ctx.close();
}

/* ---------------------------------------------------------------- carousel */
{
  const { ctx, page } = await open('/');
  const root = '.e-n-carousel';
  await page.evaluate(() => document.querySelector('.e-n-carousel').scrollIntoView());
  await page.waitForTimeout(400);

  const state = () => page.evaluate((s) => {
    const el = document.querySelector(s);
    const wrap = el.querySelector('.swiper-wrapper');
    return {
      transform: wrap.style.transform,
      active: [...wrap.children].findIndex((c) => c.classList.contains('swiper-slide-active')),
      bullets: [...el.parentElement.querySelectorAll('.swiper-pagination-bullet')].length,
      activeBullet: [...el.parentElement.querySelectorAll('.swiper-pagination-bullet')].findIndex((b) => b.classList.contains('swiper-pagination-bullet-active')),
      slides: wrap.children.length,
      clones: wrap.querySelectorAll('.swiper-slide-duplicate').length,
    };
  }, root);

  const a = await state();
  check('carousel: swiper classes applied', await page.evaluate((s) => document.querySelector(s).classList.contains('swiper-initialized'), root));
  check('carousel: loop clones present', a.clones > 0, `${a.clones} clones around ${a.slides - a.clones} slides`);
  check('carousel: bullets rendered, first active', a.bullets === 4 && a.activeBullet === 0);

  await page.locator(`${root} ~ .swiper-pagination .swiper-pagination-bullet`).nth(2).click().catch(async () => {
    await page.locator('.swiper-pagination-bullet').nth(2).click();
  });
  await page.waitForTimeout(900);
  const b2 = await state();
  check('carousel: bullet click moves the track', b2.activeBullet === 2 && b2.transform !== a.transform);

  // Autoplay is 5s; wait past one tick.
  await page.mouse.move(10, 10);
  const before = (await state()).activeBullet;
  await page.waitForTimeout(6000);
  const afterAuto = (await state()).activeBullet;
  check('carousel: autoplay advances', afterAuto !== before, `${before} → ${afterAuto}`);
  await ctx.close();
}

/* ---------------------------------------------------------------- gallery + lightbox */
{
  const { ctx, page } = await open('/gallery/');
  const container = '.elementor-gallery__container';
  check('gallery: grid classes and variables applied', await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el.classList.contains('e-gallery-grid')
      && el.style.getPropertyValue('--columns') === '3'
      && el.style.getPropertyValue('--hgap') === '30px';
  }, container));
  check('gallery: every tile painted its thumbnail', await page.evaluate((s) => {
    const tiles = [...document.querySelectorAll(s + ' .e-gallery-image')];
    return tiles.length > 0 && tiles.every((t) => t.style.backgroundImage.includes('url('));
  }, container));
  check('gallery: tiles laid out in 3 columns', await page.evaluate((s) => {
    const items = [...document.querySelectorAll(s + ' .e-gallery-item')].slice(0, 4);
    const xs = items.map((i) => Math.round(i.getBoundingClientRect().x));
    return new Set(xs).size === 3 && xs[0] === xs[3];
  }, container));

  await page.locator('.e-gallery-item').first().click();
  await page.waitForTimeout(700);

  const BRAND_BLUE = 'rgb(41, 128, 185)';
  const RESTING = 'rgba(255, 255, 255, 0.12)';

  check('lightbox: opens as a modal dialog with a dimmed backdrop', await page.evaluate(() => {
    const d = document.querySelector('dialog.gm-lightbox');
    return !!d && d.matches(':modal')
      && getComputedStyle(d, '::backdrop').backgroundColor === 'rgba(0, 0, 0, 0.85)'
      && !!d.querySelector('img.gm-lightbox__image[src]');
  }));

  check('lightbox: controls are compact circles, not full-height strips', await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.gm-lightbox__control')];
    return controls.length === 3 && controls.every((c) => {
      const r = c.getBoundingClientRect();
      return r.width >= 40 && r.width <= 60 && r.height >= 40 && r.height <= 60
        && getComputedStyle(c).borderRadius === '50%';
    });
  }));

  // The Hello theme paints every bare `button:hover`/`:focus` with its own #c36,
  // and showModal() autofocuses the close button — this is the regression guard.
  check('lightbox: controls rest translucent, not the theme pink', await page.evaluate((resting) =>
    [...document.querySelectorAll('.gm-lightbox__control')]
      .every((c) => getComputedStyle(c).backgroundColor === resting), RESTING));

  const firstSrc = await page.evaluate(() => document.querySelector('.gm-lightbox__image').src);
  check('lightbox: counter reports position', /^1 \/ \d+$/.test((await page.textContent('.gm-lightbox__count')) ?? ''));

  await page.locator('.gm-lightbox__next').hover();
  await page.waitForTimeout(350);
  check('lightbox: next turns the site blue on hover',
    (await page.evaluate(() => getComputedStyle(document.querySelector('.gm-lightbox__next')).backgroundColor)) === BRAND_BLUE);

  await page.locator('.gm-lightbox__next').click();
  await page.waitForTimeout(400);
  check('lightbox: next advances', await page.evaluate((s) => document.querySelector('.gm-lightbox__image').src !== s, firstSrc));

  await page.locator('.gm-lightbox__close').hover();
  await page.waitForTimeout(350);
  check('lightbox: close turns the site blue on hover',
    (await page.evaluate(() => getComputedStyle(document.querySelector('.gm-lightbox__close')).backgroundColor)) === BRAND_BLUE);

  await page.locator('.gm-lightbox__close').click();
  await page.waitForTimeout(400);
  check('lightbox: close button closes it', await page.evaluate(() => !document.querySelector('dialog.gm-lightbox')));

  await page.locator('.e-gallery-item').first().click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('lightbox: Escape closes', await page.evaluate(() => !document.querySelector('dialog.gm-lightbox')));

  // Responsive column counts.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(500);
  check('gallery: 2 columns on tablet', await page.evaluate((s) => document.querySelector(s).style.getPropertyValue('--columns') === '2', container));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  check('gallery: 1 column on mobile', await page.evaluate((s) => document.querySelector(s).style.getPropertyValue('--columns') === '1', container));
  await ctx.close();
}

/* ---------------------------------------------------------------- popup */
{
  const { ctx, page } = await open('/learn-more-first/');
  check('popup: template parked out of the flow until opened', await page.evaluate(() => !document.querySelector('.elementor-location-popup')));
  await page.locator('a[href*="popup"]').first().click();
  await page.waitForTimeout(800);
  check('popup: opens with content, not an empty overlay', await page.evaluate(() => {
    const modal = document.querySelector('.elementor-popup-modal');
    if (!modal) return false;
    const body = modal.querySelector('.elementor-location-popup');
    return !!body && body.getBoundingClientRect().height > 100;
  }));
  // This popup's compiled CSS hides the close button (`display:none`), same as
  // production, so the ways out are the backdrop and Escape.
  check('popup: close button hidden, as on production', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.elementor-popup-modal .dialog-close-button')).display === 'none'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('popup: Escape closes', await page.evaluate(() => !document.querySelector('.elementor-popup-modal')));
  await ctx.close();
}

/* ---------------------------------------------------------------- video widgets */
{
  const { ctx, page } = await open('/');
  check('video: poster overlay present before play', await page.evaluate(() => !!document.querySelector('.elementor-widget-video .elementor-custom-embed-image-overlay')));
  await page.evaluate(() => document.querySelector('.elementor-widget-video').scrollIntoView());
  await page.waitForTimeout(300);
  await page.locator('.elementor-custom-embed-image-overlay').first().click();
  await page.waitForTimeout(500);
  check('video: overlay removed on click', await page.evaluate(() => {
    const w = document.querySelector('.elementor-widget-video');
    return !w.querySelector('.elementor-custom-embed-image-overlay');
  }));
  check('background video: source set on the server-rendered player', await page.evaluate(() => {
    const v = document.querySelector('.elementor-background-video-container video.elementor-background-video-hosted');
    return !!v && v.muted && v.loop && v.autoplay && v.getAttribute('src').startsWith('/wp-content/');
  }));
  await ctx.close();
}

/* ---------------------------------------------------------------- background video fit */
// The player is sized from the container, not from the file, so it has to cover the
// section at every width. It letterboxed badly on mobile before this was checked.
for (const [width, height] of [[1440, 900], [900, 800], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.bringToFront();
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const fit = await page.evaluate(() => {
    const container = document.querySelector('.elementor-background-video-container');
    const video = container?.querySelector('video');
    if (!container || !video) return null;
    const c = container.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    return { cw: Math.round(c.width), ch: Math.round(c.height), vw: Math.round(v.width), vh: Math.round(v.height) };
  });
  check(`background video @${width}: covers its section`,
    !!fit && fit.vw >= fit.cw - 1 && fit.vh >= fit.ch - 1,
    fit && `${fit.vw}x${fit.vh} over ${fit.cw}x${fit.ch}`);
  await ctx.close();
}

/* ---------------------------------------------------------------- countdown */
{
  const { ctx, page } = await open('/live-event-thank-you/');
  check('countdown: renders four units', await page.evaluate(() => document.querySelectorAll('.elementor-countdown-item').length === 4));
  check('countdown: expired target clamps to zero (matches production)', await page.evaluate(() =>
    [...document.querySelectorAll('.elementor-countdown-digits')].every((d) => d.textContent.trim() === '00')));
  await ctx.close();
}

/* ---------------------------------------------------------------- search */
{
  const { ctx, page } = await open('/blog/why-pools-expensive/');
  check('search: widget revealed on init', await page.evaluate(() => {
    const s = document.querySelector('search.e-search');
    return !s.classList.contains('hidden') && s.getBoundingClientRect().height > 20;
  }));
  await page.fill('.e-search-input', 'saltwater');
  await page.locator('.e-search-form').evaluate((f) => f.submit());
  await page.waitForURL('**/search/**', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const hits = await page.evaluate(() => document.querySelectorAll('#search-results article.post').length);
  check('search: query returns results', hits > 0, `${hits} hits for "saltwater"`);
  check('search: heading echoes the term', (await page.textContent('#search-term'))?.trim() === 'saltwater');

  await page.goto(`${ORIGIN}/search/?s=zzzznotathing`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check('search: empty result set says so', await page.evaluate(() => !document.getElementById('search-empty').hidden));
  await ctx.close();
}

/* ---------------------------------------------------------------- contact form */
{
  const { ctx, page } = await open('/diy-program/');
  const hasForm = await page.evaluate(() => !!document.querySelector('form.gm-form__form'));
  if (hasForm) {
    check('form: honeypot is hidden from people', await page.evaluate(() => {
      const hp = document.querySelector('input[name="website"]');
      return hp.getBoundingClientRect().width <= 1 && hp.tabIndex === -1;
    }));
    check('form: required fields block submission', await page.evaluate(() => {
      const form = document.querySelector('form.gm-form__form');
      return !form.checkValidity();
    }));
  } else {
    check('form: LeadConnector embed retained while no endpoint is configured', await page.evaluate(() =>
      !!document.querySelector('iframe[src*="links.trindustrialconstruction.com/widget/form"]')));
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exitCode = 1;
}
