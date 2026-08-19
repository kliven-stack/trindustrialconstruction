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

/* ------------------------------------------------- filterable gallery (EAEL) */
// Essential Addons lays these out with Isotope: without it the tiles stack and the
// section collapses (playbook §7.4). The clone reproduces the same contract —
// absolutely positioned tiles inside a container with an explicit height.
{
  const { ctx, page } = await open('/buildings/car-wash/');
  const container = '.eael-filter-gallery-container';
  const tiles = `${container} > .eael-filterable-gallery-item-wrap`;

  const laid = await page.evaluate((s) => {
    const c = document.querySelector(s);
    const items = [...c.querySelectorAll(':scope > .eael-filterable-gallery-item-wrap')];
    return {
      height: Math.round(c.getBoundingClientRect().height),
      count: items.length,
      absolute: items.every((i) => getComputedStyle(i).position === 'absolute'),
      rows: new Set(items.map((i) => Math.round(i.getBoundingClientRect().top))).size,
      columns: new Set(items.map((i) => Math.round(i.getBoundingClientRect().left))).size,
      overlapping: items.some((a, ai) => items.some((b, bi) => {
        if (ai >= bi) return false;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1;
      })),
    };
  }, container);

  check('gallery: tiles are laid out, not stacked', laid.absolute && laid.height > 300, `${laid.height}px tall`);
  check('gallery: three columns over two rows at 1440', laid.columns === 3 && laid.rows === 2, `${laid.columns}x${laid.rows}`);
  check('gallery: no two tiles overlap', !laid.overlapping);
  check("gallery: shows the plugin's first page of six (matches production)", laid.count === 6, `${laid.count} tiles`);

  const visible = () => page.evaluate((s) =>
    [...document.querySelectorAll(s)].filter((i) => getComputedStyle(i).display !== 'none').length, tiles);
  check('gallery: all tiles visible under the "All" control', (await visible()) === 6);

  await page.locator('.eael-filter-gallery-control li[data-filter=".eael-cf-self-serve-car-wash"]').click();
  await page.waitForTimeout(500);
  const filtered = await visible();
  check('gallery: a category control filters the tiles', filtered > 0 && filtered < 6, `${filtered} of 6`);
  check('gallery: the active control is marked', await page.evaluate(() =>
    document.querySelector('.eael-filter-gallery-control li.active')?.getAttribute('data-filter') === '.eael-cf-self-serve-car-wash'));
  check('gallery: container reflows to the filtered height', await page.evaluate((s) => {
    const c = document.querySelector(s);
    const shown = [...c.querySelectorAll(':scope > .eael-filterable-gallery-item-wrap')]
      .filter((i) => getComputedStyle(i).display !== 'none');
    const bottom = Math.max(...shown.map((i) => i.getBoundingClientRect().bottom));
    return Math.abs(c.getBoundingClientRect().bottom - bottom) < 8;
  }, container));

  await page.locator('.eael-filter-gallery-control li[data-filter="*"]').click();
  await page.waitForTimeout(500);
  check('gallery: "All" restores every tile', (await visible()) === 6);
  await ctx.close();
}

// One column on mobile, two on tablet — the widget prints those widths itself.
for (const [width, columns] of [[900, 2], [390, 1]]) {
  const { ctx, page } = await open('/buildings/car-wash/', width, 844);
  const cols = await page.evaluate(() => new Set([...document.querySelectorAll(
    '.eael-filter-gallery-container > .eael-filterable-gallery-item-wrap')]
    .map((i) => Math.round(i.getBoundingClientRect().left))).size);
  check(`gallery @${width}: ${columns} column(s)`, cols === columns, `${cols}`);
  await ctx.close();
}

/* ------------------------------------------------------------ entrance animation */
// Elementor renders these with `elementor-invisible` and only reveals them from JS.
// If our runtime ever stops running, four hero elements go permanently invisible.
{
  const { ctx, page } = await open('/');
  await page.waitForTimeout(1600);
  check('animation: hero elements are revealed', await page.evaluate(() =>
    document.querySelectorAll('.elementor-invisible').length === 0));
  check('animation: they carry the class the keyframes hang off', await page.evaluate(() =>
    document.querySelectorAll('.animated.fadeInDown').length === 4));
  await ctx.close();
}

/* ---------------------------------------------------------------- contact form */
{
  const { ctx, page } = await open('/contact/');
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
    check("form: carries the widget's seven fields", await page.evaluate(() =>
      document.querySelectorAll('form.gm-form__form .gm-form__field').length === 7));
  } else {
    check('form: LeadConnector embed retained while no endpoint is configured', await page.evaluate(() =>
      !!document.querySelector('iframe[src*="verified.trustymail.co/widget/form"]')));
    check('form: the embed is on every page, via the footer', await page.evaluate(() =>
      !!document.querySelector('footer iframe[src*="verified.trustymail.co"]')));
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