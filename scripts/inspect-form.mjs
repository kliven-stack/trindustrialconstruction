// The WordPress pages embed LeadConnector (GoHighLevel) form widgets in iframes.
// The widget host resets direct requests, so read it through the page that embeds
// it — the real field set, labels, options and rendered height at each breakpoint
// (playbook §7.5).
import { chromium } from 'playwright';

const TARGETS = [
  ['/', 1440],
  ['/', 900],
  ['/', 390],
  ['/contact/', 1440],
];

const b = await chromium.launch();
for (const [path, width] of TARGETS) {
  const ctx = await b.newContext({ viewport: { width, height: 1200 } });
  await ctx.route('**/*.{mp4,mov,webm}', (r) => r.abort());
  const p = await ctx.newPage();
  await p.bringToFront();
  await p.goto('https://trindustrialconstruction.com' + path, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(6000);

  console.log(`\n===== ${path} @${width}`);
  for (const el of await p.locator('iframe').all()) {
    const src = await el.getAttribute('src');
    const box = await el.boundingBox();
    console.log(`iframe ${src}`);
    console.log('  box:', box && { w: Math.round(box.width), h: Math.round(box.height) });
  }
  for (const frame of p.frames()) {
    if (!/trustymail|leadconnector/.test(frame.url())) continue;
    try {
      const info = await frame.evaluate(() => ({
        height: document.body.scrollHeight,
        heading: (document.querySelector('h1,h2,h3')?.textContent || '').trim(),
        fields: [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => el.type !== 'hidden')
          .map((el) => ({
            tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || el.id || null,
            placeholder: el.placeholder || null, required: el.required || el.getAttribute('aria-required') === 'true',
            label: (document.querySelector(`label[for="${el.id}"]`)?.textContent || '').trim().slice(0, 60),
            options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text) : undefined,
          })),
        buttons: [...document.querySelectorAll('button, input[type=submit]')].map((el) => (el.textContent || el.value || '').trim()).filter(Boolean),
        smallprint: [...document.querySelectorAll('p, span, label, div')].map((el) => el.textContent.trim())
          .filter((t) => t.length > 30 && t.length < 400 && /consent|agree|terms|privacy|msg|sms|rates/i.test(t)).slice(0, 3),
      }));
      console.log('  frame:', frame.url());
      console.log('  ', JSON.stringify(info, null, 1).replace(/\n/g, '\n  '));
    } catch (e) { console.log('  frame read failed:', e.message); }
  }
  await ctx.close();
}
await b.close();
