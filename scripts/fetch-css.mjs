// Download every stylesheet the live site links, keyed by its WordPress handle
// (LiteSpeed hashes the filenames, but the handle in the <link id> is stable).
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HTML = new URL('../_extract/html/', import.meta.url).pathname;
const CSSDIR = new URL('../public/wp/css/', import.meta.url).pathname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

await mkdir(CSSDIR, { recursive: true });
const files = (await readdir(HTML)).filter((f) => f.endsWith('.html'));
const map = new Map(); // handle -> url
for (const f of files) {
  const html = await readFile(path.join(HTML, f), 'utf8');
  for (const m of html.matchAll(/<link[^>]*rel='stylesheet'[^>]*>/g)) {
    const tag = m[0];
    const id = /id='([^']*)-css'/.exec(tag)?.[1];
    const href = /href='([^']*)'/.exec(tag)?.[1];
    if (id && href && !map.has(id)) map.set(id, href);
  }
}
console.log(`${map.size} stylesheet handles`);
for (const [handle, url] of map) {
  // The Google Fonts stylesheets are replaced by scripts/build-fonts.mjs with
  // self-hosted woff2; re-downloading them would undo that.
  if (handle.startsWith('elementor-gf-')) { console.log('skip (self-hosted)', handle); continue; }
  const out = path.join(CSSDIR, `${handle}.css`);
  if (existsSync(out) && !process.env.FORCE) { console.log('cache', handle); continue; }
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  const body = await res.text();
  await writeFile(out, body);
  console.log(res.status, handle, body.length);
}
