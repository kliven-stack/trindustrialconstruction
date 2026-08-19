// Self-host the Google families the pages request.
//
// Unlike diypoolsandspas — which linked Google's own CDN and had to be rebuilt from
// fontsource — this site already runs Elementor's "local Google Fonts" feature: the
// origin serves one stylesheet per family under /wp-content/uploads/elementor/
// google-fonts/, with real woff2 files and per-subset `unicode-range`.
//
// So the faithful move is to mirror those files rather than substitute anything.
// The only edit is the playbook's latin-subset rule (§2): the Cyrillic, Greek and
// Vietnamese blocks are dropped, which the browser's unicode-range gating already
// meant it never downloaded for this English site. Everything that renders — the
// family names, weights, styles and the exact font binaries — is the original's.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HTML = path.join(ROOT, '_extract/html');
const FONTS = path.join(ROOT, 'public/wp/fonts');
const CSSDIR = path.join(ROOT, 'public/wp/css');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Subsets kept. The site's copy is English; the rest never matched a codepoint. */
const KEEP = new Set(['latin', 'latin-ext']);

await mkdir(FONTS, { recursive: true });
await mkdir(CSSDIR, { recursive: true });

// Which family stylesheets does the site link, and under which handle?
const sheets = new Map(); // handle -> url
for (const f of (await readdir(HTML)).filter((f) => f.endsWith('.html'))) {
  const html = await readFile(path.join(HTML, f), 'utf8');
  for (const m of html.matchAll(/<link[^>]*id='(elementor-gf-local-[^']*)-css'[^>]*href='([^']*)'/g)) {
    if (!sheets.has(m[1])) sheets.set(m[1], m[2]);
  }
}

const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

let files = 0;
for (const [handle, url] of sheets) {
  const css = await (await get(url)).text();
  const out = [];
  // Elementor emits `/* subset */` immediately before each @font-face block.
  for (const m of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)) {
    const [, subset, face] = m;
    if (!KEEP.has(subset)) continue;
    out.push(face.replace(/url\((\S+?)\)/g, (_, u) => {
      const name = u.replace(/^['"]|['"]$/g, '').split('/').pop();
      return `url(/wp/fonts/${name})`;
    }));
  }
  await writeFile(path.join(CSSDIR, `${handle}.css`), out.join('\n') + '\n');

  // The woff2 files those blocks now point at.
  const names = new Set([...out.join('\n').matchAll(/url\(\/wp\/fonts\/([^)]+)\)/g)].map((m) => m[1]));
  for (const name of names) {
    const dest = path.join(FONTS, name);
    if (existsSync(dest)) continue;
    const src = new URL(url).origin + '/wp-content/uploads/elementor/google-fonts/fonts/' + name;
    await writeFile(dest, Buffer.from(await (await get(src)).arrayBuffer()));
    files++;
  }
  console.log(`${handle.padEnd(36)} ${out.length} faces, ${names.size} files`);
}
console.log(`\n${sheets.size} families, ${files} font files downloaded`);
