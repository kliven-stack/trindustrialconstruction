/**
 * Measured fidelity check (playbook §2): load the same page from production and
 * from the local clone at 1440 / 900 / 390 px, then diff landmark bounding boxes
 * and computed styles element by element.
 *
 * Landmarks are matched by Elementor's stable `data-id`, plus a few structural
 * selectors, so the comparison does not depend on DOM order.
 *
 *   node scripts/compare.mjs [--only=/path/] [--width=1440]
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LIVE = 'https://trindustrialconstruction.com';
const CLONE = process.env.CLONE_ORIGIN || 'http://localhost:4321';
const WIDTHS = [1440, 900, 390];
const TOLERANCE = { pos: 3, size: 3 };

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const pages = JSON.parse(await readFile(ROOT + 'src/data/pages.json', 'utf8'));
const targets = args.only ? pages.filter((p) => p.path === args.only) : pages;
const widths = args.width ? [Number(args.width)] : WIDTHS;

const PROBE = () => {
  const out = {};
  const push = (key, el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[key] = {
      x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
      font: `${cs.fontFamily.split(',')[0].replace(/["']/g, '')} ${cs.fontSize} ${cs.fontWeight}`,
      color: cs.color,
      bg: cs.backgroundColor,
      display: cs.display,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
      align: cs.textAlign,
    };
  };
  for (const el of document.querySelectorAll('[data-id]')) {
    // Carousel loop clones repeat their source data-id; measure the real slide.
    if (el.closest('.swiper-slide-duplicate')) continue;
    const key = `id:${el.getAttribute('data-id')}`;
    if (key in out) continue;
    push(key, el);
  }
  for (const sel of ['body', 'header.elementor-location-header', 'footer.elementor-location-footer', 'main#content', '[data-elementor-type="wp-page"]', '[data-elementor-type="single-post"]', '[data-elementor-type="archive"]',
    // The container is CSS-sized, so it is comparable here. The <video> inside it is
    // not: this run blocks media on both sides, and production only sizes its player
    // once the file loads. That geometry is checked by scripts/compare-video.mjs,
    // which loads the videos for real.
    '.elementor-background-video-container']) {
    const el = document.querySelector(sel);
    if (el) push(`sel:${sel}`, el);
  }
  out['__page'] = { h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth };
  return out;
};

const browser = await chromium.launch();
const report = [];

for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  // Videos never settle and third-party embeds vary run to run; block both sides
  // identically so the geometry is comparable (playbook §7.6).
  await ctx.route('**/*.{mp4,mov,webm}', (r) => r.abort());
  await ctx.route('**://*.googletagmanager.com/**', (r) => r.abort());
  await ctx.route('**://*.google-analytics.com/**', (r) => r.abort());
  // Third-party form/booking widgets render differently run to run (and the widget
  // host rate-limits headless traffic), so their iframes are blocked on both sides.
  // Their boxes are sized by the page's own CSS, so the geometry stays comparable.
  // Production loads its emoji images from s.w.org, which rate-limits repeated
  // headless traffic; a failed one falls back to alt text and inflates the line box.
  // Serve both sides the same mirrored SVG so the geometry is comparable.
  await ctx.route('**s.w.org/images/core/emoji/**', async (r) => {
    try {
      const file = path.join(ROOT, 'public/wp/emoji', path.basename(new URL(r.request().url()).pathname));
      await r.fulfill({ status: 200, contentType: 'image/svg+xml', body: await readFile(file) });
    } catch { await r.continue(); }
  });
  await ctx.route('**://links.trindustrialconstruction.com/**', (r) => r.abort());
  await ctx.route('**://*.calendly.com/**', (r) => r.abort());
  await ctx.route('**://calendly.com/**', (r) => r.abort());

  for (const page of targets) {
    const measure = async (origin) => {
      const tab = await ctx.newPage();
      await tab.bringToFront();
      try {
        await tab.goto(origin + page.path, { waitUntil: 'load', timeout: 90000 });
        // Text wraps differently against fallback metrics. Production serves large
        // unsubsetted TTFs, so it swaps in noticeably later than the clone's woff2 —
        // measuring before both have settled invents differences that are not there.
        await tab.evaluate(() => document.fonts.ready);
        await tab.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await tab.waitForTimeout(1200);
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.waitForTimeout(800);
        // Carousels autoplay on both sides; pin them to the first slide last of
        // all so the geometry diff is deterministic.
        await tab.evaluate(() => {
          for (const el of document.querySelectorAll('.e-n-carousel')) {
            if (el.swiper) { el.swiper.autoplay?.stop(); el.swiper.slideToLoop(0, 0); }
            else if (el.eCarousel) el.eCarousel.reset();
          }
        });
        await tab.waitForTimeout(250);
        return await tab.evaluate(PROBE);
      } finally { await tab.close(); }
    };

    // Sequentially, never concurrently: background tabs throttle layout work.
    const live = await measure(LIVE);
    const clone = await measure(CLONE);

    const diffs = [];
    for (const key of Object.keys(live)) {
      const a = live[key], b = clone[key];
      if (!b) { diffs.push({ key, kind: 'missing' }); continue; }
      if (key === '__page') {
        if (Math.abs(a.h - b.h) > 24) diffs.push({ key, kind: 'page-height', live: a.h, clone: b.h });
        continue;
      }
      for (const prop of ['x', 'y', 'w', 'h']) {
        const limit = prop === 'x' || prop === 'y' ? TOLERANCE.pos : TOLERANCE.size;
        if (Math.abs(a[prop] - b[prop]) > limit) diffs.push({ key, kind: prop, live: a[prop], clone: b[prop] });
      }
      for (const prop of ['font', 'color', 'bg', 'display', 'pad', 'margin', 'align']) {
        if (a[prop] !== b[prop]) diffs.push({ key, kind: prop, live: a[prop], clone: b[prop] });
      }
    }
    const extra = Object.keys(clone).filter((k) => !(k in live));
    report.push({ path: page.path, width, checked: Object.keys(live).length, diffs, extra });
    const flag = diffs.length ? 'DIFF' : ' ok ';
    console.log(`${flag} ${String(width).padStart(4)} ${page.path.padEnd(56)} ${Object.keys(live).length} nodes, ${diffs.length} diffs${extra.length ? `, ${extra.length} extra` : ''}`);
  }
  await ctx.close();
}

await browser.close();
await mkdir(ROOT + '_extract', { recursive: true });
const REPORT = ROOT + (process.env.REPORT_PATH || '_extract/compare-report.json');
await writeFile(REPORT, JSON.stringify(report, null, 2));
const total = report.reduce((n, r) => n + r.diffs.length, 0);
console.log(`\n${report.length} comparisons, ${total} diffs → ${REPORT}`);
