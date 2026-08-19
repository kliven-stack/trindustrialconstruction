/**
 * Link and asset integrity over the built output. Every internal href, src, srcset
 * entry and CSS url() must resolve inside dist/ — a URL that worked on WordPress
 * and 404s here is a regression (playbook §1).
 *
 *   npm run build && node scripts/audit.mjs
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = path.join(ROOT, 'dist');
const redirects = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8')).redirects ?? [];
const redirectSources = new Set(redirects.map((r) => r.source.replace(/\/$/, '')));

/**
 * Links that are broken on the WordPress site too, cloned as-is (playbook: reproduce
 * original-site bugs faithfully, then flag them). Verified 404 on production
 * 2026-08-19. Remove an entry here the moment the client asks for the link to be
 * fixed — anything not listed is a migration regression.
 */
const BROKEN_ON_PRODUCTION = new Set([
  '/live-event-3',
  '/getquote',
  '/blog',
  '/blog/coldplunge/affordable-cold-plunge',
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

const resolveTarget = async (url) => {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('data:') || clean.startsWith('mailto:') || clean.startsWith('tel:')) return true;
  if (/^https?:\/\//.test(clean) || clean.startsWith('//')) return true; // external, not our problem
  if (!clean.startsWith('/')) return true; // relative — none are emitted, but skip rather than guess
  const target = path.join(DIST, decodeURIComponent(clean));
  if (await exists(target)) {
    return (await stat(target)).isDirectory() ? exists(path.join(target, 'index.html')) : true;
  }
  if (await exists(target + '/index.html')) return true;
  if (await exists(target + '.html')) return true;
  return redirectSources.has(clean.replace(/\/$/, ''));
};

const htmlFiles = [];
const cssFiles = [];
for await (const file of walk(DIST)) {
  if (file.endsWith('.html')) htmlFiles.push(file);
  else if (file.endsWith('.css')) cssFiles.push(file);
}

const broken = new Map(); // url -> Set(page)
const note = (url, where) => {
  if (!broken.has(url)) broken.set(url, new Set());
  broken.get(url).add(path.relative(DIST, where));
};

let checked = 0;
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const urls = new Set();
  for (const m of html.matchAll(/(?:href|src|poster|data-thumbnail)="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(',')) urls.add(part.trim().split(/\s+/)[0]);
  }
  for (const url of urls) {
    checked++;
    if (!(await resolveTarget(url))) note(url, file);
  }
}

for (const file of cssFiles) {
  const css = await readFile(file, 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    checked++;
    if (!(await resolveTarget(m[1]))) note(m[1], file);
  }
}

console.log(`${htmlFiles.length} pages, ${cssFiles.length} stylesheets, ${checked} references checked`);

const expected = [...broken].filter(([url]) => BROKEN_ON_PRODUCTION.has(url.replace(/\/$/, '')));
const regressions = [...broken].filter(([url]) => !BROKEN_ON_PRODUCTION.has(url.replace(/\/$/, '')));

for (const [url, pages] of expected) {
  console.log(`  known-broken (404s on WordPress too): ${url} — ${pages.size} page(s)`);
}

if (!regressions.length) {
  console.log('no broken internal references beyond the ones production already has');
} else {
  console.log(`\n${regressions.length} REGRESSIONS:`);
  for (const [url, pages] of regressions) {
    console.log(`  ${url}\n      on ${[...pages].slice(0, 4).join(', ')}${pages.size > 4 ? ` (+${pages.size - 4} more)` : ''}`);
  }
  process.exitCode = 1;
}
