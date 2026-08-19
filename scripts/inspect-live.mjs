// Read the live site's post-init DOM. Elementor's JS mutates markup after load
// (swiper wrappers, smartmenus classes, background <video> injection); the clone has
// to reproduce that DOM contract, not just the behaviour (playbook §3.12, §7.3).
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = ROOT + '_extract/live-dom/';
await mkdir(OUT, { recursive: true });

const targets = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Videos keep networkidle from settling and add nothing to the DOM contract.
await ctx.route('**/*.{mp4,mov,webm}', (r) => r.abort());

for (const t of targets) {
  const page = await ctx.newPage();
  await page.goto(`https://trindustrialconstruction.com${t}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(4000);
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  const name = (t.replace(/^\/|\/$/g, '') || 'index').replace(/\//g, '__');
  await writeFile(OUT + name + '.html', html);
  console.log(name, html.length);
  await page.close();
}
await browser.close();
