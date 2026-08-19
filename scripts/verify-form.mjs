/**
 * End-to-end proof of the Growthmap form path (playbook §4b), which only renders
 * once PUBLIC_CONTACT_ENDPOINT is set. Builds the site against a local mock
 * endpoint, drives the form in a browser, and checks what actually arrives.
 *
 *   node scripts/verify-form.mjs
 *
 * Restores the normal (no-endpoint) build when it finishes.
 */
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4399;
const ENDPOINT = `http://localhost:${PORT}/lead`;

const received = [];
const endpoint = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push({ method: req.method, body });
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => endpoint.listen(PORT, r));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('building against the mock endpoint…');
await run('npx', ['astro', 'build'], { cwd: ROOT, env: { ...process.env, PUBLIC_CONTACT_ENDPOINT: ENDPOINT } });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.bringToFront();
  await page.goto('http://localhost:4321/diy-program/', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  check('our form replaced the embed', await page.evaluate(() =>
    !!document.querySelector('form.gm-form__form')
    && !document.querySelector('iframe[src*="links.trindustrialconstruction.com/widget/form"]')));

  // Native validation blocks an empty submit.
  await page.locator('.gm-form__submit').click();
  await page.waitForTimeout(400);
  check('empty submit is blocked, nothing sent', received.length === 0);

  // Bad email is rejected before anything is sent.
  await page.fill('input[name="full_name"]', 'Test Person');
  await page.fill('input[name="email"]', 'not-an-email');
  await page.fill('input[name="phone"]', '5551234567');
  await page.locator('.gm-form__submit').click();
  await page.waitForTimeout(400);
  check('invalid email is rejected, nothing sent', received.length === 0);

  // Honeypot: the visitor sees success, the endpoint sees nothing.
  await page.fill('input[name="email"]', 'test@example.com');
  await page.evaluate(() => { document.querySelector('input[name="website"]').value = 'spam'; });
  await page.locator('.gm-form__submit').click();
  await page.waitForTimeout(600);
  check('honeypot: success shown but nothing sent',
    received.length === 0 && /Thanks/i.test(await page.textContent('.gm-form__status') ?? ''));

  // The real path.
  await page.fill('input[name="full_name"]', 'Test Person');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="phone"]', '5551234567');
  await page.fill('input[name="session"]', 'Next Friday');
  await page.locator('.gm-form__submit').click();
  await page.waitForTimeout(1200);

  check('submission reaches the endpoint', received.length === 1, `${received.length} request(s)`);
  const body = received[0]?.body ?? '';
  check('payload carries the form fields', ['Test Person', 'test@example.com', '5551234567', 'Next Friday']
    .every((v) => body.includes(v)));
  check('payload identifies the form and page',
    body.includes('Website VSL') && body.includes('/diy-program/'));
  check('success message shown, form cleared',
    /Thanks/i.test(await page.textContent('.gm-form__status') ?? '')
    && (await page.inputValue('input[name="email"]')) === '');

  // A failing endpoint must surface an error, not a false success.
  await page.route('**/lead', (r) => r.fulfill({ status: 500, body: 'nope' }));
  await page.fill('input[name="full_name"]', 'Test Person');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="phone"]', '5551234567');
  await page.locator('.gm-form__submit').click();
  await page.waitForTimeout(1000);
  check('endpoint failure shows an error, not success',
    /wrong/i.test(await page.textContent('.gm-form__status') ?? ''));
  check('submit button is re-enabled after a failure',
    !(await page.locator('.gm-form__submit').isDisabled()));

  await ctx.close();
} finally {
  await browser.close();
  endpoint.close();
  console.log('\nrestoring the normal build…');
  await run('npx', ['astro', 'build'], { cwd: ROOT });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
