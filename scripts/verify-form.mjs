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
  await page.goto('http://localhost:4321/contact/', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // /contact/ renders the form twice — its own copy and the footer's, which the
  // theme hides on this page. Drive the first one.
  const form = page.locator('form.gm-form__form').first();
  const submitButton = form.locator('.gm-form__submit');

  check('our form replaced the embed', await page.evaluate(() =>
    !!document.querySelector('form.gm-form__form')
    && !document.querySelector('iframe[src*="verified.trustymail.co/widget/form"]')));
  check('the two copies on /contact/ do not share field ids', await page.evaluate(() => {
    const ids = [...document.querySelectorAll('form.gm-form__form [id]')].map((el) => el.id);
    return ids.length > 0 && new Set(ids).size === ids.length;
  }));

  // Native validation blocks an empty submit.
  await submitButton.click();
  await page.waitForTimeout(400);
  check('empty submit is blocked, nothing sent', received.length === 0);

  // Every field the widget asked for, so the whole set round-trips.
  const fill = async (email) => {
    await form.locator('input[name="first_name"]').fill('Test');
    await form.locator('input[name="last_name"]').fill('Person');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="phone"]').fill('5551234567');
    await form.locator('textarea[name="project_description"]').fill('A 40,000 sq ft warehouse.');
    await form.locator('input[name="address"]').fill('Shelbyville, TN');
    await form.locator('textarea[name="project_involvement"]').fill('Owner');
  };

  // Bad email is rejected before anything is sent.
  await fill('not-an-email');
  await submitButton.click();
  await page.waitForTimeout(400);
  check('invalid email is rejected, nothing sent', received.length === 0);

  // Honeypot: the visitor sees success, the endpoint sees nothing.
  await fill('test@example.com');
  await form.locator('input[name="website"]').evaluate((el) => { el.value = 'spam'; });
  await submitButton.click();
  await page.waitForTimeout(600);
  check('honeypot: success shown but nothing sent',
    received.length === 0 && /Thanks/i.test(await form.locator('.gm-form__status').textContent() ?? ''));

  // The real path.
  await fill('test@example.com');
  await submitButton.click();
  await page.waitForTimeout(1200);

  check('submission reaches the endpoint', received.length === 1, `${received.length} request(s)`);
  const body = received[0]?.body ?? '';
  check('payload carries every field', ['Test', 'Person', 'test@example.com', '5551234567',
    'A 40,000 sq ft warehouse.', 'Shelbyville, TN', 'Owner'].every((v) => body.includes(v)));
  check('payload identifies the form and page',
    body.includes('Contact Us Form') && body.includes('/contact/'));
  check('success message shown, form cleared',
    /Thanks/i.test(await form.locator('.gm-form__status').textContent() ?? '')
    && (await form.locator('input[name="email"]').inputValue()) === '');

  // A failing endpoint must surface an error, not a false success.
  await page.route('**/lead', (r) => r.fulfill({ status: 500, body: 'nope' }));
  await fill('test@example.com');
  await submitButton.click();
  await page.waitForTimeout(1000);
  check('endpoint failure shows an error, not success',
    /wrong/i.test(await form.locator('.gm-form__status').textContent() ?? ''));
  check('submit button is re-enabled after a failure', !(await submitButton.isDisabled()));

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
