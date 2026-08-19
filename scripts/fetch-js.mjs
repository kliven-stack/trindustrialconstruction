// Third-party scripts that live inside the ported markup — the LeadConnector embed
// loader and its iframe resizer. They are part of the embed, not WordPress plumbing,
// so they are mirrored and served from our own origin instead of being stripped.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import path from 'node:path';
import { scriptFileName } from './lib/script-name.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const HTML = path.join(ROOT, '_extract/html');
const JSDIR = path.join(ROOT, 'public/wp/js');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

await mkdir(JSDIR, { recursive: true });

const urls = new Set();
for (const file of (await readdir(HTML)).filter((f) => f.endsWith('.html'))) {
  const $ = cheerio.load(await readFile(path.join(HTML, file), 'utf8'), { decodeEntities: false });
  $('body > header[data-elementor-type], body > footer[data-elementor-type], body > div[data-elementor-type], body > main#content')
    .find('script[src]')
    .each((i, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('data:')) urls.add(src);
    });
}

console.log(`${urls.size} in-region scripts`);
for (const url of urls) {
  const out = path.join(JSDIR, scriptFileName(url));
  if (existsSync(out) && !process.env.FORCE) { console.log('cache', path.basename(out)); continue; }
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  const body = await res.text();
  await writeFile(out, body);
  console.log(res.status, path.basename(out), body.length);
}
